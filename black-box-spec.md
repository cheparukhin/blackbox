# BLACK BOX — Game Design Spec v4 (final)

**Brief for the builder:** You are building a mobile-first web app for an in-person social game played at LessOnline/Manifest (Lighthaven, Berkeley). Two architectures in one app: **Dyad mode** is pure client-side, single-phone, pass-and-play (no networking, works fully offline). **Table mode (3–6 players)** is fully distributed: every player joins an ephemeral room on their own phone, and every phone is a complete mirror of the shared game state — there is no required host device and no required shared screen. A **big-screen stage is an optional bonus view**: any laptop/TV/tablet opening the room URL in display mode becomes a Jackbox-style stage, but game logic must never depend on one existing. No accounts, no feeds, no notifications. The app's job is to be a deck, a referee, and a timekeeper — and then to get out of the way. Read the whole spec before coding; the rationale sections explain *why* each mechanic exists, so don't "improve" a mechanic without checking what it's load-bearing for.

---

## 1. Concept

**You score points by demonstrating you understand the person in front of you — disclosure happens as verification.**

Core thesis, in two lines:

1. **The scoreboard licenses the staring.** Openly modeling a near-stranger's inner life is socially forbidden; a game makes it permissible. The score is an alibi for attention.
2. **Prediction accuracy rising over a session is, literally, the relationship forming — and the game measures it.** The end screen can truthfully say "You model Sarah 34% better than when you sat down."

This is *not* a disclosure game (Askhole) or a social-rating game (Glosso wars). The engine is **modeling with verification**: predict a specific person, commit, get verified, then explain what you saw. The richest moments happen off-screen, on a timer.

## 2. Design principles (in priority order)

1. **Fun and fast.** Table rounds ≤ 2 minutes. Dead air is a bug.
2. **Edgy with consent.** Boundary-pushing content exists but is gated behind unanimous, anonymous opt-in. Edge is unlocked, never imposed.
3. **Authentic relating.** The payload is structured noticing — people telling each other what they observed and imagined. The app scaffolds this lightly; it never facilitates heavily.
4. **Tech facilitates, never replaces.** With no shared screen, the phones are the only window into the game — so the app must actively push attention back to faces: input bursts ≤15 seconds, screens that *leave* (auto-dim to "look up" prompts) after delivering information, dead boring WAIT screens, vibration/flash/sound cues so nobody needs to watch their phone, and audio end-signals so phones can lie face-down during conversation.
5. **Rationalist-crowd appeal.** Proper scoring that survives an audit, calibration stats, forecasting flavor.
6. **Works at both scales.** One engine, two modes: a loud 9pm table game and a quiet midnight dyad game, with a designed funnel between them.

**Anti-goals:** no accounts, no feed, no push notifications, no live leaderboard during play, no AI content generation in v1.

## 3. Platform & networking

- Single-page app, mobile-first, dark theme (evening play), high contrast, large touch targets, one tappable decision per screen. Mobile Safari and Chrome.
- **Dyad mode must run with zero connectivity** — pure client-side, so it works in a basement corner at 1am.
- **Table mode networking:** ephemeral rooms with 4-character codes + QR join. Builder's choice of stack — Firebase RTDB, Supabase Realtime, PartyKit, or a tiny WebSocket relay all work. Requirements: all clients are views of one shared state machine; room creator is just a player (no host privileges beyond starting the game); reconnection by rejoining with the same first name reclaims your seat; a dropped player never blocks a round (commit timeout 15s → auto-Pass); state changes are coarse (~every few seconds), so latency tolerance is easy.
- **Optional stage view:** the room URL with a display flag (or a "use as big screen" button on join) renders a landscape, large-type, spectator-friendly mirror of the public state: lobby code/QR, probe, lock-in count, reveal grid, debrief timer, ballot results, end card. It shows nothing private. When present it becomes the natural focal point (true Jackbox); when absent the game is identical. *(Rationale: stageless and big-screen aren't competing designs once every client mirrors state — the stage is one extra read-only layout, near-zero coupling. Default play needs only phones and works on the courtyard grass.)*
- **Offline fallback (strongly recommended, cheap insurance for venue wifi):** if rooms won't connect, any single phone offers "fallback table mode" — one shared device, commitment is physical: the phone shows the probe and a 3-2-1 countdown, everyone reveals **thumbs up/down simultaneously on zero** (1–4 fingers for multiple choice), subject states truth aloud, someone taps in results. Reuses the same round state machine with the COMMIT screen swapped.
- Question deck in a plain JSON file, trivially editable. `localStorage` for optional persistence; degrade gracefully.
- Sounds are **load-bearing in table mode** (countdown ticks, reveal sting, debrief end-chime) since phones spend conversation phases face-down; toggleable, default on. iOS Safari lacks the vibration API, so always pair buzz cues with a screen flash and sound.

## 4. The two modes

| | **Table mode (3–6)** | **Dyad mode (2)** |
|---|---|---|
| Devices | One phone per player (optional big-screen mirror) | One shared phone, pass-and-play |
| Commitment | Private, simultaneous, on own phones | On-phone, hidden, alternating |
| Confidence | Four buttons (same engine; "simple mode" toggle available) | Four buttons |
| Probes | Binary, MC-4, over/under, relational | Binary, MC-4, scale 1–10, free-form (Tier 5) |
| Round length | ~2 min | ~2–3 min |
| Tiers | 1–4 (caps at 4) | 1–5 |
| Vibe | Loud, eruptive, competitive-lite | Quiet, deep, being-seen |

**The funnel (rationale):** table rounds generate exactly the curiosity dyad mode pays off — "I went 1-for-4 reading Dev; we're playing the deep version." When a table votes to push past Tier 4, the app's only response is social: *"This is dyad territory. Find a corner."* The evening arc — table of six at 9pm, pairs at midnight — is a designed feature. Dyad mode needing no room or connection makes peeling off frictionless.

## 5. Table mode — round loop

**Lobby:** anyone opens a table → room code + QR shown → players join on their phones with first names → start. One player per round is the **subject** (auto-rotating).

1. **PRIVATE PREVIEW (4s).** The probe appears on the *subject's phone only*, with a **Burn** button. Burn = silently draw another from the same tier — unlimited, costless, never logged, and *invisible*: the table never sees burned probes or knows a burn happened; other phones just show "drawing…". *(Rationale: consent with total deniability — nobody knows if the probe that lands is the first or third draw.)*
2. **PROBE — the read-aloud ritual.** The probe appears on all phones, but the **subject reads it aloud**, prompted by name ("Sarah, read it out"). *(Rationale: with no shared screen, the spoken word is the shared focal point. The subject voicing their own question is also an ownership beat — they previewed it, kept it, and now offer it to the table.)*
3. **COMMIT (≤15s, parallel).** Phones buzz/flash awake. Predictors privately pick an answer **plus one of four confidence buttons** (Pass / Lean / Confident / Damn Sure — see §6; a "simple mode" house rule reduces this to a bare answer for mixed crowds). The subject simultaneously enters their true answer. Each phone locks to a dead "phones down" screen on submit, showing only the lock-in count ("3/5 in"). Timeout → auto-Pass.
4. **REVEAL — choreographed look-up.** A synchronized 3-2-1 sting, then every phone shows the full grid at once: **all predictions, names and confidence attached** — "Marcus: YES, Damn Sure. Lena: NO, Lean." Splits flagged: *"Table split 3–2."* After ~6 seconds the screens *leave* — auto-dim to **"Look up. Sarah, tell them."** (grid peekable with a tap). The subject states their truth out loud, to faces; then the subject taps confirm, and truth + points flash briefly on all phones. No running totals appear. *(Rationale: heads dip to receive information, then the app physically takes the screen away to force eyes back up. The spoken truth is non-negotiable: the phone confirms; the human discloses. Attribution on every guess is what makes the debrief possible.)*
5. **DEBRIEF (cap 90s).** All phones show full-screen **"phones face down"** with inputs disabled; a soft chime marks the cap (face-down phones still emit sound — the cap needs an end signal, not a watched countdown). Predictors explain what they noticed; house rule shown once at setup: **the minority report speaks first.** Anyone may flip their phone and tap to end early or add 30s. If a phone is flipped mid-debrief, it shows only the faint AR stems ("I noticed… / I imagined you as someone who…") — a hint, never a requirement. *(Rationale: the timer is a cap, not a quota. Ninety seconds of all screens being useless is the app's most important feature; protect it.)*
6. **REPLY (cap 30s).** Subject's right of reply; an *"it's more complicated"* button adds 60s and never affects scores.
7. Rotate. After each full rotation, the **tier ballot** (§7) fires on all phones simultaneously.

**Tradeoffs, recorded so nobody relitigates them blindly:** distributed-private trades the shared focal point and embodied thumbs-commitment for parallel input, invisible burns, instant anonymous ballots, automatic scoring, group-mode credences, and play-anywhere portability. The compensations are deliberate: read-aloud ritual, choreographed look-ups, audio end-signals, optional big-screen mirror when a real stage exists, optional eye-contact ritual toggle (3s before each reveal), and thumbs surviving in the offline fallback.

## 6. Dyad mode — round loop

Single shared phone, roles alternate every round, no room needed.

1. **PROBE** + 5s burn window (subject sees it first; burning is visible at n=2 and that's fine).
2. **PREDICT.** Predictor privately selects an answer plus one of four **confidence buttons**:

   | Button | Implied credence | Points if right | Points if wrong |
   |---|---|---|---|
   | Pass | 50% | 75 | 75 |
   | Lean | 65% | 88 | 58 |
   | Confident | 80% | 96 | 36 |
   | Damn Sure | 95% | 100 | 10 |

3. **TRUTH.** Phone passes; subject privately enters their answer.
4. **REVEAL.** Both shown at once; points flash briefly.
5. **DEBRIEF** (cap 60–90s, dim screen, same rules as table) + right of reply.

**The scoring math (one engine for both modes — implement exactly):** points = round(100 × (1 − (1 − q)²)), where q is the probability the predictor's choice assigned to the true outcome. Binary: q = p if right, 1 − p if wrong. Multiple-choice (4 options): residual mass splits evenly, so q = (1 − p)/3 when wrong — confident MC misses score lower, as they should. Scale probes (1–10, dyad only): no confidence button; points = max(10, 100 − 15 × |error|).

*(Rationale: this is an affine transform of the Brier score, so it is **strictly proper** — the expected-points-maximizing strategy is always reporting your true credence (nearest button). It will survive an audit by this crowd. The all-positive transform matters behaviorally: an earlier draft had confident misses at −224, and loss-averse players respond to that by sandbagging at "Lean" forever, which deflates exactly the bold-call drama the scoring exists to create. Here a confident miss feels like "won almost nothing," not "bled out." Discrete buttons instead of a slider: faster input, no math anxiety for plus-ones. Pass paying 75 is correct and intentional — any proper rule that zeroes the abstain must go negative on misses, so abstaining pays "participation" and the spread is framed as bonus-for-boldness. Scores stay invisible during play in both modes; totals surface only at session end.)*

**Tier 5 (dyad only) — free-form.** Predictor types a one-sentence prediction (e.g., the probe is *"What does B most fear you've already noticed about them?"*), subject types their true answer, simultaneous reveal, then the **subject grades it**: Cold (10) / Warm (40) / Hot (75) / Exact (100). *(Rationale: loosely scored on purpose. By Tier 5 the scoreboard has done its job — licensed an hour of staring — and quietly exits. Verification goes subjective because the content has outgrown discrete answers; this is the structural price of the prediction mechanic, accepted knowingly: closed probes buy verified being-seen at the cost of open-question richness, and Tier 5 is where the richness comes back.)*

## 7. Tiers & consent architecture

Five tiers; the deck is tagged. Sessions start at Tier 1.

- **T1 Surface** — playful calibration fodder.
- **T2 Character** — values, dispositions, self-model.
- **T3 Skin** — money, status, envy, body, loneliness.
- **T4 Confession** — regrets, betrayals, the unsaid; relational probes live here.
- **T5 Vault** — dyad-only, free-form, the unsayable.

**Unlock ballot.** After each full rotation (table) or every 3 rounds (dyad), a **secret ballot**: Deepen / Stay / Retreat. In table mode it fires on all phones simultaneously — instant and truly anonymous; in dyad mode the phone passes. Resolution: any Retreat → drop one tier; else any Stay → stay; else deepen. The app **never shows vote counts or who voted what** — only the outcome, phrased neutrally: *"The table stays at Tier 2."* *(Rationale: unanimity makes deepening a genuine joint act; anonymity gives the hesitant player full deniability. Vote counts would leak exactly the information anonymity exists to hide.)*

**Caps and the splinter.** Table mode hard-caps at T4. A table vote to deepen past T4 triggers the splinter screen suggesting dyads.

**House-rules toggles (settings):** confidence buttons on/off in table mode (default on), sounds, timer lengths, eye-contact ritual (default off). **No content toggles or probe flags** — the tier ballot is the consent mechanism, full stop. A table that has unanimously voted its way to Tier 4 has opted into everything Tier 4 contains, and the subject always retains the invisible burn.

## 8. Honesty norms

One screen at setup, three lines, must be tapped through:

> Answers are **true or burned — never false**. Burning is always free and invisible. You cannot score points by being hard to read, so deceiving the table isn't strategy — it's just defecting against the point.

*(Rationale: no subject-side scoring exists anywhere in the game — legibility is a stat, never a score — so there is no mechanical incentive to lie. The debrief is the social enforcement: fabricated answers wilt under ninety seconds of "wait, really? but you said earlier—".)*

## 9. The deck

Ship with the provided **`black-box-deck.json`** (164 original probes, tagged and build-ready — see its `_meta` for conventions). Schema per probe: `{ id, text, tier, modes: [table|dyad], answerType: binary|mc4|overunder|relational|scale|freeform, options?, category }`. Probe `text` contains the literal token `{name}`; the app renders it as the current subject's first name (this spec's prose uses "B" as shorthand for the same thing). Categories: history, disposition, forced-choice, self-model, relational, live, meta. No flags or content gates — tier placement is the only spice control. "Live" probes are verifiable on the spot (phone battery, screen time, waiting-on-a-text) — physical comedy plus unfakeable verification, ideal Tier 1 trainers. "Meta" probes make the yes/no itself the disclosure ("Does B have a secret that would change how this table sees them?" — no, they don't have to say what). Negative-valence relational probes are written as roast-energy, where being named is a badge ("darkest browser history"), not rejection-energy that wounds a third party who never consented.

**Probe quality bar (write to this, reject below it):**
- **Predictable-in-principle**: a stranger should have *some* signal after ten minutes of shared presence. ("Has B ever been in a physical fight" — readable from vibes. "B's favorite childhood food" — unguessable trivia, reject.)
- **Interesting whichever way it lands.** Both YES and NO should reveal character.
- **Fast to verify**: the subject must be able to answer honestly in five seconds.
- **The reasoning is the prize.** The best probes make the *debrief* explanation ("what made you guess that about me?") more interesting than the answer.

**Seed probes (extend to ~100 in this exact voice, calibrated to the LessOnline/Manifest crowd — forecasting, status anxiety, ambition, weird beliefs, intimacy, shame):**

*T1 Surface:* Has B ever pretended to have read a book to impress someone? · Has B cried at a Pixar movie? · Has B googled themselves this month? · Over/under: 40 browser tabs open on B's laptop right now. · Has B eaten food off the floor as an adult this year? · Has B ever kept a New Year's resolution past March?

*T2 Character:* Would B rather be respected than liked? · Does B believe they'd stay psychologically intact through a year in prison? · Does B believe in any form of afterlife, even a weird one? · Would B take a pill that permanently removed their need for others' approval? · Does B think they're in the top decile of self-awareness at this table? (self-model) · Does B have a five-year plan they actually believe in? · Has B ever held a Manifold position they'd be embarrassed to explain?

*T3 Skin:* Has B cried about money in the last five years? · Does B currently envy someone at this event? · Does B check how a post is performing within ten minutes of posting it? · Does B feel behind their peers professionally? · Has B cried about AI risk? · Does B believe their IQ is higher than their best friend's? (self-model) · Over/under 3: people B has loved who never knew. · Has B ever lied about their body count — in either direction?

*T4 Confession:* Has B ever ghosted someone who loved them? · Has B ever betrayed a partner's trust in a way they never disclosed? · Is there a person B still thinks about that they believe they shouldn't? · Has B ever subtly sabotaged a friend's chance at something? · (relational) Who at this table would B trust with a real secret? · (relational) Who here is B most curious about? · (relational) Who at this table does B think understands them best so far?

*T5 Vault (dyad, free-form):* What does B most fear you've already noticed about them? · What's the loneliest B has felt this year — and what was happening? · What would B do with one week of guaranteed anonymity? · What does B want that they've never said out loud? · What is B performing right now, in this conversation?

**Relational probes in table mode:** predictors privately select a player name; the subject privately selects theirs; the reveal grid shows all picks with names attached. (The drama survives the move from pointing to screens because attribution survives.)

## 10. Session structure & end screen

- **Setup (≤60s):** lobby/names → mode → honesty screen → one **T0 tutorial probe** (trivial, e.g., "Did B drink coffee today?") to teach the loop with zero stakes.
- **Defaults:** table = 12 rounds (~25–30 min with ballots); dyad = 10 rounds (~25 min). Then a "continue?" prompt; sessions can run indefinitely.
- **End screen — built to be screenshotted; full card on every phone (and stage, if present):**
  - **Oracle** — best reader (highest average points; in simple mode, most correct).
  - **Open Book / Enigma** — most/least legible subject. Displayed as a stat with explicit framing "(not a score)".
  - **Boldest Call** (highest-confidence correct) & **Icarus** (most confident miss) — both modes.
  - **Legibility delta** — per subject (table) or per pair (dyad): first-half vs second-half hit rate, framed playfully: *"The table reads Sarah 34% better than an hour ago."* Only show when ≥3 predictions per half; small samples stay silent rather than lie.
- **Persistence (optional, localStorage, per device):** session history; lifetime calibration curve — stated confidence vs realized accuracy ("You say Damn Sure, you're right 71% of the time") — so people learn whether they're calibrated about *humans*, not just AI timelines.

## 11. Screen inventory (keep it this small)

**Table mode (every phone):** JOIN/LOBBY → WAIT ("phones face down", dead) → PREVIEW+BURN (subject only) → PROBE (read-aloud prompt) → COMMIT INPUT → LOCK ("3/5 in") → REVEAL GRID (→ auto-dim "Look up — [name], tell them") → TRUTH+POINTS flash → DEBRIEF ("phones face down" + chime at cap) → REPLY → BALLOT → STATS/personal card. 
**Optional stage view (read-only, landscape):** LOBBY (code+QR) → PROBE → LOCK COUNT → REVEAL GRID → DEBRIEF TIMER → BALLOT RESULT → STATS. 
**Dyad (single device):** SETUP → PROBE(+burn) → PREDICT → PASS → TRUTH → REVEAL → DEBRIEF → REPLY → BALLOT → STATS. 
Settings drawer for house rules. Nothing else.

## 12. Out of scope v1 / stretch for v2

Out: accounts, persistent rooms, AI anything, free-form typing in table mode. Stretch only if v1 is solid: "infinite deck" via LLM generation with the §9 quality bar as the prompt; export/share card as image; richer big-screen stage theming.

## 13. Playtest checklist (run tonight before polishing anything)

1. **Networking smoke test first:** 4–5 phones joining a room on Lighthaven wifi, then on a phone hotspot. If either is flaky, the offline thumbs fallback gets promoted from insurance to priority.
2. One table round end-to-end: does PREVIEW→read-aloud→COMMIT→REVEAL land in under two minutes? Do the "look up" auto-dims actually pull eyes off screens, or do people keep peeking? Do phones go face-down for the debrief? (If fidgeting: make the WAIT and DEBRIEF screens even deader.)
3. One dyad round at Tier 3: does it feel like connection or homework? (If homework: shorten the debrief cap before touching anything else.)
4. One invisible burn and one ballot: does the consent machinery feel safe and frictionless?
5. Read 20 random probes aloud to one person from the target crowd; cut any that get a flat reaction. The deck is the product; tune it nightly.
