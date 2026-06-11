# BLACK BOX — working notes for Claude

In-person social guessing game (LessOnline/Manifest crowd): everyone predicts how one
player will answer a question about themselves, then that player answers truthfully.
Plain ES modules, no framework, no build step. Node ≥18, one dependency (`ws`).

**Where truth lives:** [DESIGN.md](DESIGN.md) is the current game design and decision
log — read it before changing any mechanic. The original build spec (five tiers,
dyad/table modes, reply phase, all-positive scoring, toggles) was deliberately
dismantled after real playtests and removed from the repo; it exists only in git
history. If old commits or docs mention those mechanics, do not "fix" the game back
toward them — DESIGN.md's graveyard section explains why each one died.

## Commands

```sh
npm start                # serve + ws relay on :3000 (prints LAN URL for phones)
node test/smoke.mjs      # full 4-player game over websockets; must pass before push
node test/bots.mjs       # 3 self-playing bots (prints ROOM code) — join from a browser
```

Browser verification uses the preview server in `.claude/launch.json` (name: `blackbox`).
The preview reuses a running server — `pkill -f "node server.js"` first if server.js
changed. Tests use `BB_COMMIT_SEC` / `BB_TRUTH_SEC` / `BB_DEBRIEF_SEC` / `BB_ROUNDS`
env overrides for fast timers; players never see these knobs.

## Hard invariants — do not break casually

- **Scoring is a strictly proper, zero-centered Brier transform**
  (`public/js/scoring.js`, shared verbatim by server and client):
  `points = round(100·(1−(1−q)²)) − 75`. Pass = 0 either way; honest confidence is
  always the expected-points-maximizing button. Any change must preserve properness
  (affine transforms are safe; floors/caps on one side are not).
- **Burns are invisible.** Other clients only ever see "choosing a question…" —
  never that a burn happened, never the burned text. This is the consent mechanism.
- **Ballots are anonymous, outcomes only.** Never expose votes or counts, not even
  a "3/5 voted" progress number (`voteCount` is deliberately null).
- **Privacy is filtered server-side** (`stateFor` in server.js): preview probe only
  to the subject, commits hidden until reveal, own commit echoed only to its owner.
  Never trust the client to hide what the server already sent.
- **No settings.** One lobby knob (rounds). The user has repeatedly removed knobs
  (toggles, pace, tier ladder); don't add new ones without asking.
- **The deck is the user's data.** `public/deck.json` is user-authored — don't edit
  its content, ids, or mode tags. Code adapts to the deck, not vice versa.
- **No running point totals mid-game.** Stats during play are names-only superlatives
  and one-line flavor (see DESIGN.md "stats as table talk").

## Copy voice (any new UI text)

Plain language, zero game jargon: "question" not probe, "guess" not predict/commit,
"your real answer" not truth-commitment. Every screen must answer "what am I looking
at and what do I do?" — label whose answer is whose, say what a button will do, show
the stakes (the confidence buttons display live win/lose points). Second person for
the person holding the phone.

## Review method (learned the hard way)

Mechanics tests don't catch confusion. After UI changes: run smoke, then **play the
flow in the preview browser persona-by-persona** (creator / joiner / subject /
predictor / spectator / late-joiner / reconnector) at mobile size with screenshots,
asking at each screen: would a first-timer understand, what if they tap the wrong
thing, is there a dead end? Auto-clickers never get confused — a human-paced walk is
the test. Robustness rules that came from this: no screen without an exit, disconnected
players never block anything (ghost seats are skipped as subjects), stale `#app.onclick`
handlers are cleared by `render()`, `everyFrame` tickers are keyed/idempotent
(unkeyed recursive registration once produced 270k live intervals).

## Deploy

GitHub `cheparukhin/blackbox` → Render free tier via [render.yaml](render.yaml)
blueprint; every push to `main` auto-deploys. Free tier sleeps after ~15 min idle
(cold start ~30–60s; wake it before a game). A restart drops live rooms; players
rejoin with the same name to reclaim seats. Bump `CACHE` in `public/sw.js` when the
asset list changes. Commit and push after verified changes — that's the user's
standing workflow here.

## Known untested

Real multi-phone play on venue wifi, iOS Safari audio unlock (needs one tap per
phone before sounds work), and timer feel with real conversation. The first live
game is the remaining test — treat reports from it as ground truth over any sim.
