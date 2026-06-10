// Client-side deck access for dyad + offline fallback modes.
// (Table mode draws happen server-side so burns stay invisible.)

import { TUTORIAL } from './tutorial.js';

let DECK = null;

export async function loadDeck() {
  if (DECK) return DECK;
  const raw = await (await fetch('/deck.json')).json();
  DECK = [...TUTORIAL, ...(raw.probes || raw)];
  return DECK;
}

export function draw(deck, { tier, mode, used, allowTypes = null }) {
  const ok = p => p.tier === tier && p.modes.includes(mode) &&
    (!allowTypes || allowTypes.includes(p.answerType));
  let pool = deck.filter(p => ok(p) && !used.has(p.id));
  if (!pool.length) {
    for (const p of deck) if (ok(p)) used.delete(p.id);
    pool = deck.filter(p => ok(p));
  }
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  used.add(pick.id);
  const probe = { ...pick };
  if (probe.answerType === 'overunder' && !probe.options) probe.options = ['Over', 'Under'];
  if (probe.answerType === 'binary' && !probe.options) probe.options = ['Yes', 'No'];
  return probe;
}
