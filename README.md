# BLACK BOX

Mobile-first web app for the in-person social game in [black-box-spec.md](black-box-spec.md):
score points by demonstrating you understand the person in front of you. One scoring
engine (a strictly proper, all-positive Brier transform), two modes:

- **Table mode (3–6)** — one phone per player, ephemeral 4-char rooms over a tiny
  WebSocket relay. Every phone mirrors the one server-side state machine; the server
  filters each client's view so burns stay invisible, commits stay private until the
  reveal, and ballots stay anonymous forever. No host device required.
- **Dyad mode (2)** — pure client-side pass-and-play on one phone. A service worker
  caches the whole app, so once loaded it runs with zero connectivity. Tiers go to 5.

Plus an optional **stage view** (`/?room=CODE&stage=1`, or "use this device as a big
screen" in the lobby) and an **offline fallback table** (one phone, thumbs on zero)
in case venue wifi dies.

## Run

```sh
npm install
npm start            # http://localhost:3000 — prints the LAN URL phones should use
PORT=8080 npm start  # custom port
```

Phones must reach the laptop: same wifi (or a phone hotspot), then open the printed
`http://<lan-ip>:3000` URL. For HTTPS/production, put it behind any TLS proxy; the
client auto-selects `wss://`.

`node test/smoke.mjs` drives a full 4-player round over websockets (commit → reveal →
truth → debrief → reply → ballot) with fast timers and checks the scoring.

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
- `public/deck.json` — the deck (v2.1, 164 probes, tiered T1–T5, `{name}` placeholder;
  master copy at `black-box-deck.json`). The deck is the product; tune it nightly,
  it's plain JSON. T0 tutorial probes live in `public/js/tutorial.js` so they survive
  deck swaps.
- `public/js/scoring.js` — the proper scoring rule (shared verbatim by server & client)
- `public/js/stats.js`, `statsview.js` — end-card math + rendering (Oracle, Open Book,
  Enigma, Boldest Call, Icarus, legibility delta, lifetime calibration)
- `public/js/table.js` / `stage.js` — table-mode phone + big-screen mirrors
- `public/js/dyad.js`, `fallback.js` — the offline modes

## Before tonight (spec §13)

1. Networking smoke test on venue wifi *and* a phone hotspot — if flaky, lead with the
   offline fallback.
2. One table round end-to-end under two minutes; watch whether the auto-dim actually
   pulls eyes up.
3. One dyad round at Tier 3 — connection or homework?
4. One invisible burn, one ballot.
5. Read 20 random probes aloud to someone from the target crowd; cut flat ones.
