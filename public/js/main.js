import { render, bind, esc, keepAwake, clearTickers } from './util.js';
import { unlock, setSound, soundOn } from './audio.js';
import { getName, getLocalSettings, setLocalSettings } from './storage.js';
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
    <p class="kicker center">a game of modeling with verification</p>
    <h1 class="brand center">BLACK BOX</h1>
    <p class="muted center small">Score points by demonstrating you understand the person in front of you.</p>
    <div class="spacer"></div>
    <button class="primary" data-a="net">Everyone's phone &nbsp;·&nbsp; join a room</button>
    <button data-a="local">One phone &nbsp;·&nbsp; pass it around</button>
    <p class="muted center small">Any number of players. Two people go deepest.</p>
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

// Honesty norms — one screen, three lines, must be tapped through. Spec §8.
export function honesty(next) {
  render(`
    <p class="kicker">Before you play</p>
    <div class="panel">
      <p>Answers are <b>true or burned — never false</b>.</p>
      <p>Burning is always free and invisible.</p>
      <p>You cannot score points by being hard to read, so deceiving the table isn't strategy — it's just defecting against the point.</p>
    </div>
    <button class="primary" data-a="ok">I'm in</button>
  `);
  bind({ ok: () => next() });
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
