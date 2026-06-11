// Table mode — every phone is a mirror of the room state; this file turns that
// state into the choreography: buzz on commit, 3-2-1 sting, grid, auto-dim
// "look up", face-down debrief, anonymous ballots.

import { render, bind, esc, probeText, flashScreen, everyFrame, clearTickers, secsLeft, timerBar, tierLabel, confButtons, fmtPts, scaleRow } from './util.js';
import { CONF } from './scoring.js';
import * as audio from './audio.js';
import { getName, setName, recordCalibration, saveSession, getCalibration } from './storage.js';
import { statsCard } from './statsview.js';

let ws = null, myPid = null, myName = '', joinedCode = null, onExit = null;
let offset = 0, lastState = null, prevPhase = null;
let played = new Set();      // sound cues fired for current phase instance
let peekUntil = 0;           // reveal-grid peek
let debriefTools = false;
let pendingAnswer = null;    // commit input in progress
let calibRecorded = -1;      // highest round already written to calibration
let sessionSaved = false;

export function startTable(opts, exit) {
  onExit = exit;
  // fresh module state — a second session on the same page must not inherit
  // the previous game's phase, peeks, or calibration high-water mark
  myPid = null; myName = ''; joinedCode = null;
  lastState = null; prevPhase = null; played = new Set();
  peekUntil = 0; debriefTools = false; pendingAnswer = null;
  calibRecorded = -1; sessionSaved = false;
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
    <button class="ghost" data-a="stage">Big screen only · just the code, no name</button>
    <button class="ghost" data-a="back">Back</button>
  `);
  const name = () => document.querySelector('#nm').value.trim();
  // return key submits: join if a code is typed, otherwise start a new room
  const submit = () => {
    const code = document.querySelector('#code').value.trim();
    document.querySelector(code ? '[data-a="join"]' : '[data-a="create"]')?.click();
  };
  for (const sel of ['#nm', '#code']) {
    document.querySelector(sel).addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
  }
  bind({
    back: () => onExit(),
    stage: () => {
      const code = document.querySelector('#code').value.trim().toUpperCase();
      if (code.length !== 4) return nameScreen(opts, 'Type the room code, then tap “Big screen” — this device will mirror the game for everyone.');
      location.href = `/?room=${code}&stage=1`;
    },
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
  let rejected = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify(hello));
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'err') {
      if (joinedCode) {
        // mid-game blip: our old socket may still look alive to the server — keep retrying
        render(`<div class="dead-hint">getting your seat back…</div>`, 'dead');
        setTimeout(() => connect({ t: 'join', code: joinedCode, name: myName }, opts), 2000);
      } else {
        rejected = true;
        nameScreen({ ...opts, code: hello.code || '' }, m.msg);
      }
    }
    if (m.t === 'joined') { myPid = m.pid; joinedCode = m.code; history.replaceState(null, '', `/?room=${m.code}`); }
    if (m.t === 'state') { lastState = m.s; offset = m.s.now - Date.now(); paint(m.s); }
  };
  ws.onclose = () => {
    if (!joinedCode) {
      // transport failure before we ever joined (wrong wifi, server asleep) — never strand the player
      if (!rejected) nameScreen({ ...opts, code: hello.code || '' }, "Couldn't reach the room — same wifi as the host?");
      return;
    }
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
    played = new Set();
    peekUntil = 0; debriefTools = false; pendingAnswer = null;
  }
  const fn = SCREENS[s.phase] || (() => render(`<div class="dead-hint">…</div>`, 'dead'));
  fn(s);
}

function onTransition(from, to, s) {
  if (to === 'commit') { audio.buzz(); flashScreen(); }
  if (from === 'debrief') audio.chime(); // cap needs an end signal, not a watched countdown
  if (to === 'stats') harvestStats(s);
}

function cue(name, fn) { if (!played.has(name)) { played.add(name); fn(); } }
function nowS() { return Date.now() + offset; }

// ---------- screens ----------
const SCREENS = {
  lobby(s) {
    // creator runs the lobby; if their phone died, the next player takes over
    const isCreator = s.you?.isCreator || s.players[0]?.connected === false;
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
        <label class="num-label">Rounds
          <input type="number" id="rounds" min="1" max="10" inputmode="numeric" value="${s.settings.rounds}">
        </label>
        <p class="muted center small">A round = everyone takes one turn as the subject.</p>
        <button class="primary" data-a="start" ${s.players.length < 2 ? 'disabled' : ''}>${s.players.length < 2 ? 'Need 2+ players' : 'Start'}</button>`
        : `<p class="muted center small">${s.settings.rounds} round${s.settings.rounds === 1 ? '' : 's'} — waiting for ${esc(s.players[0]?.name || 'the host')} to start…</p>`}
      <button class="ghost" data-a="stage">Turn this device into the big screen<br><span class="small">(then rejoin on your phone — your seat is saved)</span></button>
    `);
    document.querySelector('#rounds')?.addEventListener('change', e => {
      const r = Math.round(Number(e.target.value));
      if (Number.isFinite(r) && r >= 1) act('settings', { rounds: r });
    });
    bind({
      start: () => {
        const r = Math.round(Number(document.querySelector('#rounds')?.value));
        if (Number.isFinite(r) && r >= 1 && r !== s.settings.rounds) act('settings', { rounds: r });
        act('start');
      },
      stage: () => { location.href = `/?room=${s.code}&stage=1`; },
    });
  },

  preview(s) {
    if (s.you?.isSubject && s.probe) {
      const total = Math.max(1, (s.phaseEndsAt - s.phaseStartedAt) / 1000);
      const left = secsLeft(s.phaseEndsAt, offset);
      render(`
        <p class="kicker">${tierLabel(s.probe.tier)} · only you can see this</p>
        <p class="probe-text">${esc(probeText(s.probe.text, s.you.name))}</p>
        <p class="muted small">Keep it and answer honestly — or burn it for a different question. Nobody will know.</p>
        ${timerBar((left ?? 0) / total)}
        <div class="btn-row">
          <button data-a="burn">Burn it</button>
          <button class="primary" data-a="keep">Keep it</button>
        </div>
      `);
      bind({ burn: () => act('burn'), keep: () => act('keep') });
      everyFrame(() => { if (lastState?.phase === 'preview') paintBarOnly(total); }, 250, 'preview');
    } else {
      deadScreen(`${s.subjectName} is choosing a question…`, s);
    }
  },

  commit(s) {
    // one screen for the whole guessing step: the question stays put while the
    // header, buttons and lock counter advance around it
    if (s.you?.isSubject) commitSubject(s);
    else commitPredictor(s);
    everyFrame(() => {
      const st = lastState;
      if (st?.phase !== 'commit' || !st.clockStarted) return;
      const l = secsLeft(st.phaseEndsAt, offset) ?? 0;
      if (l <= 5) cue('t' + l, audio.tick);
      const el = document.querySelector('#cdown');
      if (el) el.textContent = `${l}s`;
    }, 500, 'commit');
  },

  reveal(s) {
    const elapsed = nowS() - s.phaseStartedAt;
    if (elapsed < 3000) {
      const n = 3 - Math.floor(elapsed / 1000);
      cue('c' + n, audio.tick);
      render(`<div class="countdown-huge">${n}</div>`, 'dead');
    } else if (elapsed < 3000 + 7000 || nowS() < peekUntil) {
      cue('sting', audio.sting);
      revealGrid(s);
    } else {
      lookupScreen(s);
    }
    everyFrame(() => { if (lastState?.phase === 'reveal') SCREENS.reveal(lastState); }, 250, 'reveal');
  },

  truth(s) {
    // same grid as the reveal, now carrying the answer, hits and points —
    // the step is "scored", not a new screen
    const mine = s.roundPts?.find(r => r.pid === myPid);
    const tutorial = s.probe?.tutorial;
    const scored = (s.roundPts || []).filter(r => !r.auto && r.correct !== null);
    const hits = scored.filter(r => r.correct).length;
    const byPid = new Map((s.roundPts || []).map(r => [r.pid, r]));
    const rows = (s.commits || []).map(c => {
      const r = byPid.get(c.pid);
      const cls = c.auto ? 'autopass' : r?.correct ? 'hit' : r?.correct === false ? 'miss' : '';
      const mark = c.auto || !r || r.correct === null ? '' : r.correct ? '✓ ' : '✗ ';
      const tail = c.auto ? 'no guess'
        : [c.conf && CONF[c.conf] ? CONF[c.conf].label : null, !tutorial && r ? fmtPts(r.pts) + ' pts' : null].filter(Boolean).join(' · ');
      return `<div class="grid-row ${cls}">
        <span class="name">${mark}${esc(c.name)}</span>
        <span class="ans">${c.auto ? '—' : esc(c.answer)}</span>
        <span class="conf">${tail}</span>
      </div>`;
    }).join('');
    render(`
      <p class="kicker center">${esc(s.subjectName)}'s answer</p>
      <div class="truth-big">${esc(s.truth)}</div>
      ${tutorial ? `<p class="muted center">Warm-up round — no points yet.</p>` : mine ? `
        <div class="pts-huge ${mine.correct ? 'good' : mine.pts < 0 ? 'bad' : ''}">${fmtPts(mine.pts)}</div>
        <p class="muted center small">${mine.auto ? 'Too slow — no guess, no points.' : mine.correct ? 'You guessed right.' : 'You guessed wrong.'}</p>` : `
        <div class="pts-huge ${hits > scored.length / 2 ? 'good' : ''}">${hits}/${scored.length}</div>
        <p class="muted center small">guessed you right</p>`}
      <div class="grid">${rows}</div>
      ${s.flavor && !tutorial ? `<p class="split-flag">${esc(s.flavor)}</p>` : ''}
    `);
  },

  debrief(s) {
    if (!debriefTools) {
      render(`
        <div class="dead-big">PHONES<br>FACE DOWN</div>
        <p class="dead-hint">talk — what made you guess that?<br>whoever guessed differently goes first · ${esc(s.subjectName)} gets the last word</p>
      `, 'dead facedown');
      document.querySelector('#app').onclick = () => {
        if (lastState?.phase !== 'debrief') return;
        debriefTools = true; SCREENS.debrief(lastState);
      };
      return;
    }
    // flipped mid-debrief: faint AR stems — a hint, never a requirement
    const left = secsLeft(s.phaseEndsAt, offset);
    render(`
      <p class="dead-hint">“I noticed…”<br>“I imagined you as someone who…”</p>
      <p class="dead-hint">${left ?? ''}s</p>
      <div class="btn-row">
        <button class="ghost" data-a="ext">+30s — still talking</button>
        <button class="ghost" data-a="end">Next round</button>
      </div>
      <button class="ghost" data-a="down">back face down</button>
      ${s.you?.isCreator || s.players[0]?.connected === false ? `<button class="ghost" data-a="finish">End the game — see results</button>` : ''}
    `, 'dead facedown');
    bind({
      ext: () => act('extendDebrief'),
      end: () => act('endDebrief'),
      down: () => { debriefTools = false; SCREENS.debrief(lastState); },
      finish: () => act('finish'),
    });
    everyFrame(() => { if (lastState?.phase === 'debrief' && debriefTools) SCREENS.debrief(lastState); }, 1000, 'debrief');
  },

  // one screen for the whole vote step: buttons → "vote's in" → the outcome,
  // all inside the same panel
  ballot(s) {
    ballotShell(s.you?.voted
      ? `<p class="muted center">Your vote is in — waiting for the others…</p>`
      : `<button class="primary" data-a="v" data-v="deepen">Go deep · the real stuff</button>
         <button data-a="v" data-v="stay">Not yet · stay spicy</button>`);
    bind({ v: d => act('vote', { v: d.v }) });
  },

  ballotResult(s) {
    const o = s.ballotOutcome || { dir: 'stay', tier: s.tier };
    const line = o.dir === 'deepen' ? `The table goes <b>deep</b>.`
      : `Staying <b>spicy</b> — for now.`;
    ballotShell(`<p class="lookup-msg">${line}</p>${interimLine(s)}`);
  },

  stats(s) {
    render(`
      ${statsCard(s.statsData, { calibration: getCalibration() })}
      <button class="primary" data-a="more">Keep playing · one more round</button>
      <button class="ghost" data-a="leave">Leave</button>
    `);
    bind({ more: () => act('more'), leave: () => { try { ws.close(); } catch {} joinedCode = null; onExit(); } });
  },
};

// ---------- the guessing screen ----------
function commitHead(s, status) {
  return `
    <p class="kicker">${status}</p>
    <p class="probe-text" style="font-size:20px">${esc(probeText(s.probe.text, s.subjectName))}</p>`;
}

function commitStatus(s) {
  if (!s.clockStarted) return `${esc(s.subjectName)} is reading it out loud — guess when you're ready`;
  return `<span id="cdown">${secsLeft(s.phaseEndsAt, offset) ?? 0}s</span> · what will ${esc(s.subjectName)} answer?`;
}

function lockLine(s, extra = '') {
  return `<p class="muted center small">${extra}${s.lockCount ?? 0}/${s.predictorCount} guesses in — phone down till the reveal.</p>`;
}

function commitPredictor(s) {
  const p = s.probe;
  if (s.you.committed) {
    const c = s.you.commit;
    const picked = p.answerType === 'scale'
      ? `<div class="scale-row">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n =>
          `<button class="${c?.answer === String(n) ? 'selected' : ''}" disabled>${n}</button>`).join('')}</div>`
      : `<div class="options">${(p.options || ['Yes', 'No']).map(o =>
          `<button class="${c?.answer === o ? 'selected' : ''}" disabled>${esc(o)}</button>`).join('')}</div>`;
    render(`
      ${commitHead(s, commitStatus(s))}
      ${picked}
      ${lockLine(s, `Locked${c?.conf && CONF[c.conf] ? ' · ' + CONF[c.conf].label : ''} · `)}
      ${skipButton(s)}
    `);
    bind({ skip: () => act('skip') });
    return;
  }
  if (p.answerType === 'scale') {
    // two-step like every other type: pick, then lock — no irreversible mis-taps
    render(`
      ${commitHead(s, commitStatus(s))}
      <p class="muted small">Your guess, 1 to 10 — within one of their number scores points.</p>
      <div class="scale-row">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n =>
        `<button class="${pendingAnswer === String(n) ? 'selected' : ''}" data-a="ans" data-o="${n}">${n}</button>`).join('')}</div>
      ${pendingAnswer !== null ? `<button class="primary" data-a="lock">Lock it in · ${esc(pendingAnswer)}</button>` : ''}
      ${skipButton(s)}
    `);
    bind({
      ans: d => { pendingAnswer = d.o; commitPredictor(lastState); },
      lock: () => act('commit', { answer: pendingAnswer }),
      skip: () => act('skip'),
    });
  } else {
    const opts = p.options || ['Yes', 'No'];
    render(`
      ${commitHead(s, commitStatus(s))}
      <div class="options">
        ${opts.map(o => `<button class="${pendingAnswer === o ? 'selected' : ''}" data-a="ans" data-o="${esc(o)}">${esc(o)}</button>`).join('')}
      </div>
      ${pendingAnswer !== null ? `
        <p class="kicker">how sure are you?</p>
        <div class="conf-list">${confButtons(p)}</div>` : ''}
      ${skipButton(s)}
    `);
    bind({
      ans: d => { pendingAnswer = d.o; commitPredictor(lastState); },
      conf: d => act('commit', { answer: pendingAnswer, conf: d.c }),
      skip: () => act('skip'),
    });
  }
}

function commitSubject(s) {
  if (!s.clockStarted) {
    render(`
      ${commitHead(s, `${tierLabel(s.probe.tier)} · your turn`)}
      <p>Read it out loud to the table.</p>
      <button class="primary" data-a="ready">Everyone heard it — start the countdown</button>
      <p class="muted center small">They can already lock guesses; the countdown starts when you tap.</p>
    `);
    bind({ ready: () => act('ready') });
    return;
  }
  if (s.you.truth === null) {
    render(`
      ${commitHead(s, `<span id="cdown">${secsLeft(s.phaseEndsAt, offset) ?? 0}s</span> · your real answer, honestly`)}
      <p class="muted small">Only you can see this. After everyone locks their guess, you'll say it out loud.</p>
      ${truthInput(s.probe)}
    `);
    bind({ t: d => act('truth', { answer: d.o }) });
    return;
  }
  render(`
    ${commitHead(s, `<span id="cdown">${secsLeft(s.phaseEndsAt, offset) ?? 0}s</span> · waiting for their guesses`)}
    <p class="muted center small">Your answer is in — you'll say it out loud in a moment.</p>
    ${lockLine(s)}
  `);
}

function truthInput(probe) {
  if (probe.answerType === 'scale') return scaleRow('t');
  const opts = probe.options || ['Yes', 'No'];
  return `<div class="options">${opts.map(o => `<button data-a="t" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
}

function ballotShell(body) {
  render(`
    <p class="kicker center">secret vote</p>
    <p class="center">Ready to go deeper?<br>
      <span class="muted small">Deep = confessions, secrets, who-at-this-table questions.</span></p>
    ${body}
    <p class="ballot-note">Majority decides; nobody sees the votes. Any question can still be burned.</p>
  `);
}

function interimLine(s) {
  const i = s.interim;
  if (!i) return '';
  const parts = [];
  if (i.oracle) parts.push(`best reader: ${esc(i.oracle)}`);
  if (i.openBook) parts.push(`open book: ${esc(i.openBook)}`);
  if (i.enigma) parts.push(`hardest to read: ${esc(i.enigma)}`);
  return parts.length ? `<p class="muted center small">So far — ${parts.join(' · ')}</p>` : '';
}

// ---------- reveal sub-screens ----------
function revealGrid(s) {
  const rows = (s.commits || []).map(c => `
    <div class="grid-row ${c.auto ? 'autopass' : ''}">
      <span class="name">${esc(c.name)}</span>
      <span class="ans">${c.auto ? '—' : esc(c.answer)}</span>
      <span class="conf">${c.auto ? 'no guess' : c.conf ? CONF[c.conf].label : ''}</span>
    </div>`).join('');
  render(`
    <p class="kicker center">everyone's guesses</p>
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
    <p class="lookup-msg">Look up.<br>${s.you?.isSubject ? 'Tell them your real answer.' : `${esc(s.subjectName)}, say your real answer out loud.`}</p>
    ${s.you?.isSubject ? subjectConfirm(s) : '<p class="dead-hint">tap to see the guesses again</p>'}
    ${skipButton(s)}
  `, 'dead');
  bind({
    confirm: () => act('confirmTruth'),
    t: d => act('truth', { answer: d.o }),
    skip: () => act('skip'),
  });
  if (!s.you?.isSubject) {
    document.querySelector('#app').onclick = () => {
      if (lastState?.phase !== 'reveal') return;
      peekUntil = nowS() + 3000; SCREENS.reveal(lastState);
    };
  }
}

function subjectConfirm(s) {
  if (!s.you?.isSubject) return '';
  if (!s.truthIn) {
    return `<p class="kicker">first — your real answer:</p>${truthInput(s.probe)}`;
  }
  return `<button class="primary" data-a="confirm">I've told them — reveal “${esc(s.you.truth)}”</button>`;
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
  if (s && s.subjectConnected === false && ['preview', 'commit', 'reveal'].includes(s.phase)) {
    return `<button class="ghost" data-a="skip">${esc(s.subjectName)} dropped — skip this round</button>`;
  }
  return '';
}

function paintBarOnly(total) {
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
