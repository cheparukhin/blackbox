// End screen — built to be screenshotted. Shared by table, dyad, and stage.

import { esc } from './util.js';
import { CONF } from './scoring.js';

const pct = x => `${Math.round(x * 100)}%`;

export function statsCard(st, { calibration = null, title = 'the box opens' } = {}) {
  if (!st) return `<p class="muted center">No rounds scored.</p>`;
  const awards = [];

  if (st.oracle) awards.push(award('Oracle — best reader', st.oracle.name,
    st.simpleMode ? `${st.oracle.correct} correct calls` : `${st.oracle.avg} avg points over ${st.oracle.n} predictions`));
  if (st.openBook) awards.push(award('Open Book (not a score)', st.openBook.name,
    `read right ${pct(st.openBook.rate)} of the time`));
  if (st.enigma && st.enigma.pid !== st.openBook?.pid) awards.push(award('Enigma (not a score)', st.enigma.name,
    `read right only ${pct(st.enigma.rate)} of the time`));
  if (st.boldest) awards.push(award('Boldest Call', st.boldest.name,
    `${CONF[st.boldest.conf]?.label || ''} on “${trim(st.boldest.text)}” — and right`));
  if (st.icarus) awards.push(award('Icarus', st.icarus.name,
    `${CONF[st.icarus.conf]?.label || ''} on “${trim(st.icarus.text)}” — and wrong`));

  const legib = (st.legibility || []).map(l => {
    const verb = l.delta > 0 ? `reads ${esc(l.name)} ${l.delta}% better than when you sat down`
      : l.delta < 0 ? `somehow reads ${esc(l.name)} ${-l.delta}% worse — interesting`
      : `reads ${esc(l.name)} exactly as well as an hour ago`;
    return `<p class="center">The table ${verb}.</p>`;
  }).join('');

  const totals = (st.totals || []).filter(t => t.n > 0).sort((a, b) => st.simpleMode ? b.correct - a.correct : b.avg - a.avg)
    .map(t => `<div class="grid-row"><span class="name">${esc(t.name)}</span><span>${st.simpleMode ? `${t.correct}/${t.scored} correct` : `${t.avg} avg · ${t.total} total`}</span></div>`).join('');

  let calib = '';
  if (calibration && Object.keys(calibration).length) {
    const lines = Object.entries(calibration)
      .filter(([, v]) => v.n >= 5)
      .map(([c, v]) => `<p class="small muted center">You say ${CONF[c]?.label || c}, you're right ${pct(v.hits / v.n)} of the time (n=${v.n}).</p>`)
      .join('');
    if (lines) calib = `<p class="kicker center">your lifetime calibration — about humans</p>${lines}`;
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
