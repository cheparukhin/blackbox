// Dyad mode — pure client-side, single phone, pass-and-play. Zero connectivity.

import { render, bind, esc, probeText, everyFrame, clearTickers, secsLeft, timerBar, tierLabel } from './util.js';
import { CONF, CONF_ORDER, scoreChoice, scoreScale, GRADES, GRADE_ORDER } from './scoring.js';
import { computeStats } from './stats.js';
import { statsCard } from './statsview.js';
import { loadDeck, draw } from './deck.js';
import * as audio from './audio.js';
import { recordCalibration, saveSession, getCalibration } from './storage.js';

const DEBRIEF_SEC = 75, REPLY_SEC = 30, ROUNDS = 10, BALLOT_EVERY = 3;

let S = null; // session state
let onExit = null;
let deck = null;

export async function startDyad(exit) {
  onExit = exit;
  deck = await loadDeck();
  setup();
}

function setup() {
  clearTickers();
  render(`
    <p class="kicker">dyad mode · one phone, two people</p>
    <input type="text" id="a" placeholder="Player A — first name" maxlength="16" autocomplete="off">
    <input type="text" id="b" placeholder="Player B — first name" maxlength="16" autocomplete="off">
    <p class="muted small">Ten rounds, roles alternate. Tiers go to 5 — the Vault — if you both keep voting to deepen.</p>
    <button class="primary" data-a="go">Begin</button>
    <button class="ghost" data-a="back">Back</button>
  `);
  bind({
    back: () => onExit(),
    go: () => {
      audio.unlock();
      const a = document.querySelector('#a').value.trim() || 'A';
      const b = document.querySelector('#b').value.trim() || 'B';
      S = {
        players: [{ id: 0, name: a }, { id: 1, name: b }],
        tier: 1, round: 0, // round 0 = tutorial
        roundsTotal: ROUNDS, scored: 0, sinceBallot: 0,
        subjectIdx: 1, used: new Set(), history: [],
        prediction: null, truth: null, votes: [],
      };
      startRound();
    },
  });
}

const subject = () => S.players[S.subjectIdx];
const predictor = () => S.players[1 - S.subjectIdx];

function startRound() {
  S.subjectIdx = 1 - S.subjectIdx;
  S.prediction = null; S.truth = null;
  S.probe = draw(deck, { tier: S.round === 0 ? 0 : S.tier, mode: 'dyad', used: S.used });
  passScreen(subject().name, 'A probe is waiting — you get first look.', previewScreen);
}

function passScreen(name, note, next) {
  clearTickers();
  render(`
    <p class="lookup-msg">Pass the phone to<br><b>${esc(name)}</b></p>
    <p class="dead-hint">${esc(note)}</p>
    <button data-a="here">I'm ${esc(name)}</button>
  `, 'dead');
  bind({ here: () => next() });
}

function previewScreen() {
  // 5s burn window; burning is visible at n=2 and that's fine
  let deadline = Date.now() + 5000;
  const paint = () => {
    const left = Math.max(0, (deadline - Date.now()) / 1000);
    render(`
      <p class="kicker">${tierLabel(S.probe.tier)} · your eyes only</p>
      <p class="probe-text">${esc(probeText(S.probe.text, subject().name))}</p>
      ${timerBar(left / 5)}
      <div class="btn-row">
        <button data-a="burn">Burn</button>
        <button class="primary" data-a="keep">Keep it</button>
      </div>
    `);
    bind({
      burn: () => { S.probe = draw(deck, { tier: S.round === 0 ? 0 : S.tier, mode: 'dyad', used: S.used }); deadline = Date.now() + 5000; paint(); },
      keep: () => keep(),
    });
  };
  const keep = () => { clearTickers(); passScreen(predictor().name, 'Time to read your human.', predictScreen); };
  paint();
  everyFrame(() => { if (Date.now() >= deadline) keep(); else { const f = document.querySelector('.bar-fill'); if (f) f.style.width = `${((deadline - Date.now()) / 50)}%`; } }, 200);
}

function predictScreen() {
  clearTickers();
  const p = S.probe;
  const head = `
    <p class="kicker">${tierLabel(p.tier)} · predict ${esc(subject().name)}</p>
    <p class="probe-text" style="font-size:22px">${esc(probeText(p.text, subject().name))}</p>`;

  if (p.answerType === 'scale') {
    render(`${head}<p class="muted small">Your read, 1–10:</p>${scaleButtons('ans')}`);
    bind({ ans: d => { S.prediction = { value: Number(d.v) }; toTruth(); } });
  } else if (p.answerType === 'freeform') {
    render(`${head}
      <textarea id="ff" placeholder="One sentence — your best read."></textarea>
      <button class="primary" data-a="lock">Lock it in</button>`);
    bind({ lock: () => {
      const t = document.querySelector('#ff').value.trim();
      if (t) { S.prediction = { text: t }; toTruth(); }
    } });
  } else {
    let chosen = null;
    const paint = () => {
      render(`${head}
        <div class="options">${p.options.map(o => `<button class="${chosen === o ? 'selected' : ''}" data-a="ans" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>
        ${chosen !== null ? `<p class="kicker">how sure?</p><div class="conf-row">${CONF_ORDER.map(c => `<button data-a="conf" data-c="${c}">${CONF[c].label}</button>`).join('')}</div>` : ''}`);
      bind({
        ans: d => { chosen = d.o; paint(); },
        conf: d => { S.prediction = { answer: chosen, conf: d.c }; toTruth(); },
      });
    };
    paint();
  }
}

function toTruth() { passScreen(subject().name, 'Enter your true answer — then you both look together.', truthScreen); }

function truthScreen() {
  const p = S.probe;
  const head = `
    <p class="kicker">your true answer</p>
    <p class="probe-text" style="font-size:22px">${esc(probeText(p.text, subject().name))}</p>`;
  if (p.answerType === 'scale') {
    render(`${head}${scaleButtons('t')}`);
    bind({ t: d => { S.truth = { value: Number(d.v) }; revealScreen(); } });
  } else if (p.answerType === 'freeform') {
    render(`${head}
      <textarea id="ff" placeholder="The true answer, in your words."></textarea>
      <button class="primary" data-a="lock">Done — reveal together</button>`);
    bind({ lock: () => {
      const t = document.querySelector('#ff').value.trim();
      if (t) { S.truth = { text: t }; revealScreen(); }
    } });
  } else {
    render(`${head}<div class="options">${p.options.map(o => `<button data-a="t" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>`);
    bind({ t: d => { S.truth = { answer: d.o }; revealScreen(); } });
  }
}

function revealScreen() {
  audio.sting();
  const p = S.probe;
  const pred = S.prediction, tr = S.truth;

  if (p.answerType === 'freeform') {
    render(`
      <p class="kicker center">both of you — look</p>
      <div class="panel"><p class="small muted">${esc(predictor().name)} imagined:</p><p>${esc(pred.text)}</p></div>
      <div class="panel"><p class="small muted">${esc(subject().name)} answered:</p><p>${esc(tr.text)}</p></div>
      <p class="kicker center">${esc(subject().name)} — how close?</p>
      <div class="conf-row">${GRADE_ORDER.map(g => `<button data-a="g" data-g="${g}">${g[0].toUpperCase() + g.slice(1)} · ${GRADES[g]}</button>`).join('')}</div>
    `);
    bind({ g: d => finishRound({ pts: GRADES[d.g], correct: GRADES[d.g] >= 75, detail: d.g }) });
    return;
  }

  let pts, correct, line;
  if (p.answerType === 'scale') {
    pts = scoreScale(pred.value, tr.value);
    correct = Math.abs(pred.value - tr.value) <= 1;
    line = `${esc(predictor().name)} guessed <b>${pred.value}</b> · truth: <b>${tr.value}</b>`;
  } else {
    correct = pred.answer === tr.answer;
    pts = S.round === 0 ? 0 : scoreChoice(pred.conf, correct, p.options.length > 2 ? p.options.length : 2);
    line = `${esc(predictor().name)}: <b>${esc(pred.answer)}</b> · ${CONF[pred.conf].label} &nbsp;—&nbsp; truth: <b>${esc(tr.answer)}</b>`;
  }
  render(`
    <p class="kicker center">both of you — look</p>
    <p class="center" style="font-size:20px">${line}</p>
    ${S.round === 0 ? '<p class="muted center">Warm-up — no points.</p>' : `<div class="pts-huge ${correct ? 'good' : ''}">+${pts}</div>`}
    <button class="primary" data-a="next">Phone down — debrief</button>
  `);
  bind({ next: () => finishRound({ pts, correct }) });
}

function finishRound({ pts, correct, detail }) {
  if (S.round > 0) {
    const p = S.probe, pred = S.prediction;
    S.history.push({
      round: S.round, tier: p.tier, text: probeText(p.text, subject().name),
      subjectId: subject().id, subjectName: subject().name,
      truth: S.truth.answer ?? S.truth.value ?? S.truth.text,
      preds: [{
        pid: predictor().id, name: predictor().name,
        answer: pred.answer ?? pred.value ?? pred.text,
        conf: pred.conf || null, p: pred.conf ? CONF[pred.conf].p : null,
        auto: false, correct, pts,
      }],
    });
    S.scored += 1; S.sinceBallot += 1;
  }
  debriefScreen();
}

function debriefScreen() {
  const endsAt = { t: Date.now() + DEBRIEF_SEC * 1000 };
  let done = false;
  const finish = () => { if (done) return; done = true; clearTickers(); audio.chime(); replyScreen(); };
  const paint = () => {
    render(`
      <p class="dead-hint">“I noticed…” · “I imagined you as someone who…”</p>
      <div class="dead-big">TALK</div>
      <p class="dead-hint">${Math.max(0, Math.ceil((endsAt.t - Date.now()) / 1000))}s · predictor explains what they saw</p>
      <div class="btn-row">
        <button class="ghost" data-a="ext">+30s</button>
        <button class="ghost" data-a="end">End early</button>
      </div>
    `, 'dead facedown');
    bind({ ext: () => { endsAt.t += 30_000; }, end: finish });
  };
  paint();
  everyFrame(() => {
    if (Date.now() >= endsAt.t) finish();
    else { const h = document.querySelectorAll('.dead-hint')[1]; if (h) h.textContent = `${Math.ceil((endsAt.t - Date.now()) / 1000)}s · predictor explains what they saw`; }
  }, 500);
}

function replyScreen() {
  clearTickers();
  const endsAt = { t: Date.now() + REPLY_SEC * 1000 };
  let done = false;
  const finish = () => { if (done) return; done = true; clearTickers(); nextOrBallot(); };
  render(`
    <p class="kicker">${esc(subject().name)} — right of reply</p>
    <p class="muted">Anything they got wrong about how they got it right?</p>
    <button class="ghost" data-a="more">“It's more complicated” · +60s</button>
    <button class="primary" data-a="done">Next round</button>
  `);
  bind({ more: () => { endsAt.t += 60_000; }, done: finish });
  everyFrame(() => { if (Date.now() >= endsAt.t) finish(); }, 500);
}

function nextOrBallot() {
  if (S.scored >= S.roundsTotal) return statsScreen();
  if (S.round === 0) { S.round = 1; return startRound(); }
  S.round += 1;
  if (S.sinceBallot >= BALLOT_EVERY) { S.sinceBallot = 0; S.votes = []; return ballotPass(0); }
  startRound();
}

// Ballot — the phone passes; nobody ever sees the other's vote.
function ballotPass(i) {
  passScreen(S.players[i].name, 'Secret ballot — your vote only.', () => ballotVote(i));
}
function ballotVote(i) {
  render(`
    <p class="kicker center">secret ballot · only outcomes are shown</p>
    <p class="center">You're at <b>${tierLabel(S.tier)}</b>.</p>
    <button class="primary" data-a="v" data-v="deepen">Deepen</button>
    <button data-a="v" data-v="stay">Stay</button>
    <button data-a="v" data-v="retreat">Retreat</button>
  `);
  bind({ v: d => {
    S.votes.push(d.v);
    if (i === 0) ballotPass(1); else resolveBallot();
  } });
}
function resolveBallot() {
  let dir = 'deepen';
  if (S.votes.includes('retreat')) dir = 'retreat';
  else if (S.votes.includes('stay')) dir = 'stay';
  if (dir === 'retreat') S.tier = Math.max(1, S.tier - 1);
  if (dir === 'deepen') S.tier = Math.min(5, S.tier + 1);
  const line = dir === 'deepen' ? `You deepen to <b>${tierLabel(S.tier)}</b>.`
    : dir === 'retreat' ? `You ease back to <b>${tierLabel(S.tier)}</b>.`
    : `You stay at <b>${tierLabel(S.tier)}</b>.`;
  render(`<p class="lookup-msg">${line}</p><button class="ghost" data-a="go">Continue</button>`, 'dead');
  bind({ go: () => startRound() });
}

function statsScreen() {
  clearTickers();
  const st = computeStats(S.history, S.players, false);
  // per-device calibration: both players predicted on this phone tonight
  recordCalibration(S.history.flatMap(h => h.preds.filter(p => p.conf).map(p => ({ conf: p.conf, correct: p.correct }))));
  saveSession({ mode: 'dyad', rounds: S.scored, players: S.players.map(p => p.name) });
  render(`
    ${statsCard(st, { calibration: getCalibration(), title: 'the box opens' })}
    <button class="primary" data-a="more">Keep going · 2 more rounds</button>
    <button class="ghost" data-a="done">Done</button>
  `);
  bind({
    more: () => { S.roundsTotal += 2; startRound(); },
    done: () => onExit(),
  });
}

function scaleButtons(action) {
  return `<div class="scale-row">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button data-a="${action}" data-v="${n}">${n}</button>`).join('')}</div>`;
}
