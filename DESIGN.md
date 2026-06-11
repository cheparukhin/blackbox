# BLACK BOX — current design & decision log

This is the living design document. It supersedes the original v4 build spec, which
was removed from the repo once this file absorbed its load-bearing rationale (it's in
git history — `git log -- black-box-spec.md` — if you ever need the archaeology).
Every divergence below was a deliberate call made during iteration on 2026-06-10/11,
most of them after the mechanics confused real first-time players. Don't undo these
without a new reason; "the spec said so" is not one.

## The game, as it stands

**Thesis (unchanged from the spec):** you score points by demonstrating you understand
the person in front of you. The scoreboard licenses the staring; prediction accuracy
rising over a session *is* the relationship forming.

**Loop:** one player per turn is the subject. They privately preview the question and
may **burn** it (free, unlimited, invisible) for another. They read it aloud — the
question is already live on every phone and guesses can lock immediately; the subject's
"everyone heard it" tap just starts the short countdown for stragglers. Everyone else
locks a private guess about the subject's answer, with a confidence level; the subject
locks their real answer. 3‑2‑1, everyone's guesses appear with names attached, the
subject says their answer out loud, the same grid gains the answer and points, then
phones go face down for a talk phase ("what made you guess that?" — whoever guessed
differently goes first, the subject gets the last word). Next turn.

**Screens map to steps.** A phone changes screens only when the game advances to a
genuinely new step: choose question → guess → reveal → talk → (vote). Within a step
the same screen accumulates state — your locked guess stays visible with a counter,
the reveal grid gains the truth and points, the ballot panel resolves in place. The
deliberate exceptions, kept because they do physical choreography work, are the 3‑2‑1
sting, the "Look up" dim while the subject speaks, and the face-down talk screen.

**A round = one full rotation** — everyone takes one turn as the subject. The single
lobby setting counts rounds (default 3, max 10). "Keep playing" at the end adds exactly
one more round.

**Two transports, one game:**
- **Distributed** — everyone's phone, 4-char room codes over a WebSocket relay,
  server-authoritative state, per-client privacy filtering. Optional read-only
  big-screen stage view (code-only entry, never consumes a player seat).
- **Local** — one shared phone passed around; each guesser commits privately in turn.
  Works fully offline (service worker). Same rules, same deck.

Differences between transports are physical only: free-form questions are local-only
(typed sentences don't fit a 15-second parallel timer), and guesses are sequential on
the shared phone instead of parallel.

**Two content levels, one guardrail:**
- Games start **Spicy** (deck tiers 2+3: envy, crushes, status anxiety, self-model).
- After each round while still spicy, a secret two-button vote — *Go deep / Not yet* —
  majority of present players decides. **Deep** = deck tiers 4+5 (confessions,
  who-of-us picks, free-form for pairs). Once deep, always deep. The vote is skipped
  on the final round (voting to deepen a finished game is nonsense).
- The burn is the per-question consent valve at every level. No retreat votes, no
  caps, no per-probe content flags.

**Question types:** yes/no, custom two-option (respected/liked), 4-option multiple
choice, over/under, 1–10 scale, who-of-us (relational), free-form. Constraints that
are content-logic, not rules: relational needs 3+ players (you need ≥2 people to
point at); dyad-tagged probes (anything addressed to a single "you", all free-form,
the scale questions tagged dyad) appear only with exactly 2 players.

## Scoring (strictly proper, zero-centered)

`points = round(100 × (1 − (1 − q)²)) − 75`, where q is the probability the guesser's
choice assigned to what the subject actually answered. The −75 shift zeroes a coin-flip
claim; an affine shift preserves properness, so honest confidence still maximizes
expected points.

| Button | Claimed odds | Right | Wrong (2 options) | Wrong (4 options) |
|---|---|---|---|---|
| Pass | 50% | 0 | 0 | −44 |
| Lean | 65% | +13 | −17 | −53 |
| Confident | 80% | +21 | −39 | −62 |
| Damn Sure | 95% | +25 | −65 | −72 |

Timeouts score 0 ("no guess"). Scale: dead-on +25, each step off −15, floor −65;
within one counts as "right" for stats. Free-form: the subject grades each guess
Cold 0 / Warm +10 / Hot +18 / Exact +25 (never negative — by the deepest questions
the scoreboard should be exiting). The confidence buttons display their percentage,
a fill bar, and the live win/lose stakes for the current question's option count.

**History:** the spec's all-positive scoring ("wrong Damn Sure still pays +10") was
implemented first and confused the owner instantly ("you should lose points if you're
wrong, no?"). Legibility beat the spec's loss-aversion argument; the visible stakes on
the buttons are the new anti-sandbagging measure. Watch playtests for Pass-camping.

## Stats are table talk, never a leaderboard

No running totals during play (they make people sandbag). Instead:
- **Truth flash:** one flavor line (streaks → "X is on a streak — 3 right in a row",
  Damn Sure crashes, "Everyone guessed it right"), and the subject sees
  **"2/3 guessed you right"** as their headline.
- **Vote screens:** names-only superlatives — "So far — best reader: X · open book: Y
  · hardest to read: Z".
- **End card** (built to screenshot): Oracle (best reader), Open Book / Enigma
  (easiest/hardest to read — labeled as stats, not scores), Boldest Call, Icarus
  (confident and wrong), per-player totals, legibility delta ("X got 34% easier to
  read as the game went on" — only with ≥3 guesses per half), and per-device lifetime
  calibration ("when you say Damn Sure you're right 71% of the time").

## The deck

`public/deck.json` is the user-authored deck and single source of truth (v2.1,
~164 questions, `{name}` placeholder, `{_meta, probes}` wrapper). The file keeps the
original 1–5 tiers; the loaders remap (2,3→Spicy; 4,5→Deep; tier 1 dropped as too
tame — surface trivia wastes the table's appetite). Three zero-stakes warm-up
questions live in code (`public/js/tutorial.js`) so they survive deck swaps.
The deck is the product — tune it after every play; cut anything that gets a flat
reaction when read aloud.

## Removed on purpose (the graveyard — don't resurrect)

| What | Why it died |
|---|---|
| 5-tier ladder + unanimous 3-way ballots every rotation | Too much ceremony; one cautious player silently froze the whole table at tier 1 |
| Tier-1 "Surface" questions in play | Boring; the game now opens with material worth gossiping about |
| Reply phase ("right of reply", +60s button) | A second discussion phase with an invisible timer; merged into one TALK screen with the subject's last word in the prompt |
| House-rule toggles (relational on/off, confidence on/off, eye-contact ritual, simple mode) | Settings screens are friction; sensible defaults only |
| Demo pace toggle | Stage-demo artifact that confused real players; one set of timers |
| Player caps (6, then 8) and the 3-player minimum | Owner's call: any count ≥2; big tables are allowed to discover their own physics |
| Dyad mode + offline thumbs fallback as separate modes | Merged into "local" — the dyad engine generalized to N players |
| All-positive scoring | Wrong answers must visibly lose points (see Scoring) |
| Per-rotation ballot on the final round | Voting to deepen a game that's ending reads as broken sequencing |
| Separate "read it out loud" screen between choosing and guessing | Predictors stared at a question they couldn't act on; guessing now opens while the subject reads, and their tap just starts the countdown |
| "X/Y locked in" dead screen after locking | Swapped your guess away mid-step; the question screen now keeps your locked pick plus a counter |
| Truth flash as its own screen | A 5-second full-screen swap right after the grid; the answer and points now land on the guess grid itself |

## Robustness rules (each one was a shipped bug)

- A disconnected player is never the subject (rotation skips ghost seats) and never
  counts toward rounds, vote majorities, or ballot cadence.
- A dead creator phone strands nothing: anyone present inherits lobby controls,
  settings, start, and "End the game" (`actingCreator` in server.js).
- Mid-game same-name rejoin evicts the zombie socket immediately — phones sleep
  during the 90s face-down talk by design, and must get their seat back in one step.
- Every error screen has an exit; "connecting…" failures return to the name screen.
- `render()` clears `#app.onclick`; screen tickers are keyed and idempotent
  (`everyFrame` in util.js). Both prevented "taps resurrect the previous phase".
- The big screen is entered with a code only (no name, no seat). The lobby's
  convert-this-device button exists for the created-on-laptop flow and says the seat
  survives a phone rejoin.

## Likely next steps (owner's direction, not started)

- Real multi-phone playtest at the venue — the actual remaining test. Tune the deck
  and the 90s talk cap from what it shows.
- Watch for Pass-camping under zero-centered scoring; if it appears, consider
  shrinking the Pass payoff gap rather than re-inflating misses.
- v2 stretch ideas from the spec that still apply: LLM "infinite deck" behind the
  deck's quality bar, exportable end-card image.
