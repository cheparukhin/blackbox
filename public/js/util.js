import { CONF, CONF_ORDER, scoreChoice } from './scoring.js';

export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function render(html, cls = '') {
  const app = $('#app');
  app.className = 'screen ' + cls;
  app.innerHTML = html;
}

// Wire every [data-a] element to a handler map. Re-call after each render.
export function bind(actions) {
  for (const el of $$('[data-a]')) {
    el.onclick = e => {
      e.preventDefault();
      const fn = actions[el.dataset.a];
      if (fn) fn(el.dataset, el);
    };
  }
}

// Probe text carries the literal token {name}; render it as the subject's
// first name. Never show the raw token to players. ("B" kept for old decks.)
export function probeText(text, name) {
  return String(text).replace(/\{name\}/g, name).replace(/\bB\b/g, name);
}

export function flashScreen() {
  const f = $('#flash');
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
  try { navigator.vibrate?.(200); } catch {}
}

let tickers = [];
export function everyFrame(fn, ms = 250) {
  const id = setInterval(fn, ms);
  tickers.push(id);
  return () => clearInterval(id);
}
export function clearTickers() {
  for (const id of tickers) clearInterval(id);
  tickers = [];
}

export function secsLeft(endsAt, offset = 0) {
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - (Date.now() + offset)) / 1000));
}

export function timerBar(frac) {
  return `<div class="bar"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, frac * 100))}%"></div></div>`;
}

let wakeLock = null;
export async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && wakeLock?.released !== false) {
        try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
      }
    });
  } catch {}
}

// The four confidence stops rendered as a visual scale: percentage, a fill bar
// at that percentage, and the exact points at stake for this question.
export function confButtons(probe) {
  const k = probe.options && probe.options.length > 2 ? probe.options.length : 2;
  return CONF_ORDER.map(c => {
    const pc = Math.round(CONF[c].p * 100);
    const win = scoreChoice(c, true, k), lose = scoreChoice(c, false, k);
    const pts = win === lose ? `+${win} either way` : `right +${win} · wrong +${lose}`;
    return `<button class="conf-btn" data-a="conf" data-c="${c}"
      style="background:linear-gradient(90deg, rgba(255,180,84,.12) ${pc}%, var(--panel) ${pc}%)">
      <span>${CONF[c].label} · ${pc}%</span><span class="conf-pts">${pts}</span></button>`;
  }).join('');
}

export const TIER_NAMES = { 0: 'Tutorial', 1: 'Surface', 2: 'Character', 3: 'Skin', 4: 'Confession', 5: 'Vault' };
export const TIER_TAGLINES = {
  1: 'being read is funny', 2: 'being read is interesting', 3: 'being read is exposing',
  4: 'being read is intimate', 5: 'being read is profound',
};
export function tierLabel(t) { return t === 0 ? 'Warm-up' : `Tier ${t} · ${TIER_NAMES[t] || ''}`; }
export function tierTagline(t) { return TIER_TAGLINES[t] || ''; }
