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

  // Oracle — best reader: highest average points (simple mode: most correct). Min 3 predictions.
  const eligible = totals.filter(t => t.n >= 3);
  let oracle = null;
  if (eligible.length) {
    const sorted = [...eligible].sort((a, b) => simpleMode ? (b.correct - a.correct) : (b.avg - a.avg));
    oracle = sorted[0];
  }

  // Open Book / Enigma — most/least legible subject (a stat, not a score). Min 4 predictions about them.
  const legible = [];
  for (const p of players) {
    const preds = onSubject.get(p.id) || [];
    if (preds.length >= 4) {
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
