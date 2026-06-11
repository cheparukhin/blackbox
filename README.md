# BLACK BOX

Mobile-first web app for an in-person social game: score points by demonstrating you
understand the person in front of you. **[DESIGN.md](DESIGN.md) is the current game
design and decision log** ([black-box-spec.md](black-box-spec.md) is the original spec,
kept for history; the game has deliberately diverged from it). [CLAUDE.md](CLAUDE.md)
holds the working invariants for AI-assisted iteration.

One scoring engine (a strictly proper, zero-centered Brier transform: Pass = 0, right
answers gain, wrong answers lose), two modes:

- **Distributed (everyone's phone, 2+)** — ephemeral 4-char rooms over a tiny
  WebSocket relay. Every phone mirrors the one server-side state machine; the server
  filters each client's view so burns stay invisible, commits stay private until the
  reveal, and ballots stay anonymous forever. No host device required.
- **Local (one phone, 2+)** — pure client-side pass-and-play: each predictor takes
  the phone in turn and commits privately, so full scoring survives offline. A
  service worker caches the whole app, so once loaded it runs with zero
  connectivity. With exactly two players the deep pool includes the free-form
  and 1–10 scale questions.

Two play levels, one guardrail: every game starts **Spicy** (envy, crushes, status
anxiety) and a secret majority vote once per rotation can take it **Deep**
(confessions, who-of-us picks, the unsaid). The invisible burn is the per-question
veto; that's the consent machinery.

Plus an optional **stage view** (`/?room=CODE&stage=1`, or "use this device as a big
screen" in the lobby).

## Run

```sh
npm install
npm start            # http://localhost:3000 — prints the LAN URL phones should use
PORT=8080 npm start  # custom port
```

Phones must reach the laptop: same wifi (or a phone hotspot), then open the printed
`http://<lan-ip>:3000` URL. For HTTPS/production, put it behind any TLS proxy; the
client auto-selects `wss://`.

`node test/smoke.mjs` drives a full 4-player game over websockets (guesses → reveal →
talk → vote → end card) with fast timers and checks the scoring math.
`node test/bots.mjs` spawns three self-playing bots and prints a room code — join from
a browser to click through the real screens.

## Deploy (free)

The app needs a long-lived Node process for the WebSocket relay, so serverless hosts
(Vercel, Netlify, GitHub Pages) won't run table mode. [Render](https://render.com)'s
free tier does:

1. Render dashboard → **New → Blueprint** → connect this GitHub repo. It reads
   [render.yaml](render.yaml) and deploys `node server.js` with HTTPS/WSS for free.
2. Every push to `main` auto-deploys.

Free-tier notes: the service spins down after ~15 idle minutes (first visitor waits
~30–60s), and a restart drops live rooms — players rejoin with the same name and
reclaim their seats. Dyad mode keeps working offline once a phone has loaded the app.

## Layout

- `server.js` — static files + room relay + the authoritative round state machine
- `public/deck.json` — the deck (v2.1, `{name}` placeholder; master copy at
  `black-box-deck.json`). The file is tiered 1–5; play remaps it to two levels
  (T2+T3 → Spicy, T4+T5 → Deep, T1 dropped as too tame). The deck is the product;
  tune it nightly, it's plain JSON. Warm-up probes live in `public/js/tutorial.js`
  so they survive deck swaps.
- `public/js/scoring.js` — the proper scoring rule (shared verbatim by server & client)
- `public/js/stats.js`, `statsview.js` — end-card math + rendering (Oracle, Open Book,
  Enigma, Boldest Call, Icarus, legibility delta, lifetime calibration)
- `public/js/table.js` / `stage.js` — distributed-mode phone + big-screen mirrors
- `public/js/local.js` — the one-phone pass-and-play mode

## Before tonight (playtest checklist)

1. Networking smoke test on venue wifi *and* a phone hotspot — if flaky, lead with
   local mode.
2. One distributed turn end-to-end under two minutes; watch whether the auto-dim
   actually pulls eyes up off the phones.
3. One two-player local game into Deep — connection or homework?
4. One invisible burn, one go-deeper vote.
5. Read 20 random questions aloud to someone from the target crowd; cut flat ones.
   The deck is the product; tune it nightly.
