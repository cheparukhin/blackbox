import { render, bind, esc, keepAwake, clearTickers } from './util.js';
import { unlock, setSound, soundOn } from './audio.js';
import { getName, getLocalSettings, setLocalSettings, honestyAcked, ackHonesty } from './storage.js';
import { startTable } from './table.js';
import { startStage } from './stage.js';
import { startLocal } from './local.js';

setSound(getLocalSettings().sounds !== false);

// Cache-first service worker so dyad mode survives zero connectivity.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const params = new URLSearchParams(location.search);

export function home() {
  clearTickers();
  history.replaceState(null, '', '/');
  render(`
    <p class="kicker center">how well can you read each other?</p>
    <h1 class="brand center">BLACK BOX</h1>
    <p class="muted center small">Guess what the person in front of you will say about themselves. Lock it in. Find out.</p>
    <div class="spacer"></div>
    <button class="primary" data-a="net">Play on everyone's phones</button>
    <button data-a="local">Play on one shared phone</button>
    <p class="muted center small">Any number of players, two and up.</p>
    <div class="spacer"></div>
    <button class="ghost" data-a="sound">Sounds: ${soundOn() ? 'on' : 'off'}</button>
  `);
  bind({
    net: () => { unlock(); honesty(() => startTable({}, home)); },
    local: () => { unlock(); honesty(() => startLocal(home)); },
    sound: () => {
      const s = getLocalSettings();
      s.sounds = !(s.sounds !== false);
      setLocalSettings(s);
      setSound(s.sounds);
      home();
    },
  });
}

// Honesty norms — one screen, tapped through once per device. Reconnecting
// after a wifi blip must not re-gate a live game behind it.
export function honesty(next) {
  if (honestyAcked()) return next();
  render(`
    <p class="kicker">the one rule</p>
    <div class="panel">
      <p>Each round, everyone guesses how <b>one player</b> will answer a question about themselves. Then that player answers — <b>truthfully</b>.</p>
      <p>Don't want to answer something? <b>Burn it</b> and you'll get a different question. Burning is free, unlimited, and invisible — nobody ever knows.</p>
      <p>So never lie: your own answers earn you nothing. All the points are in guessing other people right.</p>
    </div>
    <button class="primary" data-a="ok">Got it — let's play</button>
  `);
  bind({ ok: () => { ackHonesty(); next(); } });
}

keepAwake();

const roomCode = (params.get('room') || '').toUpperCase();
if (roomCode && (params.has('stage') || params.has('display'))) {
  startStage(roomCode);
} else if (roomCode) {
  honesty(() => startTable({ code: roomCode }, home));
} else {
  home();
}
