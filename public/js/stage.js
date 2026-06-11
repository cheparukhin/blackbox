// Optional big-screen stage — a read-only, landscape, large-type mirror of the
// public state. Shows nothing private; the game never depends on it existing.

import { render, esc, probeText, everyFrame, clearTickers, secsLeft, tierLabel } from './util.js';
import { CONF } from './scoring.js';
import { statsCard } from './statsview.js';

let ws = null, offset = 0, code = null, last = null;

export function startStage(roomCode) {
  code = roomCode;
  connect();
}

function connect() {
  render(`<div class="dead-hint">connecting to ${esc(code)}…</div>`, 'dead stage');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'stage', code }));
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.t === 'err') render(`<div class="dead-hint">${esc(m.msg)}</div>`, 'dead stage');
    if (m.t === 'state') { last = m.s; offset = m.s.now - Date.now(); paint(m.s); }
  };
  ws.onclose = () => setTimeout(connect, 2000);
}

function paint(s) {
  clearTickers();
  const fn = VIEWS[s.phase] || VIEWS.wait;
  fn(s);
}

const VIEWS = {
  lobby(s) {
    const url = `${location.origin}/?room=${s.code}`;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&data=${encodeURIComponent(url)}`;
    render(`
      <p class="kicker">black box · join on your phone</p>
      <div class="code-big">${s.code}</div>
      <img class="qr" src="${qr}" alt="" onerror="this.style.display='none'">
      <p class="kicker">${s.players.map(p => esc(p.name)).join(' · ') || 'waiting…'}</p>
    `, 'stage');
  },
  preview(s) {
    render(`<p class="kicker">${esc(s.subjectName)} is choosing a question…</p>`, 'stage dead');
  },
  probe(s) {
    render(`
      <p class="kicker">${tierLabel(s.tier)} · ${esc(s.subjectName)}'s turn</p>
      <p class="probe-text">${esc(probeText(s.probe.text, s.subjectName))}</p>
      <p class="kicker">${esc(s.subjectName)}, read it out loud</p>
    `, 'stage');
  },
  commit(s) {
    render(`
      <p class="probe-text">${esc(probeText(s.probe.text, s.subjectName))}</p>
      <div class="lock-huge">${s.lockCount ?? 0}/${s.predictorCount}</div>
      <p class="kicker">locked in</p>
    `, 'stage');
    everyFrame(() => { if (last?.phase === 'commit') VIEWS.commit(last); }, 1000, 'commit');
  },
  reveal(s) {
    const elapsed = Date.now() + offset - s.phaseStartedAt;
    if (elapsed < 3000) {
      render(`<div class="countdown-huge">${3 - Math.floor(elapsed / 1000)}</div>`, 'stage dead');
    } else {
      grid(s, `${esc(s.subjectName)}, say your real answer out loud.`);
    }
    everyFrame(() => { if (last?.phase === 'reveal') VIEWS.reveal(last); }, 250, 'reveal');
  },
  truth(s) {
    render(`
      <p class="kicker">${esc(s.subjectName)}'s answer</p>
      <div class="truth-big">${esc(s.truth)}</div>
      ${s.flavor ? `<p class="split-flag" style="font-size:2.4vw">${esc(s.flavor)}</p>` : ''}
    `, 'stage');
  },
  debrief(s) {
    const left = secsLeft(s.phaseEndsAt, offset);
    render(`
      <p class="kicker">talk — what made you guess that? · ${esc(s.subjectName)} gets the last word</p>
      <div class="countdown-huge" style="font-size:14vw">${left ?? ''}</div>
    `, 'stage');
    everyFrame(() => { if (last?.phase === 'debrief') VIEWS.debrief(last); }, 1000, 'debrief');
  },
  ballot(s) {
    render(`<p class="lookup-msg">Secret vote on your phones:</p><p class="kicker">ready to go deeper?</p>`, 'stage dead');
  },
  ballotResult(s) {
    const o = s.ballotOutcome || {};
    const line = o.dir === 'deepen' ? 'The table goes deep.' : 'Staying spicy — for now.';
    const i = s.interim || {};
    const parts = [];
    if (i.oracle) parts.push(`best reader: ${esc(i.oracle)}`);
    if (i.openBook) parts.push(`open book: ${esc(i.openBook)}`);
    if (i.enigma) parts.push(`hardest to read: ${esc(i.enigma)}`);
    render(`
      <p class="lookup-msg">${line}</p>
      ${parts.length ? `<p class="kicker" style="text-align:center">so far — ${parts.join(' · ')}</p>` : ''}
    `, 'stage dead');
  },
  stats(s) {
    render(statsCard(s.statsData), 'stage');
  },
  wait() { render(`<div class="dead-hint">…</div>`, 'stage dead'); },
};

function grid(s, footer) {
  render(`
    <div class="grid">
      ${(s.commits || []).map(c => `
        <div class="grid-row ${c.auto ? 'autopass' : ''}">
          <span class="name">${esc(c.name)}</span>
          <span class="ans">${c.auto ? '—' : esc(c.answer)}</span>
          <span class="conf">${c.auto ? 'pass' : c.conf ? CONF[c.conf].label : ''}</span>
        </div>`).join('')}
    </div>
    <p class="kicker" style="text-align:center">${footer}</p>
  `, 'stage');
}

