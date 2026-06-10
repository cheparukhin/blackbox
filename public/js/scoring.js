// BLACK BOX scoring engine — one engine for both modes. Spec §6, implement exactly:
// points = round(100 × (1 − (1 − q)²)) where q is the probability the predictor's
// choice assigned to the true outcome. Affine transform of the Brier score → strictly proper.

export const CONF = {
  pass:     { label: 'Pass',      p: 0.50 },
  lean:     { label: 'Lean',      p: 0.65 },
  confident:{ label: 'Confident', p: 0.80 },
  damnsure: { label: 'Damn Sure', p: 0.95 },
};
export const CONF_ORDER = ['pass', 'lean', 'confident', 'damnsure'];

export function points(q) {
  return Math.round(100 * (1 - (1 - q) ** 2));
}

// q for a discrete choice: binary → q = p if right, 1−p if wrong.
// k-option choice (MC-4, relational) → residual mass splits evenly: q = (1−p)/(k−1) when wrong.
export function qFor(p, correct, k = 2) {
  if (correct) return p;
  if (k <= 2) return 1 - p;
  return (1 - p) / (k - 1);
}

export function scoreChoice(confKey, correct, k = 2) {
  const conf = CONF[confKey] || CONF.lean;
  return points(qFor(conf.p, correct, k));
}

// Timeout auto-Pass = abstain at the uniform distribution over k options.
export function scoreAbstain(k = 2) {
  return points(1 / k);
}

// Scale probes (1–10, dyad only): no confidence button.
export function scoreScale(guess, truth) {
  return Math.max(10, 100 - 15 * Math.abs(guess - truth));
}

// Tier 5 free-form: subject grades.
export const GRADES = { cold: 10, warm: 40, hot: 75, exact: 100 };
export const GRADE_ORDER = ['cold', 'warm', 'hot', 'exact'];

export function optionCount(probe) {
  if (!probe) return 2;
  if (probe.options && probe.options.length > 2) return probe.options.length;
  return 2;
}
