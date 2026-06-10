// Offline fallback table — one shared phone, commitment is physical:
// probe + 3-2-1 countdown, everyone reveals thumbs simultaneously on zero,
// subject states truth aloud, someone taps in results. Same round shape,
// COMMIT screen swapped for bodies.

import { render, bind, esc, probeText, everyFrame, clearTickers, tierLabel } from './util.js';
import { computeStats } from './stats.js';
import { statsCard } from './statsview.js';
import { scoreChoice } from './scoring.js';
import { loadDeck, draw } from './deck.js';
import * as audio from './audio.js';

const DEBRIEF_SEC = 90;

let S = null, deck = null, onExit = null;

export async function startFallback(exit) {
  onExit = exit;
  deck = await loadDeck();
  setup();
}

function setup() {
  clearTickers();
  S = { names: [], tier: 1, round: 0, roundsTotal: 12, scored: 0, sinceBallot: 0, subjectIdx: -1, used: new Set(), history: [], votes: [] };
  const paint = (msg = '') => {
    render(`
      <p class="kicker">offline table · one phone</p>
      <p class="muted small">Thumbs up/down on zero; 1–4 fingers for multiple choice. The phone is just the deck and the clock.</p>
      <div class="player-list">${S.names.map(n => `<div class="player-row"><span>${esc(n)}</span></div>`).join('')}</div>
      <input type="text" id="nm" placeholder="Add a first name" maxlength="16" autocomplete="off">
      ${msg ? `<p class="small" style="color:var(--bad)">${esc(msg)}</p>` : ''}
      <div class="btn-row">
        <button data-a="add">Add</button>
        <button class="primary" data-a="go" ${S.names.length < 3 ? 'disabled' : ''}>Start</button>
      </div>
      <button class="ghost" data-a="back">Back</button>
    `);
    bind({
      back: () => onExit(),
      add: () => {
        const n = document.querySelector('#nm').value.trim();
        if (!n) return;
        if (S.names.length >= 6) return paint('Six max.');
        if (S.names.some(x => x.toLowerCase() === n.toLowerCase())) return paint('Names must differ.');
        S.names.push(n); paint();
      },
      go: () => { audio.unlock(); startRound(); },
    });
  };
  paint();
}

const subjName = () => S.names[S.subjectIdx];

function startRound() {
  clearTickers();
  S.subjectIdx = (S.subjectIdx + 1) % S.names.length;
  S.probe = draw(deck, { tier: S.round === 0 ? 0 : S.tier, mode: 'table', used: S.used, allowTypes: ['binary', 'overunder', 'mc4'] });
  render(`
    <p class="lookup-msg">Hand the phone to<br><b>${esc(subjName())}</b></p>
    <p class="dead-hint">private preview — burn freely</p>
    <button data-a="here">I'm ${esc(subjName())}</button>
  `, 'dead');
  bind({ here: preview });
}

function preview() {
  render(`
    <p class="kicker">${tierLabel(S.probe.tier)} · your eyes only</p>
    <p class="probe-text">${esc(probeText(S.probe.text, subjName()))}</p>
    <div class="btn-row">
      <button data-a="burn">Burn</button>
      <button class="primary" data-a="keep">Keep it</button>
    </div>
  `);
  bind({
    burn: () => { S.probe = draw(deck, { tier: S.round === 0 ? 0 : S.tier, mode: 'table', used: S.used, allowTypes: ['binary', 'overunder', 'mc4'] }); preview(); },
    keep: probeScreen,
  });
}

function probeScreen() {
  const p = S.probe;
  const fingers = p.options.length > 2 ? `<p class="muted small">${p.options.map((o, i) => `${i + 1} = ${esc(o)}`).join(' · ')}</p>` : '';
  render(`
    <p class="kicker">${tierLabel(p.tier)}</p>
    <p class="probe-text">${esc(probeText(p.text, subjName()))}</p>
    ${fingers}
    <p class="muted">${esc(subjName())}, read it out. ${p.options.length > 2 ? 'Fingers' : 'Thumbs'} ready — reveal on zero.</p>
    <button class="primary" data-a="count">Start the countdown</button>
  `);
  bind({ count: countdown });
}

function countdown() {
  let n = 3;
  const step = () => {
    if (n > 0) {
      audio.tick();
      render(`<div class="countdown-huge">${n}</div>`, 'dead');
      n -= 1;
    } else {
      clearTickers();
      audio.sting();
      render(`<div class="countdown-huge" style="font-size:64px">REVEAL</div><p class="dead-hint">hold them up — look around the table</p>
        <button data-a="next">Now — ${esc(subjName())}, the truth</button>`, 'dead');
      bind({ next: truthScreen });
    }
  };
  step();
  everyFrame(step, 1000);
}

function truthScreen() {
  const p = S.probe;
  render(`
    <p class="kicker">${esc(subjName())} says it out loud, then taps it</p>
    <p class="probe-text" style="font-size:20px">${esc(probeText(p.text, subjName()))}</p>
    <div class="options">${p.options.map(o => `<button data-a="t" data-o="${esc(o)}">${esc(o)}</button>`).join('')}</div>
  `);
  bind({ t: d => resultsScreen(d.o) });
}

function resultsScreen(truth) {
  const preds = S.names.filter((_, i) => i !== S.subjectIdx);
  const right = new Set();
  const paint = () => {
    render(`
      <p class="kicker">truth: ${esc(truth)} — who called it?</p>
      <div class="options">${preds.map(n => `<button class="${right.has(n) ? 'selected' : ''}" data-a="tog" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <button class="primary" data-a="done">Done — debrief</button>
    `);
    bind({
      tog: d => { right.has(d.n) ? right.delete(d.n) : right.add(d.n); paint(); },
      done: () => {
        if (S.round > 0) {
          const k = S.probe.options.length > 2 ? S.probe.options.length : 2;
          S.history.push({
            round: S.round, tier: S.probe.tier, text: probeText(S.probe.text, subjName()),
            subjectId: S.subjectIdx, subjectName: subjName(), truth,
            preds: preds.map(n => ({ pid: S.names.indexOf(n), name: n, answer: null, conf: null, p: null, auto: false, correct: right.has(n), pts: scoreChoice('lean', right.has(n), k) })),
          });
          S.scored += 1; S.sinceBallot += 1;
        }
        debrief();
      },
    });
  };
  paint();
}

function debrief() {
  const endsAt = { t: Date.now() + DEBRIEF_SEC * 1000 };
  let done = false;
  const finish = () => { if (done) return; done = true; clearTickers(); audio.chime(); next(); };
  render(`
    <div class="dead-big">PHONE DOWN<br>TALK</div>
    <p class="dead-hint">minority report speaks first · ${DEBRIEF_SEC}s</p>
    <div class="btn-row">
      <button class="ghost" data-a="ext">+30s</button>
      <button class="ghost" data-a="end">End early</button>
    </div>
  `, 'dead facedown');
  bind({ ext: () => { endsAt.t += 30_000; }, end: finish });
  everyFrame(() => { if (Date.now() >= endsAt.t) finish(); }, 500);
}

function next() {
  if (S.round === 0) { S.round = 1; return startRound(); }
  if (S.scored >= S.roundsTotal) return statsScreen();
  S.round += 1;
  if (S.sinceBallot >= S.names.length) { S.sinceBallot = 0; S.votes = []; return ballotPass(0); }
  startRound();
}

function ballotPass(i) {
  render(`
    <p class="lookup-msg">Ballot — pass to<br><b>${esc(S.names[i])}</b></p>
    <button data-a="here">I'm ${esc(S.names[i])}</button>
  `, 'dead');
  bind({ here: () => ballotVote(i) });
}
function ballotVote(i) {
  render(`
    <p class="kicker center">secret ballot · ${tierLabel(S.tier)}</p>
    <button class="primary" data-a="v" data-v="deepen">Deepen</button>
    <button data-a="v" data-v="stay">Stay</button>
    <button data-a="v" data-v="retreat">Retreat</button>
  `);
  bind({ v: d => {
    S.votes.push(d.v);
    if (i < S.names.length - 1) ballotPass(i + 1);
    else {
      let dir = 'deepen';
      if (S.votes.includes('retreat')) dir = 'retreat';
      else if (S.votes.includes('stay')) dir = 'stay';
      if (dir === 'retreat') S.tier = Math.max(1, S.tier - 1);
      if (dir === 'deepen') {
        if (S.tier >= 4) {
          render(`<p class="lookup-msg">This is dyad territory.<br>Find a corner.</p><button class="ghost" data-a="go">Back to the table · Tier 4</button>`, 'dead');
          bind({ go: startRound });
          return;
        }
        S.tier += 1;
      }
      const line = dir === 'deepen' ? `The table deepens to <b>${tierLabel(S.tier)}</b>.`
        : dir === 'retreat' ? `The table eases back to <b>${tierLabel(S.tier)}</b>.`
        : `The table stays at <b>${tierLabel(S.tier)}</b>.`;
      render(`<p class="lookup-msg">${line}</p><button class="ghost" data-a="go">Continue</button>`, 'dead');
      bind({ go: startRound });
    }
  } });
}

function statsScreen() {
  clearTickers();
  const players = S.names.map((n, i) => ({ id: i, name: n }));
  const st = computeStats(S.history, players, true); // physical thumbs = simple mode
  render(`
    ${statsCard(st)}
    <button class="primary" data-a="more">One more rotation</button>
    <button class="ghost" data-a="done">Done</button>
  `);
  bind({
    more: () => { S.roundsTotal += S.names.length; startRound(); },
    done: () => onExit(),
  });
}
