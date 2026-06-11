// Three bot players that create a room and play forever — for eyeballing the
// real phone UI: join them from a browser and watch the round choreography.
// Run: node test/bots.mjs [port]   → prints ROOM <code>

import WebSocket from 'ws';

const PORT = process.argv[2] || 3000;
const NAMES = ['Ada', 'Ben', 'Cat'];
const bots = [];
let code = null;

function mkBot(name, hello) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const bot = { name, pid: null, state: null, ws, acted: '' };
  ws.on('open', () => ws.send(JSON.stringify(hello())));
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'joined') { bot.pid = m.pid; if (!code) { code = m.code; console.log('ROOM', code); } }
    if (m.t === 'state') { bot.state = m.s; react(bot); }
    if (m.t === 'err') console.error(name, 'err:', m.msg);
  });
  bots.push(bot);
  return bot;
}

function act(bot, a, d = {}) { bot.ws.send(JSON.stringify({ t: 'act', a, d })); }

function once(bot, key, delay, fn) {
  if (bot.acted === key) return;
  bot.acted = key;
  setTimeout(() => { if (bot.state && bot.acted === key) fn(); }, delay);
}

function react(bot) {
  const s = bot.state;
  if (!s) return;
  const key = s.phase + ':' + s.phaseStartedAt;
  const me = s.you;
  if (!me) return;

  if (s.phase === 'lobby' && me.isCreator && s.players.length >= 4) {
    once(bot, key, 1000, () => {
      act(bot, 'settings', { rounds: 1, pace: 'demo' }); // one full rotation, demo timers
      setTimeout(() => act(bot, 'start'), 300);
    });
  } else if (s.phase === 'preview' && me.isSubject) {
    once(bot, key, 1500, () => act(bot, 'keep'));
  } else if (s.phase === 'probe' && me.isSubject) {
    once(bot, key, 2000, () => act(bot, 'ready'));
  } else if (s.phase === 'commit') {
    const pick = () => {
      if (s.probe?.answerType === 'scale') return String(1 + Math.floor(Math.random() * 10));
      const opts = s.probe?.options || ['Yes', 'No'];
      return opts[Math.floor(Math.random() * opts.length)];
    };
    if (me.isSubject && !s.truthIn) {
      once(bot, key + 't', 1200, () => act(bot, 'truth', { answer: pick() }));
    } else if (!me.isSubject && !me.committed) {
      once(bot, key, 800 + Math.random() * 2000, () => {
        const confs = ['pass', 'lean', 'confident', 'damnsure'];
        act(bot, 'commit', { answer: pick(), conf: confs[Math.floor(Math.random() * 4)] });
      });
    }
  } else if (s.phase === 'reveal' && me.isSubject) {
    once(bot, key, 11000, () => act(bot, 'confirmTruth'));
  } else if (s.phase === 'debrief') {
    if (me.isCreator) once(bot, key, 10000, () => act(bot, 'endDebrief'));
  } else if (s.phase === 'ballot' && !me.voted) {
    once(bot, key, 2000 + Math.random() * 2000, () => act(bot, 'vote', { v: Math.random() < 0.7 ? 'deepen' : 'stay' }));
  } else if (s.phase === 'stats' && me.isCreator) {
    once(bot, key, 15000, () => act(bot, 'more'));
  } else if (['preview', 'probe', 'commit', 'reveal'].includes(s.phase) && s.subjectConnected === false && me.isCreator) {
    once(bot, key + 'skip', 5000, () => act(bot, 'skip'));
  }
}

mkBot(NAMES[0], () => ({ t: 'create', name: NAMES[0] }));
setTimeout(() => {
  for (const n of NAMES.slice(1)) mkBot(n, () => ({ t: 'join', code, name: n }));
}, 500);
