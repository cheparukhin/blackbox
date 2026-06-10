// Table mode — every phone is a mirror of the room state; this file turns that
// state into the choreography: buzz on commit, 3-2-1 sting, grid, auto-dim
// "look up", face-down debrief, anonymous ballots.

import { render, bind, esc, probeText, flashScreen, everyFrame, clearTickers, secsLeft, timerBar, tierLabel } from './util.js';
import { CONF, CONF_ORDER } from './scoring.js';
import * as audio from './audio.js';
import { getName, setName, recordCalibration, saveSession, getCalibration } from './storage.js';
import { statsCard } from './statsview.js';

let ws = null, myPid = null, myName = '', joinedCode = null, onExit = null;
let offset = 0, lastState = null, prevPhase = null;
let played = new Set();      // sound cues fired for current phase instance
let phaseKey = '';
let peekUntil = 0;           // reveal-grid peek
let debriefTools = false;
let pendingAnswer = null;    // commit input in progress
let calibRecorded = -1;      // highest round already written to calibration
let sessionSaved = false;

export function startTable(opts, exit) {
  onExit = exit;
  nameScreen(opts);
}

function nameScreen(opts, errMsg = '') {
  clearTickers();
  const stored = getName();
  render(`
    <p class="kicker">everyone's phone · one room</p>
    <input type="text" id="nm" placeholder="First name" maxlength="16" autocomplete="off" value="${esc(stored)}">
    <input type="text" id="code" placeholder="Room code (if joining)" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(opts.code || '')}" style="text-transform:uppercase">
    ${errMsg ? `<p class="small" style="color:var(--bad)">${esc(errMsg)}</p>` : ''}
    <button class="primary" data-a="join">Join with code</button>
    <button data-a="create">Start a new room</button>
    <button class="ghost" data-a="back">Back</button>
  `);
  const name = () => document.querySelector('#nm').value.trim();
  bind({
    back: () => onExit(),
    join: () => {
      audio.unlock();
      const code = document.querySelector('#code').value.trim().toUpperCase();
      if (!name()) return nameScreen({ ...opts, code }, 'A first name, so the table knows who is staring.');
      if (code.length !== 4) return nameScreen(opts, 'Room codes are 4 characters.');
      setName(name()); myName = name();
      connect({ t: 'join', code, name: myName }, opts);
    },
    create: () => {
      audio.unlock();
      if (!name()) return nameScreen(opts, 'A first name, so the table knows who is staring.');
      setName(name()); myName = name();
      connect({ t: 'create', name: myName }, opts);
    },
  });
}

function connect(hello, opts) {
  render(`<div class="dead-hint">connecting…</div>`, 'dead');
  try { ws?.close(); } catch {}
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify(hello));
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'err') { nameScreen({ ...opts, code: hello.code || '' }, m.msg); joinedCode = null; }
    if (m.t === 'joined') { myPid = m.pid; joinedCode = m.code; history.replaceState(null, '', `/?room=${m.code}`); }
    if (m.t === 'state') { lastState = m.s; offset = m.s.now - Date.now(); paint(m.s); }
  };
  ws.onclose = () => {
    if (!joinedCode) return; // join was rejected; name screen is showing
    render(`<div class="dead-hint">connection lost — rejoining as ${esc(myName)}…</div>`, 'dead');
    setTimeout(() => connect({ t: 'join', code: joinedCode, name: myName }, opts), 2000);
  };
}

function act(a, d = {}) { ws?.send(JSON.stringify({ t: 'act', a, d })); }

// ---------- paint dispatch ----------
function paint(s) {
  clearTickers();
  if (s.phase !== prevPhase) {
    onTransition(prevPhase, s.phase, s);
    prevPhase = s.phase;
    phaseKey = s.phase + ':' + s.phaseStartedAt;
    played = new Set();
    peekUntil = 0; debriefTools = false; pendingAnswer = null;
  }
  const fn = SCREENS[s.phase] || (() => render(`<div class="dead-hint">…</div>`, 'dead'));
  fn(s);
}

function onTransition(from, to, s) {
  if (to === 'commit') { audio.buzz(); flashScreen(); }
  if (from === 'debrief' && to === 'reply') audio.chime(); // cap needs an end signal, not a watched countdown
  if (to === 'stats') harvestStats(s);
}

function cue(name, fn) { if (!played.has(name)) { played.add(name); fn(); } }
function nowS() { return Date.now() + offset; }

// ---------- screens ----------
const SCREENS = {
  lobby(s) {
    const isCreator = s.you?.isCreator;
    const url = `${location.origin}/?room=${s.code}`;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
    render(`
      <p class="kicker center">black box · table</p>
      <div class="code-big">${s.code}</div>
      <img class="qr" src="${qr}" alt="" onerror="this.style.display='none'">
      <p class="muted center small">Join on your phone: same wifi → ${esc(location.host)} → code above</p>
      <div class="player-list">
        ${s.players.map(p => `<div class="player-row"><span>${esc(p.name)}${p.id === s.creatorId ? ' <span class="muted small">opened the table</span>' : ''}</span><span class="${p.connected ? '' : 'off'}">${p.connected ? '●' : 'away'}</span></div>`).join('')}
      </div>
      ${isCreator ? `
        <div class="btn-row">
          <button class="ghost" data-a="rounds">${s.settings.rounds} rounds</button>
          <button class="ghost" data-a="pace">${s.settings.pace === 'demo' ? '⚡ demo pace' : 'standard pace'}</button>
        </div>
        <button class="primary" data-a="start" ${s.players.length < 2 ? 'disabled' : ''}>${s.players.length < 2 ? 'Need 2+ players' : 'Start'}</button>`
        : `<p class="muted center small">${s.settings.rounds} rounds · ${esc(s.settings.pace)} pace — waiting for ${esc(s.players[0]?.name || 'the host')} to start…</p>`}
      <button class="ghost" data-a="stage">Use this device as a big screen</button>
    `);
    const ROUNDS = [4, 6, 8, 12, 16, 20];
    bind({
      start: () => act('start'),
      stage: () => { location.href = `/?room=${s.code}&stage=1`; },
      rounds: () => act('settings', { rounds: ROUNDS[(ROUNDS.indexOf(s.settings.rounds) + 1) % ROUNDS.length] }),
      pace: () => act('settings', { pace: s.settings.pace === 'demo' ? 'standard' : 'demo' }),
    });
  },

  preview(s) {
    if (s.you?.isSubject && s.probe) {
      const left = secsLeft(s.phaseEndsAt, offset);
      render(`
        <p class="kicker">${tierLabel(s.probe.tier)} · your eyes only</p>
        <p class="probe-text">${esc(probeText(s.probe.text, s.you.name))}</p>
        <p class="muted small">Keep it, or burn it — nobody will ever know.</p>
        ${timerBar((left ?? 0) / 8)}
        <div class="btn-row">
          <button data-a="burn">Burn</button>
          <button class="primary" data-a="keep">Keep it</button>
        </div>
      `);
      bind({ burn: () => act('burn'), keep: () => act('keep') });
      everyFrame(() => { if (lastState?.phase === 'preview') paintBarOnly(s, 8); });
    } else {
      deadScreen('drawing…', s);
    }
  },

  probe(s) {
    const mine = s.you?.isSubject;
    render(`
      <p class="kicker">${tierLabel(s.probe.tier)}</p>
      <p class="probe-text">${esc(probeText(s.probe.text, s.subjectName))}</p>
      <p class="${mine ? '' : 'muted'}">${mine ? 'Read it out loud to the table.' : `${esc(s.subjectName)}, read it out.`}</p>
      ${mine ? `<button class="primary" data-a="ready">Everyone heard it — start the clock</button>` : ''}
      ${skipButton(s)}
    `);
    bind({ ready: () => act('ready'), skip: () => act('skip') });
  },

  commit(s) {
    const left = secsLeft(s.phaseEndsAt, offset) ?? 0;
    if (left <= 5) cue('t' + left, audio.tick);
    if (s.you?.isSubject) return commitSubject(s, left);
    return commitPredictor(s, left);
  },

  reveal(s) {
    const elapsed = nowS() - s.phaseStartedAt;
    if (elapsed < 3000) {
      const n = 3 - Math.floor(elapsed / 1000);
      cue('c' + n, audio.tick);
      render(`<div class="countdown-huge">${n}</div>`, 'dead');
    } else if (elapsed < 3000 + 6000 || nowS() < peekUntil) {
      cue('sting', audio.sting);
      revealGrid(s);
    } else {
      lookupScreen(s);
    }
    everyFrame(() => { if (lastState?.phase === 'reveal') SCREENS.reveal(lastState); }, 250);
  },

  truth(s) {
    const mine = s.roundPts?.find(r => r.pid === myPid);
    const tutorial = s.probe?.tutorial;
    render(`
      <p class="kicker center">the truth</p>
      <div class="truth-big">${esc(s.truth)}</div>
      ${tutorial ? `<p class="muted center">Warm-up round — no points.</p>` : mine ? `
        <div class="pts-huge ${mine.correct ? 'good' : ''}">+${mine.pts}</div>
        <p class="muted center small">${mine.auto ? 'Timed out — auto-pass.' : mine.correct ? 'Read.' : 'Missed.'}</p>` : `
        <div class="grid">${(s.roundPts || []).map(r => `
          <div class="grid-row"><span class="name">${esc(r.name)}</span><span class="muted">+${r.pts}</span></div>`).join('')}
        </div>`}
    `);
  },

  debrief(s) {
    if (!debriefTools) {
      render(`
        <div class="dead-big">PHONES<br>FACE DOWN</div>
        <p class="dead-hint">talk · the minority report speaks first</p>
      `, 'dead facedown');
      document.querySelector('#app').onclick = () => { debriefTools = true; SCREENS.debrief(lastState); };
      return;
    }
    // flipped mid-debrief: faint AR stems — a hint, never a requirement
    const left = secsLeft(s.phaseEndsAt, offset);
    render(`
      <p class="dead-hint">“I noticed…”<br>“I imagined you as someone who…”</p>
      <p class="dead-hint">${left ?? ''}s</p>
      <div class="btn-row">
        <button class="ghost" data-a="ext">+30s</button>
        <button class="ghost" data-a="end">End debrief</button>
      </div>
      <button class="ghost" data-a="down">back face down</button>
    `, 'dead facedown');
    bind({
      ext: () => act('extendDebrief'),
      end: () => act('endDebrief'),
      down: () => { debriefTools = false; SCREENS.debrief(lastState); },
    });
    everyFrame(() => { if (lastState?.phase === 'debrief' && debriefTools) SCREENS.debrief(lastState); }, 1000);
  },

  reply(s) {
    if (s.you?.isSubject) {
      render(`
        <p class="kicker">your right of reply</p>
        <p class="muted">Anything they got wrong about how they got it right?</p>
        <button class="ghost" data-a="more">“It's more complicated” · +60s</button>
        <button class="primary" data-a="done">Done — next round</button>
      `);
      bind({ more: () => act('extendReply'), done: () => act('endReply') });
    } else {
      deadScreen(`${s.subjectName} gets the last word`, s);
    }
  },

  ballot(s) {
    if (s.you?.voted) return deadScreen('ballot’s in', s);
    render(`
      <p class="kicker center">secret ballot</p>
      <p class="center">The table is at <b>${tierLabel(s.tier)}</b>.</p>
      <button class="primary" data-a="v" data-v="deepen">Deepen</button>
      <button data-a="v" data-v="stay">Stay</button>
      <button data-a="v" data-v="retreat">Retreat</button>
      <p class="ballot-note">Nobody ever sees votes or counts — only the outcome.</p>
    `);
    bind({ v: d => act('vote', { v: d.v }) });
  },

  ballotResult(s) {
    const o = s.ballotOutcome || { dir: 'stay', tier: s.tier };
    const line = o.dir === 'deepen' ? `The table deepens to <b>${tierLabel(o.tier)}</b>.`
      : o.dir === 'retreat' ? `The table eases back to <b>${tierLabel(o.tier)}</b>.`
      : `The table stays at <b>${tierLabel(o.tier)}</b>.`;
    render(`<p class="lookup-msg">${line}</p>`, 'dead');
  },

  splinter(s) {
    render(`
      <p class="kicker center">past tier 4</p>
      <p class="lookup-msg">This is pair territory.<br>Find a corner.</p>
      <p class="muted center small">Two people, one phone, no room needed — Local mode from the home screen goes to Tier 5.</p>
      <button data-a="back">Back to the table · Tier 4</button>
    `);
    bind({ back: () => act('splinterAck') });
  },

  stats(s) {
    render(`
      ${statsCard(s.statsData, { calibration: getCalibration() })}
      <button class="primary" data-a="more">One more rotation</button>
      <button class="ghost" data-a="leave">Leave</button>
    `);
    bind({ more: () => act('more'), leave: () => { try { ws.close(); } catch {} joinedCode = null; onExit(); } });
  },
};

// ---------- commit sub-screens ----------
function commitPredictor(s, left) {
  if (s.you.committed) return lockScreen(s);
  const p = s.probe;
  const opts = p.options || ['Yes', 'No'];
  render(`
    <p class="kicker">${left}s · pick and lock</p>
    <p class="probe-text" style="font-size:20px">${esc(probeText(p.text, s.subjectName))}</p>
    <div class="options">
      ${opts.map(o => `<button class="${pendingAnswer === o ? 'selected' : ''}" data-a="ans" data-o="${esc(o)}">${esc(o)}</button>`).join('')}
    </div>
    ${pendingAnswer !== null ? `
      <p class="kicker">how sure?</p>
      <div class="conf-row">
        ${CONF_ORDER.map(c => `<button data-a="conf" data-c="${c}">${CONF[c].label}</button>`).join('')}
      </div>` : ''}
  `);
  bind({
    ans: d => {
      pendingAnswer = d.o;
      commitPredictor(lastState, secsLeft(lastState.phaseEndsAt, offset) ?? 0);
    },
    conf: d => act('commit', { answer: pendingAnswer, conf: d.c }),
  });
  everyFrame(() => {
    if (lastState?.phase === 'commit' && !lastState.you?.committed) {
      const l = secsLeft(lastState.phaseEndsAt, offset) ?? 0;
      if (l <= 5) cue('t' + l, audio.tick);
      const k = document.querySelector('.kicker');
      if (k) k.textContent = `${l}s · pick and lock`;
    }
  }, 500);
}

function commitSubject(s, left) {
  if (s.you.truth !== null) return lockScreen(s, 'Your truth is in. You’ll say it out loud in a moment.');
  const opts = s.probe.options || ['Yes', 'No'];
  render(`
    <p class="kicker">${left}s · your true answer</p>
    <p class="probe-text" style="font-size:20px">${esc(probeText(s.probe.text, s.you.name))}</p>
    <p class="muted small">The table never sees this screen — they hear it from you.</p>
    <div class="options">
      ${opts.map(o => `<button data-a="t" data-o="${esc(o)}">${esc(o)}</button>`).join('')}
    </div>
  `);
  bind({ t: d => act('truth', { answer: d.o }) });
}

function lockScreen(s, note = '') {
  render(`
    <div class="dead-big">${s.lockCount ?? 0}/${s.predictorCount} in</div>
    <p class="dead-hint">${esc(note) || 'locked · phones down'}</p>
  `, 'dead');
}

// ---------- reveal sub-screens ----------
function revealGrid(s) {
  const rows = (s.commits || []).map(c => `
    <div class="grid-row ${c.auto ? 'autopass' : ''}">
      <span class="name">${esc(c.name)}</span>
      <span class="ans">${c.auto ? '—' : esc(c.answer)}</span>
      <span class="conf">${c.auto ? 'timed out · pass' : c.conf ? CONF[c.conf].label : ''}</span>
    </div>`).join('');
  render(`
    <p class="kicker center">the table called it</p>
    <div class="grid">${rows}</div>
    ${splitFlag(s)}
    ${subjectConfirm(s)}
  `);
  bind({
    confirm: () => act('confirmTruth'),
    t: d => act('truth', { answer: d.o }),
    skip: () => act('skip'),
  });
}

function lookupScreen(s) {
  render(`
    <p class="lookup-msg">Look up.<br>${esc(s.subjectName)}, tell them.</p>
    ${s.you?.isSubject ? subjectConfirm(s) : '<p class="dead-hint">tap to peek at the grid</p>'}
    ${skipButton(s)}
  `, 'dead');
  bind({
    confirm: () => act('confirmTruth'),
    t: d => act('truth', { answer: d.o }),
    skip: () => act('skip'),
  });
  if (!s.you?.isSubject) {
    document.querySelector('#app').onclick = () => { peekUntil = nowS() + 3000; SCREENS.reveal(lastState); };
  }
}

function subjectConfirm(s) {
  if (!s.you?.isSubject) return '';
  if (!s.truthIn) {
    const opts = (s.probe.options || ['Yes', 'No']);
    return `<p class="kicker">enter your truth first</p><div class="options">${opts.map(o => `<button data-a="t" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
  }
  return `<button class="primary" data-a="confirm">I've said it out loud — confirm: ${esc(s.you.truth)}</button>`;
}

function splitFlag(s) {
  const real = (s.commits || []).filter(c => !c.auto);
  const counts = {};
  for (const c of real) counts[c.answer] = (counts[c.answer] || 0) + 1;
  const vals = Object.values(counts).sort((a, b) => b - a);
  if (vals.length >= 2) return `<p class="split-flag">Table split ${vals.join('–')}.</p>`;
  return '';
}

// ---------- bits ----------
function deadScreen(hint, s) {
  render(`
    <div class="dead-hint">${esc(hint)}</div>
    ${skipButton(s)}
  `, 'dead');
  bind({ skip: () => act('skip') });
}

function skipButton(s) {
  // a dropped player never blocks a round
  if (s && s.subjectConnected === false && ['preview', 'probe', 'commit', 'reveal'].includes(s.phase)) {
    return `<button class="ghost" data-a="skip">${esc(s.subjectName)} dropped — skip this round</button>`;
  }
  return '';
}

function paintBarOnly(s, total) {
  const left = secsLeft(lastState?.phaseEndsAt, offset);
  const fill = document.querySelector('.bar-fill');
  if (fill && left !== null) fill.style.width = `${(left / total) * 100}%`;
}

function harvestStats(s) {
  if (!s.history) return;
  const recs = [];
  for (const h of s.history) {
    if (h.round <= calibRecorded) continue;
    for (const pr of h.preds) {
      if (pr.pid === myPid && !pr.auto && pr.conf && pr.correct !== null) {
        recs.push({ conf: pr.conf, correct: pr.correct });
      }
    }
  }
  if (recs.length) recordCalibration(recs);
  calibRecorded = Math.max(calibRecorded, ...s.history.map(h => h.round), 0);
  if (!sessionSaved && s.statsData) {
    sessionSaved = true;
    saveSession({ mode: 'table', rounds: s.roundsPlayed, players: s.players.map(p => p.name) });
  }
}
