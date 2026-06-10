// BLACK BOX scoring engine — one engine for both modes.
// points = round(100 × (1 − (1 − q)²)) − 75, where q is the probability the
// predictor's choice assigned to the true outcome. Affine transform of the
// Brier score → strictly proper: your honest confidence is always the
// expected-points-maximizing button. Zero-centered so a coin-flip claim
// (Pass on a binary) scores 0 and wrong answers visibly lose points.

export const CONF = {
  pass:     { label: 'Pass',      p: 0.50 },
  lean:     { label: 'Lean',      p: 0.65 },
  confident:{ label: 'Confident', p: 0.80 },
  damnsure: { label: 'Damn Sure', p: 0.95 },
};
export const CONF_ORDER = ['pass', 'lean', 'confident', 'damnsure'];

const BASE = 75; // raw score of a 50% claim — subtracted so "no idea" = 0

export function points(q) {
  return Math.round(100 * (1 - (1 - q) ** 2)) - BASE;
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

// Timeout = no claim made = no points either way.
export function scoreAbstain() {
  return 0;
}

// Scale probes (1–10, two-player local only): no confidence button.
// Dead on = +25 (a Damn Sure hit), one off still gains, far off loses.
export function scoreScale(guess, truth) {
  return Math.max(-65, 25 - 15 * Math.abs(guess - truth));
}

// Tier 5 free-form: subject grades the guess; never negative — by the Vault
// the scoreboard has done its job.
export const GRADES = { cold: 0, warm: 10, hot: 18, exact: 25 };
export const GRADE_ORDER = ['cold', 'warm', 'hot', 'exact'];

export function optionCount(probe) {
  if (!probe) return 2;
  if (probe.options && probe.options.length > 2) return probe.options.length;
  return 2;
}
