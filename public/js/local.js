// Local mode — one shared phone, pass-and-play, any number of players (2+).
// The dyad engine generalized: every predictor takes the phone in turn and
// commits privately (answer + confidence), so full scoring survives without a
// network. Two players unlock Tier 5 (the Vault) with scale and free-form
// probes; bigger groups play the table deck — relational probes included —
// capped at Tier 4.

import { render, bind, esc, probeText, everyFrame, clearTickers, timerBar, tierLabel, tierTagline, TIER_NAMES } from './util.js';
import { CONF, CONF_ORDER, scoreChoice, scoreScale, GRADES, GRADE_ORDER } from './scoring.js';
import { computeStats, roundFlavor, interimStats } from './stats.js';
import { statsCard } from './statsview.js';
import { loadDeck, draw } from './deck.js';
import * as audio from './audio.js';
import { recordCalibration, saveSession, getCalibration } from './storage.js';

const DEBRIEF_SEC = 75, REPLY_SEC = 30;

let S = null, deck = null, onExit = null;

export async function startLocal(exit) {
  onExit = exit;
  deck = await loadDeck();
  setup();
}

function setup() {
  clearTickers();
  S = { players: [], tier: 1, round: 0, scored: 0, sinceBallot: 0, subjectIdx: -1, used: new Set(), history: [], votes: [] };
  const paint = (msg = '') => {
    render(`
      <p class="kicker">local · one phone, pass it around</p>
      <div class="player-list">${S.players.map(p => `<div class="player-row"><span>${esc(p.name)}</span></div>`).join('')}</div>
      <input type="text" id="nm" placeholder="Add a first name" maxlength="16" autocomplete="off">
      ${msg ? `<p class="small" style="color:var(--bad)">${esc(msg)}</p>` : ''}
      <div class="btn-row">
        <button data-a="add">Add</button>
        <button class="primary" data-a="go" ${S.players.length < 2 ? 'disabled' : ''}>Start</button>
      </div>
      <p class="muted small center">${S.players.length === 2 ? 'Two players — tiers go all the way to the Vault.' : S.players.length > 2 ? 'Group game — tiers go to Confession.' : 'Two players go deepest; any number works.'}</p>
      <button class="ghost" data-a="back">Back</button>
    `);
    bind({
      back: () => onExit(),
      add: () => {
        const n = document.querySelector('#nm').value.trim();
        if (!n) return;
        if (S.players.some(p => p.name.toLowerCase() === n.toLowerCase())) return paint('Names must differ.');
        S.players.push({ id: S.players.length, name: n });
        paint();
      },
      go: () => {
        audio.unlock();
        S.n = S.players.length;
        S.roundsTotal = S.n <= 2 ? 10 : 2 * S.n;
        S.ballotEvery = S.n <= 2 ? 3 : S.n;
        S.tierCap = S.n <= 2 ? 5 : 4;
        S.deckMode = S.n <= 2 ? 'dyad' : 'table';
        startRound();
      },
    });
  };
  paint();
}

const subject = () => S.players[S.subjectIdx];
const predictors = () => S.players.filter((_, i) => i !== S.subjectIdx);

function drawNext() {
  const probe = draw(deck, { tier: S.round === 0 ? 0 : S.tier, mode: S.deckMode, used: S.used });
  if (probe.answerType === 'relational') probe.options = predictors().map(p => p.name);
  return probe;
}

function startRound() {
  S.subjectIdx = (S.subjectIdx + 1) % S.n;
  S.commits = []; S.truth = null;
  S.probe = drawNext();
  passScreen(subject().name, `This round is about ${subject().name} — they see the question first.`, previewScreen);
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
  let deadline = Date.now() + 5000;
  const keep = () => { clearTickers(); toPredictor(0); };
  const paint = () => {
    const left = Math.max(0, (deadline - Date.now()) / 1000);
    render(`
      <p class="kicker">${tierLabel(S.probe.tier)} · only you can see this</p>
      <p class="probe-text">${esc(probeText(S.probe.text, subject().name))}</p>
      <p class="muted small">Keep it and answer honestly — or burn it for a different question. Nobody will know.</p>
      ${timerBar(left / 5)}
      <div class="btn-row">
        <button data-a="burn">Burn it</button>
        <button class="primary" data-a="keep">Keep it</button>
      </div>
    `);
    bind({
      burn: () => { S.probe = drawNext(); deadline = Date.now() + 5000; paint(); },
      keep,
    });
  };
  paint();
  everyFrame(() => {
    if (Date.now() >= deadline) keep();
    else { const f = document.querySelector('.bar-fill'); if (f) f.style.width = `${((deadline - Date.now()) / 50)}%`; }
  }, 200);
}

function toPredictor(i) {
  const preds = predictors();
  if (i >= preds.length) return passScreen(subject().name, 'Everyone has guessed. Enter your real answer — then you all look together.', truthScreen);
  passScreen(preds[i].name, 'Your turn to guess — nobody else sees your screen.', () => predictScreen(i));
}

function predictScreen(i) {
  clearTickers();
  const p = S.probe;
  const who = predictors()[i];
  const next = commit => { S.commits.push({ pid: who.id, name: who.name, ...commit }); toPredictor(i + 1); };
  const head = `
    <p class="kicker">${tierLabel(p.tier)} · ${esc(who.name)} — what will ${esc(subject().name)} answer?</p>
    <p class="probe-text" style="font-size:22px">${esc(probeText(p.text, subject().name))}</p>`;

  if (p.answerType === 'scale') {
    render(`${head}<p class="muted small">Your guess, 1 to 10:</p>${scaleButtons('ans')}`);
    bind({ ans: d => next({ value: Number(d.v) }) });
  } else if (p.answerType === 'freeform') {
    render(`${head}
      <textarea id="ff" placeholder="One sentence — your best guess at their answer."></textarea>
      <button class="primary" data-a="lock">Lock it in</button>`);
    bind({ lock: () => {
      const t = document.querySelector('#ff').value.trim();
      if (t) next({ text: t });
    } });
  } else {
    let chosen = null;
    const paint = () => {
      render(`${head}
        <div class="options">${p.options.map(o => `<button class="${chosen === o ? 'selected' : ''}" data-a="ans" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>
        ${chosen !== null ? `<p class="kicker">how sure are you?</p>
        <div class="conf-row">${CONF_ORDER.map(c => `<button data-a="conf" data-c="${c}">${CONF[c].label}</button>`).join('')}</div>
        <p class="muted small center">Surer = more points if right, fewer if wrong. Pass = safe either way.</p>` : ''}`);
      bind({
        ans: d => { chosen = d.o; paint(); },
        conf: d => next({ answer: chosen, conf: d.c }),
      });
    };
    paint();
  }
}

function truthScreen() {
  const p = S.probe;
  const head = `
    <p class="kicker">${esc(subject().name)} — your real answer, honestly</p>
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

  if (p.answerType === 'freeform') { // n=2 only
    const pred = S.commits[0];
    render(`
      <p class="kicker center">look together</p>
      <div class="panel"><p class="small muted">${esc(pred.name)} guessed:</p><p>${esc(pred.text)}</p></div>
      <div class="panel"><p class="small muted">${esc(subject().name)} really answered:</p><p>${esc(S.truth.text)}</p></div>
      <p class="kicker center">${esc(subject().name)} — how close was the guess?</p>
      <div class="conf-row">${GRADE_ORDER.map(g => `<button data-a="g" data-g="${g}">${g[0].toUpperCase() + g.slice(1)} · ${GRADES[g]}</button>`).join('')}</div>
    `);
    bind({ g: d => {
      recordRound([{ ...pred, answer: pred.text, conf: null, p: null, correct: GRADES[d.g] >= 75, pts: GRADES[d.g] }]);
      debriefScreen();
    } });
    return;
  }

  const k = p.options && p.options.length > 2 ? p.options.length : 2;
  const scored = S.commits.map(c => {
    if (p.answerType === 'scale') {
      const correct = Math.abs(c.value - S.truth.value) <= 1;
      return { ...c, answer: String(c.value), conf: null, p: null, correct, pts: S.round === 0 ? 0 : scoreScale(c.value, S.truth.value) };
    }
    const correct = c.answer === S.truth.answer;
    return { ...c, conf: c.conf, p: CONF[c.conf].p, correct, pts: S.round === 0 ? 0 : scoreChoice(c.conf, correct, k) };
  });
  const flavor = recordRound(scored);
  const truthShown = S.truth.answer ?? S.truth.value;
  render(`
    <p class="kicker center">put the phone where everyone can see</p>
    <p class="muted center small">${esc(subject().name)}'s real answer:</p>
    <div class="truth-big" style="font-size:30px">${esc(String(truthShown))}</div>
    <p class="kicker center">the guesses</p>
    <div class="grid">
      ${scored.map(c => `
        <div class="grid-row ${c.correct ? 'hit' : 'miss'}">
          <span class="name">${c.correct ? '✓' : '✗'} ${esc(c.name)}</span>
          <span class="ans">${esc(c.answer)}</span>
          <span class="conf">${[c.conf && CONF[c.conf].label, S.round > 0 && '+' + c.pts + ' pts'].filter(Boolean).join(' · ')}</span>
        </div>`).join('')}
    </div>
    ${S.round === 0 ? '<p class="muted center">Warm-up round — no points yet.</p>' : ''}
    ${flavor ? `<p class="split-flag">${esc(flavor)}</p>` : ''}
    <button class="primary" data-a="next">Put the phone down — talk it over</button>
  `);
  bind({ next: () => debriefScreen() });
}

function recordRound(scored) {
  if (S.round === 0) return null;
  S.history.push({
    round: S.round, tier: S.probe.tier, text: probeText(S.probe.text, subject().name),
    subjectId: subject().id, subjectName: subject().name,
    truth: S.truth.answer ?? S.truth.value ?? S.truth.text,
    preds: scored.map(c => ({ pid: c.pid, name: c.name, answer: c.answer, conf: c.conf || null, p: c.p ?? null, auto: false, correct: c.correct, pts: c.pts })),
  });
  S.scored += 1; S.sinceBallot += 1;
  return roundFlavor(S.history);
}

function debriefScreen() {
  const endsAt = { t: Date.now() + DEBRIEF_SEC * 1000 };
  let done = false;
  const finish = () => { if (done) return; done = true; clearTickers(); audio.chime(); replyScreen(); };
  render(`
    <p class="dead-hint">“I noticed…” · “I imagined you as someone who…”</p>
    <div class="dead-big">TALK</div>
    <p class="dead-hint" id="dleft">${DEBRIEF_SEC}s · what made you guess that?</p>
    <div class="btn-row">
      <button class="ghost" data-a="ext">+30s</button>
      <button class="ghost" data-a="end">End early</button>
    </div>
  `, 'dead facedown');
  bind({ ext: () => { endsAt.t += 30_000; }, end: finish });
  everyFrame(() => {
    if (Date.now() >= endsAt.t) finish();
    else { const h = document.querySelector('#dleft'); if (h) h.textContent = `${Math.ceil((endsAt.t - Date.now()) / 1000)}s · what made you guess that?`; }
  }, 500);
}

function replyScreen() {
  clearTickers();
  const endsAt = { t: Date.now() + REPLY_SEC * 1000 };
  let done = false;
  const finish = () => { if (done) return; done = true; clearTickers(); nextOrBallot(); };
  render(`
    <p class="kicker">${esc(subject().name)} — the last word is yours</p>
    <p class="muted">Did they get you right? Correct anything before the next round.</p>
    <button class="ghost" data-a="more">“It's more complicated” · talk 60s more</button>
    <button class="primary" data-a="done">Next round</button>
  `);
  bind({ more: () => { endsAt.t += 60_000; }, done: finish });
  everyFrame(() => { if (Date.now() >= endsAt.t) finish(); }, 500);
}

function nextOrBallot() {
  if (S.round === 0) { S.round = 1; return startRound(); }
  S.round += 1;
  if (S.sinceBallot >= S.ballotEvery) { S.sinceBallot = 0; S.votes = []; return ballotPass(0); }
  if (S.scored >= S.roundsTotal) return statsScreen();
  startRound();
}

// Ballot — the phone passes; nobody ever sees anyone's vote, only the outcome.
function ballotPass(i) {
  passScreen(S.players[i].name, 'Time to vote: should the questions get deeper? Your vote is secret.', () => ballotVote(i));
}
function ballotVote(i) {
  render(`
    <p class="kicker center">secret vote · how deep should the questions go?</p>
    <p class="center">You're at <b>${tierLabel(S.tier)}</b><br>
      <span class="muted small">${esc(tierTagline(S.tier))}</span></p>
    <button class="primary" data-a="v" data-v="deepen">Deeper${S.tier >= S.tierCap ? '' : ` · ${TIER_NAMES[S.tier + 1]}`}</button>
    <button data-a="v" data-v="stay">Stay here · ${TIER_NAMES[S.tier]}</button>
    <button data-a="v" data-v="retreat">Lighter${S.tier > 1 ? ` · ${TIER_NAMES[S.tier - 1]}` : ''}</button>
    <p class="ballot-note">Deeper only happens if everyone votes for it. Nobody sees votes — only the result.</p>
  `);
  bind({ v: d => {
    S.votes.push(d.v);
    if (i < S.n - 1) ballotPass(i + 1); else resolveBallot();
  } });
}
function resolveBallot() {
  let dir = 'deepen';
  if (S.votes.includes('retreat')) dir = 'retreat';
  else if (S.votes.includes('stay')) dir = 'stay';
  let line;
  if (dir === 'retreat') { S.tier = Math.max(1, S.tier - 1); line = `The questions get lighter:<br><b>${tierLabel(S.tier)}</b>.`; }
  else if (dir === 'stay') { line = `The questions stay at<br><b>${tierLabel(S.tier)}</b>.`; }
  else if (S.tier >= S.tierCap) {
    line = S.n <= 2 ? `You stay in <b>${tierLabel(S.tier)}</b> — there is nothing deeper.`
      : `Deeper than Tier 4 is for pairs. Find a corner — two people, this phone.`;
  } else { S.tier += 1; line = `The questions get deeper:<br><b>${tierLabel(S.tier)}</b>.`; }
  const i = interimStats(S.history, S.players);
  const parts = [];
  if (i.oracle) parts.push(`best reader: ${esc(i.oracle)}`);
  if (i.openBook) parts.push(`open book: ${esc(i.openBook)}`);
  if (i.enigma) parts.push(`hardest to read: ${esc(i.enigma)}`);
  render(`
    <p class="lookup-msg">${line}</p>
    ${parts.length ? `<p class="muted center small">So far — ${parts.join(' · ')}</p>` : ''}
    <button class="ghost" data-a="go">Continue</button>
  `, 'dead');
  bind({ go: () => (S.scored >= S.roundsTotal ? statsScreen() : startRound()) });
}

function statsScreen() {
  clearTickers();
  const st = computeStats(S.history, S.players, false);
  // per-device calibration: everyone predicted on this phone tonight
  recordCalibration(S.history.flatMap(h => h.preds.filter(p => p.conf).map(p => ({ conf: p.conf, correct: p.correct }))));
  saveSession({ mode: 'local', rounds: S.scored, players: S.players.map(p => p.name) });
  render(`
    ${statsCard(st, { calibration: getCalibration(), title: 'the box opens' })}
    <button class="primary" data-a="more">Keep playing · ${S.n <= 2 ? '2 more rounds' : 'one more round each'}</button>
    <button class="ghost" data-a="done">Done</button>
  `);
  bind({
    more: () => { S.roundsTotal += S.n <= 2 ? 2 : S.n; startRound(); },
    done: () => onExit(),
  });
}

function scaleButtons(action) {
  return `<div class="scale-row">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button data-a="${action}" data-v="${n}">${n}</button>`).join('')}</div>`;
}
