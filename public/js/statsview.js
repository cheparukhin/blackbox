// End screen — built to be screenshotted. Shared by table, dyad, and stage.

import { esc, fmtPts } from './util.js';
import { CONF } from './scoring.js';

const pct = x => `${Math.round(x * 100)}%`;

export function statsCard(st, { calibration = null, title = 'the results' } = {}) {
  if (!st) return `<p class="muted center">No rounds scored.</p>`;
  const awards = [];

  if (st.oracle) awards.push(award('Oracle — best at reading people', st.oracle.name,
    st.simpleMode ? `${st.oracle.correct} right guesses` : `${fmtPts(st.oracle.avg)} points per guess, over ${st.oracle.n} guesses`));
  if (st.openBook) awards.push(award('Open Book — easiest to read', st.openBook.name,
    `the others guessed them right ${pct(st.openBook.rate)} of the time`));
  if (st.enigma && st.enigma.pid !== st.openBook?.pid) awards.push(award('Enigma — hardest to read', st.enigma.name,
    `the others guessed them right only ${pct(st.enigma.rate)} of the time`));
  if (st.boldest) awards.push(award('Boldest Call — confident and right', st.boldest.name,
    `${CONF[st.boldest.conf]?.label || ''} on “${trim(st.boldest.text)}”`));
  if (st.icarus) awards.push(award('Icarus — confident and wrong', st.icarus.name,
    `${CONF[st.icarus.conf]?.label || ''} on “${trim(st.icarus.text)}”`));

  const legib = (st.legibility || []).map(l => {
    const line = l.delta > 0 ? `${esc(l.name)} got <b>${l.delta}% easier to read</b> as the game went on`
      : l.delta < 0 ? `${esc(l.name)} got <b>${-l.delta}% harder to read</b> — interesting`
      : `${esc(l.name)} stayed exactly as readable as round one`;
    return `<p class="center">${line}.</p>`;
  }).join('');

  const totals = (st.totals || []).filter(t => t.n > 0).sort((a, b) => st.simpleMode ? b.correct - a.correct : b.avg - a.avg)
    .map(t => `<div class="grid-row"><span class="name">${esc(t.name)}</span><span>${st.simpleMode ? `${t.correct}/${t.scored} correct` : `${fmtPts(t.total)} total · ${fmtPts(t.avg)} per guess`}</span></div>`).join('');

  let calib = '';
  if (calibration && Object.keys(calibration).length) {
    const lines = Object.entries(calibration)
      .filter(([, v]) => v.n >= 5)
      .map(([c, v]) => `<p class="small muted center">When you say “${CONF[c]?.label || c}”, you're right ${pct(v.hits / v.n)} of the time (${v.n} guesses on this phone).</p>`)
      .join('');
    if (lines) calib = `<p class="kicker center">your track record — across all games on this phone</p>${lines}`;
  }

  return `
    <p class="kicker center">${esc(title)}</p>
    ${awards.join('')}
    ${legib}
    <p class="kicker center">scores</p>
    <div class="grid">${totals}</div>
    ${calib}
    <p class="muted small center">screenshot this — it's yours</p>
  `;
}

function award(title, who, why) {
  return `<div class="award"><span class="title">${esc(title)}</span><span class="who">${esc(who)}</span><span class="why">${esc(why)}</span></div>`;
}
function trim(t) { return t.length > 60 ? t.slice(0, 57) + '…' : t; }
