// BLACK BOX — static server + table-mode relay.
// Every phone is a complete mirror of the room state; the server holds the one
// authoritative state machine and sends each client a privacy-filtered view
// (burns invisible, commits hidden until reveal, ballots anonymous forever).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { scoreChoice, scoreAbstain, scoreScale, CONF } from './public/js/scoring.js';
import { computeStats, roundFlavor, interimStats } from './public/js/stats.js';
import { TUTORIAL } from './public/js/tutorial.js';

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const rawDeck = JSON.parse(fs.readFileSync(path.join(ROOT, 'deck.json'), 'utf8'));
// Two play levels: deck T2+T3 → 1 "Spicy" (the starting line), T4+T5 → 2 "Deep".
// Deck T1 is dropped — surface trivia wastes the table's appetite.
const TIER_MAP = { 2: 1, 3: 1, 4: 2, 5: 2 };
const DECK = [
  ...TUTORIAL,
  ...(rawDeck.probes || rawDeck).filter(p => TIER_MAP[p.tier]).map(p => ({ ...p, tier: TIER_MAP[p.tier] })),
];

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const httpServer = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA-ish: unknown paths get the app shell
      fs.readFile(path.join(ROOT, 'index.html'), (e2, shell) => {
        if (e2) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(shell);
      });
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- rooms ----------
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no ambiguous glyphs
// No house-rule toggles — sensible defaults everywhere; the consent machinery
// is the tier ballot and the invisible burn, not settings screens. The only
// knobs are rounds and pace ("demo" compresses every timer for stage demos).
const PACE = {
  standard: {
    preview: 10, probe: 30, truth: 5, ballot: 25,
    commit: Number(process.env.BB_COMMIT_SEC) || 15,
    debrief: Number(process.env.BB_DEBRIEF_SEC) || 90,
  },
  demo: { preview: 5, probe: 20, truth: 3, ballot: 15, commit: 10, debrief: 25 },
};
// A round = everyone takes one turn as the subject. The setting counts rounds
// (rotations); roundsTotal/roundsPlayed are turns, internal bookkeeping.
const DEFAULT_ROUNDS = Number(process.env.BB_ROUNDS) || 3;
const tm = room => PACE[room.settings.pace] || PACE.standard;

function newCode() {
  let code;
  do { code = [...Array(4)].map(() => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function mkRoom() {
  const room = {
    code: newCode(),
    players: [],            // {id, name, connected}
    sockets: new Map(),     // pid -> ws
    stages: new Set(),      // ws
    settings: { rounds: DEFAULT_ROUNDS, pace: 'standard' },
    phase: 'lobby', phaseStartedAt: Date.now(), phaseEndsAt: null, timer: null,
    tier: 1, round: -1, roundsPlayed: 0, roundsTotal: 0, // turns; set at start from rounds × players
    subjectIdx: -1, sinceBallot: 0,
    probe: null, used: new Set(),
    commits: new Map(),     // pid -> {answer, conf, auto}
    truth: null, truthConfirmed: false, roundPts: null, flavor: null, interim: null,
    votes: new Map(), ballotOutcome: null,
    history: [], statsData: null,
    lastSeen: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function subjectOf(room) { return room.players[room.subjectIdx] || null; }
function predictorsOf(room) { return room.players.filter((_, i) => i !== room.subjectIdx); }
function liveCount(room) { return Math.max(1, room.players.filter(p => p.connected).length); }
function kOf(room) {
  const p = room.probe;
  if (!p) return 2;
  if (p.answerType === 'relational') return Math.max(2, room.players.length - 1);
  return p.options && p.options.length > 2 ? p.options.length : 2;
}

function drawProbe(room, tier) {
  // minus free-form (typing on a 15s parallel timer); dyad-tagged probes (the
  // ones addressed to a single "you") only when there are exactly two players;
  // relational probes need at least two other players to point at
  const ok = p => p.tier === tier && p.answerType !== 'freeform' &&
    (p.modes.includes('table') || room.players.length === 2) &&
    (p.answerType !== 'relational' || room.players.length >= 3);
  let pool = DECK.filter(p => ok(p) && !room.used.has(p.id));
  if (!pool.length) { // tier exhausted: recycle, excluding the probe on the table
    for (const p of DECK) if (ok(p)) room.used.delete(p.id);
    pool = DECK.filter(p => ok(p) && p.id !== room.probe?.id);
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  room.used.add(pick.id);
  const probe = { ...pick };
  if (probe.answerType === 'relational') {
    probe.options = room.players.filter((_, i) => i !== room.subjectIdx).map(p => p.name);
  } else if (probe.answerType === 'overunder' && !probe.options) {
    probe.options = ['Over', 'Under'];
  } else if (probe.answerType === 'binary' && !probe.options) {
    probe.options = ['Yes', 'No'];
  }
  return probe;
}

// ---------- phase machine ----------
function setPhase(room, phase, secs = null) {
  clearTimeout(room.timer); room.timer = null;
  room.phase = phase;
  room.phaseStartedAt = Date.now();
  room.phaseEndsAt = secs ? Date.now() + secs * 1000 : null;
  if (secs) room.timer = setTimeout(() => onTimeout(room), secs * 1000 + 60);
  broadcast(room);
}

function onTimeout(room) {
  switch (room.phase) {
    case 'preview': toProbe(room); break;
    case 'probe': toCommit(room); break;
    case 'commit': toReveal(room); break;
    case 'reveal': // subject vanished mid-reveal: score if truth is in, otherwise skip
      if (room.truth !== null) confirmTruth(room); else abandonRound(room); break;
    case 'truth': setPhase(room, 'debrief', tm(room).debrief); break;
    case 'debrief': endRound(room); break;
    case 'ballot': resolveBallot(room); break;
    case 'ballotResult': afterBallot(room); break;
  }
}

function afterBallot(room) {
  if (room.roundsPlayed >= room.roundsTotal) toStats(room);
  else startRound(room);
}

function startRound(room) {
  room.round += 1; // round 0 is the T0 tutorial
  // rotate, skipping ghost seats — a disconnected player must never be the subject
  for (let hops = 0; hops < room.players.length; hops++) {
    room.subjectIdx = (room.subjectIdx + 1) % room.players.length;
    if (room.players[room.subjectIdx].connected) break;
  }
  room.probe = drawProbe(room, room.round === 0 ? 0 : room.tier);
  room.commits = new Map();
  room.truth = null; room.truthConfirmed = false; room.roundPts = null; room.flavor = null;
  room.ballotOutcome = null;
  setPhase(room, 'preview', tm(room).preview);
}

function toProbe(room) { setPhase(room, 'probe', tm(room).probe); }
function toCommit(room) { setPhase(room, 'commit', tm(room).commit); }

function maybeAdvanceCommit(room) {
  const preds = predictorsOf(room);
  const allIn = preds.filter(p => p.connected).every(p => room.commits.has(p.id));
  const subj = subjectOf(room);
  const truthOk = room.truth !== null || !subj?.connected;
  if (allIn && truthOk) toReveal(room);
}

function toReveal(room) {
  if (room.phase !== 'commit') return;
  for (const p of predictorsOf(room)) {
    if (!room.commits.has(p.id)) room.commits.set(p.id, { answer: null, conf: null, auto: true });
  }
  // safety valve so a vanished subject can never freeze the table
  setPhase(room, 'reveal', 180);
}

function confirmTruth(room) {
  if (room.truth === null) return;
  room.truthConfirmed = true;
  const k = kOf(room);
  const preds = [];
  for (const p of predictorsOf(room)) {
    const c = room.commits.get(p.id) || { answer: null, conf: null, auto: true };
    let pts, correct = null, conf = c.conf;
    if (c.auto || c.answer === null) {
      pts = scoreAbstain(); conf = null;
    } else if (room.probe.answerType === 'scale') {
      correct = Math.abs(Number(c.answer) - Number(room.truth)) <= 1;
      pts = scoreScale(Number(c.answer), Number(room.truth));
      conf = null;
    } else {
      correct = c.answer === room.truth;
      pts = scoreChoice(conf, correct, k);
    }
    preds.push({ pid: p.id, name: p.name, answer: c.answer, conf, p: conf ? CONF[conf].p : null, auto: !!c.auto, correct, pts });
  }
  room.roundPts = preds.map(x => ({ pid: x.pid, name: x.name, pts: x.pts, correct: x.correct, auto: x.auto }));
  if (room.round > 0) { // tutorial round: zero stakes, never recorded
    room.history.push({
      round: room.round, tier: room.probe.tier, probeId: room.probe.id,
      text: room.probe.text.replace(/\{name\}/g, subjectOf(room).name),
      subjectId: subjectOf(room).id, subjectName: subjectOf(room).name, truth: room.truth, preds,
    });
    room.flavor = roundFlavor(room.history);
  }
  setPhase(room, 'truth', tm(room).truth);
}

function abandonRound(room) { startRound(room); }

function endRound(room) {
  if (room.round > 0) { room.roundsPlayed += 1; room.sinceBallot += 1; }
  // one guardrail: while still spicy, each full rotation asks once — go deep?
  // (once deep there's nothing to vote on; skip it too when the game is ending —
  // voting to deepen a finished game reads as nonsense)
  if (room.round > 0 && room.tier === 1 && room.sinceBallot >= liveCount(room) &&
      room.roundsPlayed < room.roundsTotal) { toBallot(room); return; }
  if (room.round > 0 && room.roundsPlayed >= room.roundsTotal) { toStats(room); return; }
  startRound(room);
}

function toBallot(room) {
  room.votes = new Map();
  room.ballotOutcome = null;
  room.interim = interimStats(room.history, room.players);
  setPhase(room, 'ballot', tm(room).ballot);
}

function resolveBallot(room) {
  if (room.phase !== 'ballot') return;
  // majority of the players actually present; absent votes count as "not yet"
  const deep = room.players.filter(p => room.votes.get(p.id) === 'deepen').length;
  room.sinceBallot = 0;
  const dir = deep > liveCount(room) / 2 ? 'deepen' : 'stay';
  if (dir === 'deepen') room.tier = 2;
  room.ballotOutcome = { dir, tier: room.tier };
  setPhase(room, 'ballotResult', 5);
}

function toStats(room) {
  room.statsData = computeStats(room.history, room.players, false);
  setPhase(room, 'stats');
}

// ---------- actions ----------
function handleAction(room, pid, a, d = {}) {
  const me = room.players.find(p => p.id === pid);
  if (!me) return;
  const isSubject = subjectOf(room)?.id === pid;
  const isCreator = room.players[0]?.id === pid;
  // a dead creator phone must not strand the room — anyone present inherits the host powers
  const actingCreator = isCreator || room.players[0]?.connected === false;

  switch (a) {
    case 'settings':
      if (room.phase === 'lobby' && actingCreator) {
        const r = Math.round(Number(d.rounds));
        if (Number.isFinite(r) && r >= 1) room.settings.rounds = Math.min(10, r);
        if (['standard', 'demo'].includes(d.pace)) room.settings.pace = d.pace;
        broadcast(room);
      }
      break;
    case 'start':
      if (room.phase === 'lobby' && actingCreator && liveCount(room) >= 2) {
        room.roundsTotal = room.settings.rounds * liveCount(room);
        startRound(room);
      }
      break;
    case 'burn': // unlimited, costless, never logged; other phones just see "choosing…"
      if (room.phase === 'preview' && isSubject) {
        room.probe = drawProbe(room, room.round === 0 ? 0 : room.tier);
        setPhase(room, 'preview', tm(room).preview);
      }
      break;
    case 'keep':
      if (room.phase === 'preview' && isSubject) toProbe(room);
      break;
    case 'ready':
      if (room.phase === 'probe' && isSubject) toCommit(room);
      break;
    case 'commit':
      if (room.phase === 'commit' && !isSubject && !room.commits.has(pid)) {
        const conf = room.probe?.answerType === 'scale' ? null : (CONF[d.conf] ? d.conf : 'pass');
        if (d.answer == null) break;
        if (room.probe?.answerType === 'scale' && !(Number(d.answer) >= 1 && Number(d.answer) <= 10)) break;
        room.commits.set(pid, { answer: String(d.answer), conf, auto: false });
        maybeAdvanceCommit(room);
        broadcast(room);
      }
      break;
    case 'truth':
      if (['commit', 'reveal'].includes(room.phase) && isSubject && !room.truthConfirmed && d.answer != null) {
        if (room.probe?.answerType === 'scale' && !(Number(d.answer) >= 1 && Number(d.answer) <= 10)) break;
        room.truth = String(d.answer);
        if (room.phase === 'commit') maybeAdvanceCommit(room);
        broadcast(room);
      }
      break;
    case 'confirmTruth':
      if (room.phase === 'reveal' && isSubject) confirmTruth(room);
      break;
    case 'endDebrief':
      if (room.phase === 'debrief') endRound(room);
      break;
    case 'extendDebrief':
      if (room.phase === 'debrief' && room.phaseEndsAt) {
        room.phaseEndsAt += 30_000;
        clearTimeout(room.timer);
        room.timer = setTimeout(() => onTimeout(room), room.phaseEndsAt - Date.now() + 60);
        broadcast(room);
      }
      break;
    case 'vote':
      if (room.phase === 'ballot' && ['deepen', 'stay'].includes(d.v) && !room.votes.has(pid)) {
        room.votes.set(pid, d.v);
        if (room.players.filter(p => p.connected).every(p => room.votes.has(p.id))) resolveBallot(room);
        else broadcast(room);
      }
      break;
    case 'skip': // any player may unstick a round whose subject dropped
      if (['preview', 'probe', 'commit', 'reveal'].includes(room.phase) && !subjectOf(room)?.connected) abandonRound(room);
      break;
    case 'more':
      // exactly one more rotation from here — even after an early finish
      if (room.phase === 'stats') { room.roundsTotal = room.roundsPlayed + liveCount(room); startRound(room); }
      break;
    case 'finish':
      if (actingCreator && room.phase !== 'lobby' && room.phase !== 'stats') toStats(room);
      break;
  }
}

// ---------- per-client views ----------
const PROBE_PHASES = ['probe', 'commit', 'reveal', 'truth', 'debrief'];
const COMMIT_PHASES = ['reveal', 'truth', 'debrief'];

function stateFor(room, pid) {
  const me = room.players.find(p => p.id === pid) || null;
  const subj = subjectOf(room);
  const isSubject = !!me && subj?.id === pid;
  const showProbe = PROBE_PHASES.includes(room.phase) || (room.phase === 'preview' && isSubject);
  const showCommits = COMMIT_PHASES.includes(room.phase);
  const showTruth = room.truthConfirmed && ['truth', 'debrief'].includes(room.phase);
  const myCommit = me ? room.commits.get(pid) : null;

  return {
    code: room.code,
    phase: room.phase,
    now: Date.now(),
    phaseStartedAt: room.phaseStartedAt,
    phaseEndsAt: room.phaseEndsAt,
    round: room.round, roundsTotal: room.roundsTotal, roundsPlayed: room.roundsPlayed,
    tier: room.tier,
    settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })),
    subjectId: subj?.id ?? null,
    subjectName: subj?.name ?? null,
    subjectConnected: subj?.connected ?? true,
    creatorId: room.players[0]?.id ?? null,
    probe: showProbe && room.probe
      ? { id: room.probe.id, text: room.probe.text, tier: room.probe.tier, answerType: room.probe.answerType, options: room.probe.options || null, tutorial: room.probe.tier === 0 }
      : null,
    lockCount: room.phase === 'commit' ? room.commits.size : null,
    predictorCount: room.players.length ? room.players.length - 1 : 0,
    truthIn: room.truth !== null,
    truth: showTruth ? room.truth : null,
    roundPts: showTruth ? room.roundPts : null,
    flavor: showTruth ? room.flavor : null,
    interim: room.phase === 'ballotResult' ? room.interim : null,
    commits: showCommits
      ? predictorsOf(room).map(p => {
          const c = room.commits.get(p.id) || { answer: null, conf: null, auto: true };
          return { pid: p.id, name: p.name, answer: c.answer, conf: c.conf, auto: !!c.auto };
        })
      : null,
    ballotOutcome: room.phase === 'ballotResult' ? room.ballotOutcome : null,
    voteCount: null, // never leak ballot progress — anonymity is the point
    statsData: room.phase === 'stats' ? room.statsData : null,
    history: room.phase === 'stats' ? room.history : null,
    you: me ? {
      id: me.id, name: me.name, isSubject, isCreator: room.players[0]?.id === me.id,
      committed: !!myCommit, commit: myCommit && !myCommit.auto ? { answer: myCommit.answer, conf: myCommit.conf } : null,
      truth: isSubject ? room.truth : null,
      voted: room.votes.has(pid),
    } : null,
  };
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function broadcast(room) {
  room.lastSeen = Date.now();
  for (const [pid, ws] of room.sockets) send(ws, { t: 'state', s: stateFor(room, pid) });
  for (const ws of room.stages) send(ws, { t: 'state', s: stateFor(room, null) });
}

// ---------- websocket plumbing ----------
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', ws => {
  ws.bb = { room: null, pid: null, stage: false };

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = ws.bb.room;

    if (m.t === 'create') {
      const name = String(m.name || '').trim().slice(0, 16);
      if (!name) return send(ws, { t: 'err', msg: 'Need a first name.' });
      const r = mkRoom();
      const pid = Math.random().toString(36).slice(2, 10);
      r.players.push({ id: pid, name, connected: true });
      r.sockets.set(pid, ws);
      ws.bb = { room: r, pid, stage: false };
      send(ws, { t: 'joined', code: r.code, pid });
      broadcast(r);

    } else if (m.t === 'join') {
      const code = String(m.code || '').trim().toUpperCase();
      const name = String(m.name || '').trim().slice(0, 16);
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'err', msg: `No table "${code}" — check the code.` });
      if (!name) return send(ws, { t: 'err', msg: 'Need a first name.' });
      const existing = r.players.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        // reconnection by first name reclaims your seat. Mid-game the old socket
        // is usually a zombie (phone slept during the debrief) — evict it rather
        // than strand the returning player for a heartbeat cycle.
        const old = r.sockets.get(existing.id);
        if (old && old !== ws && old.readyState === 1) {
          if (existing.connected && r.phase === 'lobby') {
            return send(ws, { t: 'err', msg: `"${existing.name}" is already at the table — pick another name.` });
          }
          old.terminate();
        }
        existing.connected = true;
        r.sockets.set(existing.id, ws);
        ws.bb = { room: r, pid: existing.id, stage: false };
        send(ws, { t: 'joined', code: r.code, pid: existing.id });
      } else {
        if (r.phase !== 'lobby') return send(ws, { t: 'err', msg: 'This game already started. Played before? Use your exact same name to get your seat back. New? Watch via “Big screen only” and join the next game.' });
        const pid = Math.random().toString(36).slice(2, 10);
        r.players.push({ id: pid, name, connected: true });
        r.sockets.set(pid, ws);
        ws.bb = { room: r, pid, stage: false };
        send(ws, { t: 'joined', code: r.code, pid });
      }
      broadcast(r);

    } else if (m.t === 'stage') {
      const r = rooms.get(String(m.code || '').trim().toUpperCase());
      if (!r) return send(ws, { t: 'err', msg: 'No such table.' });
      r.stages.add(ws);
      ws.bb = { room: r, pid: null, stage: true };
      send(ws, { t: 'joined', code: r.code, pid: null, stage: true });
      send(ws, { t: 'state', s: stateFor(r, null) });

    } else if (m.t === 'act' && room && ws.bb.pid) {
      handleAction(room, ws.bb.pid, m.a, m.d);
    }
  });

  ws.on('close', () => {
    const { room, pid, stage } = ws.bb || {};
    if (!room) return;
    if (stage) { room.stages.delete(ws); return; }
    if (pid && room.sockets.get(pid) === ws) {
      room.sockets.delete(pid);
      const p = room.players.find(x => x.id === pid);
      if (p) p.connected = false;
      if (room.phase === 'commit') maybeAdvanceCommit(room);
      if (room.phase === 'ballot' && room.players.filter(x => x.connected).every(x => room.votes.has(x.id)) && room.votes.size > 0) resolveBallot(room);
      broadcast(room);
    }
  });
});

// Heartbeat — hosted proxies (Render, Cloudflare) drop idle sockets, and the
// 90s face-down debrief is exactly that. Ping every 30s; reap unresponsive peers.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// reap dead rooms
setInterval(() => {
  for (const [code, r] of rooms) {
    if (r.sockets.size === 0 && r.stages.size === 0 && Date.now() - r.lastSeen > 30 * 60_000) {
      clearTimeout(r.timer);
      rooms.delete(code);
    }
  }
}, 5 * 60_000).unref();

httpServer.listen(PORT, () => {
  console.log(`BLACK BOX up at:`);
  console.log(`  http://localhost:${PORT}`);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  http://${i.address}:${PORT}  ← phones join here`);
    }
  }
});
