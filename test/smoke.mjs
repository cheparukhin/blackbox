// Drives a real 4-player table round over websockets against a live server:
// create/join → start → tutorial round → scored round → checks points math.
// Run: node test/smoke.mjs   (expects server NOT already running; it spawns one)

import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { scoreChoice } from '../public/js/scoring.js';

const PORT = 3199;
const log = (...a) => console.log('[smoke]', ...a);
let failed = false;
const assert = (cond, msg) => {
  if (cond) log('ok —', msg);
  else { failed = true; console.error('[smoke] FAIL —', msg); }
};

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT, BB_COMMIT_SEC: '5', BB_DEBRIEF_SEC: '2', BB_REPLY_SEC: '1' },
  stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 600));

class Client {
  constructor(name) {
    this.name = name;
    this.state = null;
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ready = new Promise(res => this.ws.on('open', res));
    this.ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.t === 'joined') { this.pid = m.pid; this.code = m.code; }
      if (m.t === 'state') this.state = m.s;
      if (m.t === 'err') { failed = true; console.error('[smoke] server err:', m.msg); }
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  act(a, d = {}) { this.send({ t: 'act', a, d }); }
  async waitPhase(phase, ms = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (this.state?.phase === phase) return this.state;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`${this.name}: timed out waiting for phase "${phase}" (at "${this.state?.phase}")`);
  }
}

try {
  const alice = new Client('alice');
  await alice.ready;
  alice.send({ t: 'create', name: 'Alice' });
  await new Promise(r => setTimeout(r, 200));
  const code = alice.code;
  assert(/^[A-Z2-9]{4}$/.test(code || ''), `room code issued: ${code}`);

  const others = ['Bob', 'Cleo', 'Dev'].map(n => new Client(n));
  await Promise.all(others.map(c => c.ready));
  others.forEach(c => c.send({ t: 'join', code, name: c.name }));
  await new Promise(r => setTimeout(r, 300));
  assert(alice.state?.players.length === 4, '4 players in lobby');

  // demo configuration: one rotation, fast pace — the post-hackathon setup
  alice.act('settings', { rounds: 4, pace: 'demo' });
  await new Promise(r => setTimeout(r, 150));
  assert(alice.state?.settings.rounds === 4 && alice.state?.settings.pace === 'demo', 'rounds + pace settings applied');
  alice.act('start');

  const all = [alice, ...others];
  const playRound = async (expectTutorial) => {
    const s = await alice.waitPhase('preview');
    const subjId = s.subjectId;
    const subject = all.find(c => c.pid === subjId);
    const preds = all.filter(c => c.pid !== subjId);

    assert(subject.state.probe !== null, `${subject.name} (subject) sees the preview probe`);
    assert(preds.every(c => c.state.probe === null), 'predictors see nothing during preview');
    if (expectTutorial) assert(subject.state.probe.tier === 0, 'first round is the T0 tutorial');

    // exercise an invisible burn
    subject.act('burn');
    await new Promise(r => setTimeout(r, 150));
    subject.act('keep');
    await subject.waitPhase('probe');
    subject.act('ready');
    await alice.waitPhase('commit');

    const probe = subject.state.probe;
    const opts = probe.options || ['Yes', 'No'];
    preds[0].act('commit', { answer: opts[0], conf: 'damnsure' });
    preds[1].act('commit', { answer: opts[1], conf: 'lean' });
    // preds[2] never commits → timeout auto-pass
    subject.act('truth', { answer: opts[0] });

    await alice.waitPhase('reveal', 15000); // demo-pace commit timer is 10s
    assert(preds[0].state.commits?.length === 3, 'reveal grid carries all predictors');
    const auto = preds[0].state.commits.find(c => c.auto);
    assert(!!auto, 'missing commit became an auto-pass');

    subject.act('confirmTruth');
    const ts = await preds[0].waitPhase('truth');
    if (!expectTutorial) {
      const me = ts.roundPts.find(r => r.pid === preds[0].pid);
      const k = (probe.options && probe.options.length > 2) ? probe.options.length : 2;
      assert(me.pts === scoreChoice('damnsure', true, k), `damn-sure hit scores ${me.pts} (proper rule)`);
      const wrong = ts.roundPts.find(r => r.pid === preds[1].pid);
      assert(wrong.pts === scoreChoice('lean', false, k), `lean miss scores ${wrong.pts}`);
    }
    await alice.waitPhase('debrief');
    alice.act('endDebrief'); // anyone can flip their phone and end it early
    await alice.waitPhase('reply', 10000);
    subject.act('endReply');
  };

  await playRound(true);   // tutorial
  log('tutorial round complete');
  for (let i = 0; i < 4; i++) { await playRound(false); log(`scored round ${i + 1} complete`); }

  // full rotation done → ballot fires on all phones, even though rounds are up
  const bs = await alice.waitPhase('ballot', 15000);
  assert(bs.voteCount === null, 'ballot leaks no counts');
  all.forEach(c => c.act('vote', { v: 'deepen' }));
  const br = await alice.waitPhase('ballotResult', 10000);
  assert(br.ballotOutcome.dir === 'deepen' && br.ballotOutcome.tier === 2, 'unanimous deepen → tier 2');

  // …then straight to the end card, with awards despite the short session
  const st = await alice.waitPhase('stats', 15000);
  assert(!!st.statsData, 'end card data present');
  assert(!!st.statsData.oracle, `Oracle awarded: ${st.statsData.oracle?.name}`);
  assert(!!st.statsData.boldest, `Boldest Call awarded: ${st.statsData.boldest?.name}`);
  assert(!!st.statsData.openBook, `Open Book shown: ${st.statsData.openBook?.name}`);
  assert(st.statsData.totals.every(t => t.n > 0 ? t.total > 0 : true), 'every player has points');
  assert(Array.isArray(st.history) && st.history.length === 4, 'history carries 4 scored rounds');

  log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
} catch (e) {
  failed = true;
  console.error('[smoke] FAIL —', e.message);
} finally {
  server.kill();
  process.exit(failed ? 1 : 0);
}
