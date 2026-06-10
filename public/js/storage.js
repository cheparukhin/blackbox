// Optional persistence — localStorage, per device, degrade gracefully.

function get(key, fallback) {
  try { const v = localStorage.getItem('bb-' + key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function set(key, val) {
  try { localStorage.setItem('bb-' + key, JSON.stringify(val)); } catch {}
}

export function getName() { return get('name', ''); }
export function setName(n) { set('name', n); }

export function honestyAcked() { return get('honesty', false); }
export function ackHonesty() { set('honesty', true); }

// Lifetime calibration: stated confidence vs realized accuracy.
export function recordCalibration(records) { // [{conf, correct}]
  const cal = get('calibration', {});
  for (const r of records) {
    if (!r.conf || r.correct === null || r.correct === undefined) continue;
    cal[r.conf] = cal[r.conf] || { n: 0, hits: 0 };
    cal[r.conf].n += 1;
    if (r.correct) cal[r.conf].hits += 1;
  }
  set('calibration', cal);
}
export function getCalibration() { return get('calibration', {}); }

export function saveSession(summary) {
  const hist = get('sessions', []);
  hist.push({ at: Date.now(), ...summary });
  set('sessions', hist.slice(-50));
}

export function getLocalSettings() { return get('local', { sounds: true }); }
export function setLocalSettings(s) { set('local', s); }
