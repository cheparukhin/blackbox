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

// Keyed tickers: screen renderers re-invoke themselves from their own tick
// callback, so registration MUST be idempotent per key or intervals double
// every tick (measured: 270k live intervals 10s into one reveal).
let tickers = new Map();
export function everyFrame(fn, ms = 250, key) {
  const k = key ?? Symbol('tick');
  if (tickers.has(k)) return () => {};
  const id = setInterval(fn, ms);
  tickers.set(k, id);
  return () => { clearInterval(id); tickers.delete(k); };
}
export function clearTickers() {
  for (const id of tickers.values()) clearInterval(id);
  tickers = new Map();
}

export function secsLeft(endsAt, offset = 0) {
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - (Date.now() + offset)) / 1000));
}

export const fmtPts = n => (n > 0 ? '+' : '') + n;

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
    const pts = win === lose ? `${fmtPts(win)} either way` : `right ${fmtPts(win)} · wrong ${fmtPts(lose)}`;
    return `<button class="conf-btn" data-a="conf" data-c="${c}"
      style="background:linear-gradient(90deg, rgba(255,180,84,.12) ${pc}%, var(--panel) ${pc}%)">
      <span>${CONF[c].label} · ${pc}%</span><span class="conf-pts">${pts}</span></button>`;
  }).join('');
}

// Two levels only: the game starts spicy and can go deep — that's it.
// 1–10 answer buttons for scale questions, shared by both modes.
export function scaleRow(action) {
  return `<div class="scale-row">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button data-a="${action}" data-o="${n}">${n}</button>`).join('')}</div>`;
}

export const TIER_NAMES = { 0: 'Warm-up', 1: 'Spicy', 2: 'Deep' };
export const TIER_TAGLINES = { 1: 'worth gossiping about', 2: 'the real stuff' };
export function tierLabel(t) { return TIER_NAMES[t] || ''; }
export function tierTagline(t) { return TIER_TAGLINES[t] || ''; }
