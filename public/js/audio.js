// Synthesized cues — load-bearing in table mode: phones spend conversation
// phases face-down, so ends of phases must be *heard*, not watched.

let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSound(on) { enabled = on; }
export function soundOn() { return enabled; }
// Must be called from a user gesture once (iOS Safari).
export function unlock() { ac(); }

function tone(freq, dur, { type = 'sine', gain = 0.18, when = 0, glideTo = null } = {}) {
  if (!enabled) return;
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

export function tick() { tone(880, 0.08, { type: 'square', gain: 0.1 }); }
export function sting() { // reveal
  tone(440, 0.35, { glideTo: 880, gain: 0.22 });
  tone(660, 0.3, { when: 0.08, glideTo: 1320, gain: 0.12 });
}
export function chime() { // debrief end — soft, not an alarm
  tone(660, 0.6, { gain: 0.12 });
  tone(990, 0.8, { when: 0.15, gain: 0.08 });
}
export function buzz() { // commit phase opens
  tone(140, 0.25, { type: 'sawtooth', gain: 0.15 });
  tone(140, 0.25, { type: 'sawtooth', gain: 0.15, when: 0.35 });
}
