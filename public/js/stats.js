// End-card stats — shared by table (server) and dyad (client). Spec §10.
// history entries: { round, tier, subjectId, subjectName, text, truth,
//                    preds: [{ pid, name, answer, conf, p, auto, correct, pts }] }
// `correct` may be null (auto-pass / unscoreable) — those are excluded from hit rates.

import { CONF } from './scoring.js';

export function computeStats(history, players, simpleMode = false) {
  const byPid = new Map(players.map(p => [p.id, { pid: p.id, name: p.name, pts: 0, n: 0, correct: 0, scored: 0 }]));
  const onSubject = new Map(players.map(p => [p.id, []])); // chronological preds about each subject

  let boldest = null, icarus = null;

  for (const h of history) {
    for (const pr of h.preds) {
      const t = byPid.get(pr.pid);
      if (t) { t.pts += pr.pts; t.n += 1; }
      if (pr.correct !== null && pr.correct !== undefined && !pr.auto) {
        if (t) { t.scored += 1; if (pr.correct) t.correct += 1; }
        const subj = onSubject.get(h.subjectId);
        if (subj) subj.push({ correct: pr.correct });
        const p = pr.p ?? (CONF[pr.conf]?.p);
        if (p != null) {
          if (pr.correct && (!boldest || p > boldest.p || (p === boldest.p && pr.pts > boldest.pts)))
            boldest = { name: pr.name, p, pts: pr.pts, conf: pr.conf, text: h.text, subjectName: h.subjectName };
          if (!pr.correct && (!icarus || p > icarus.p))
            icarus = { name: pr.name, p, pts: pr.pts, conf: pr.conf, text: h.text, subjectName: h.subjectName };
        }
      }
    }
  }

  const totals = [...byPid.values()].map(t => ({
    pid: t.pid, name: t.name,
    avg: t.n ? Math.round(t.pts / t.n) : 0,
    total: t.pts, n: t.n, correct: t.correct, scored: t.scored,
  }));

  // Oracle — best reader: highest average points (simple mode: most correct).
  // Min 2 predictions so short demo sessions still crown one.
  const eligible = totals.filter(t => t.n >= 2);
  let oracle = null;
  if (eligible.length) {
    const sorted = [...eligible].sort((a, b) => simpleMode ? (b.correct - a.correct) : (b.avg - a.avg));
    oracle = sorted[0];
  }

  // Open Book / Enigma — most/least legible subject (a stat, not a score, so a
  // coarse rate is fine). Min 2 scored predictions, so one rotation of any
  // table qualifies even with a timeout or two.
  const legible = [];
  for (const p of players) {
    const preds = onSubject.get(p.id) || [];
    if (preds.length >= 2) {
      const hits = preds.filter(x => x.correct).length;
      legible.push({ pid: p.id, name: p.name, rate: hits / preds.length, n: preds.length });
    }
  }
  legible.sort((a, b) => b.rate - a.rate);
  const openBook = legible.length >= 2 ? legible[0] : null;
  const enigma = legible.length >= 2 ? legible[legible.length - 1] : null;

  // Legibility delta — first-half vs second-half hit rate per subject; ≥3 per half or stay silent.
  const legibility = [];
  for (const p of players) {
    const preds = onSubject.get(p.id) || [];
    const mid = Math.floor(preds.length / 2);
    const a = preds.slice(0, mid), b = preds.slice(mid);
    if (a.length >= 3 && b.length >= 3) {
      const ra = a.filter(x => x.correct).length / a.length;
      const rb = b.filter(x => x.correct).length / b.length;
      legibility.push({ name: p.name, before: ra, after: rb, delta: Math.round((rb - ra) * 100) });
    }
  }

  return { oracle, openBook, enigma, boldest, icarus, legibility, totals, simpleMode };
}

// One playful line about the round that just scored — stats as table talk,
// never a running total. Priority: streaks > a Damn Sure crash > unanimity.
export function roundFlavor(history) {
  const h = history[history.length - 1];
  if (!h) return null;
  const scored = h.preds.filter(p => !p.auto && p.correct !== null && p.correct !== undefined);
  if (!scored.length) return null;
  const hits = scored.filter(p => p.correct);

  let streak = null;
  for (const p of hits) {
    let n = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const pr = history[i].preds.find(x => x.pid === p.pid && !x.auto && x.correct !== null);
      if (!pr) continue;
      if (pr.correct) n += 1; else break;
    }
    if (n >= 3 && (!streak || n > streak.n)) streak = { name: p.name, n };
  }
  if (streak) return `${streak.name} has read ${streak.n} in a row.`;

  const dsMiss = scored.find(p => p.conf === 'damnsure' && !p.correct);
  if (dsMiss) return `${dsMiss.name} went Damn Sure — and down in flames.`;
  if (scored.length >= 2 && hits.length === scored.length) return 'Open book — the whole table called it.';
  if (scored.length >= 2 && hits.length === 0) return 'Nobody saw that coming.';
  const dsHit = scored.find(p => p.conf === 'damnsure' && p.correct);
  if (dsHit) return `${dsHit.name} went Damn Sure — and was right.`;
  return null;
}

// Mid-session superlatives for the between-rotations beat. Names only, no totals.
export function interimStats(history, players) {
  const st = computeStats(history, players, false);
  return {
    oracle: st.oracle?.name || null,
    openBook: st.openBook?.name || null,
    enigma: st.enigma && st.enigma.pid !== st.openBook?.pid ? st.enigma.name : null,
  };
}

// Lifetime calibration buckets from a list of {conf, correct} records.
export function calibrationFromRecords(records) {
  const buckets = {};
  for (const r of records) {
    if (!r.conf || r.correct === null || r.correct === undefined) continue;
    buckets[r.conf] = buckets[r.conf] || { n: 0, hits: 0 };
    buckets[r.conf].n += 1;
    if (r.correct) buckets[r.conf].hits += 1;
  }
  return buckets;
}
