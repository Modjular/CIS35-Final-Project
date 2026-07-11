# CIS35-Final-Project — Field Command (JS port)

A Clash-Royale-style two-player tug-of-war: drag unit cards onto your half of the
field, units cost mana and march down lanes toward the enemy HQ, auto-fighting
whatever they meet. First HQ destroyed loses.

This repository contains **two** things:

- **The web port** (`index.html`, `src/`, `assets/`) — a dependency-free vanilla
  JavaScript browser game, playable offline as local two-player hotseat. This is
  the active project.
- **The original Unity prototype** (`Assets/`, `ProjectSettings/`, `Packages/`) —
  Unity 2018.2, kept read-only as the design reference and art/audio source.

![gameplay][gameplay]

## Running

No build step, no npm install. Serve the repo root over HTTP (ES modules need a
server; `file://` won't work) and open it:

```sh
python3 -m http.server 8000      # then visit http://localhost:8000/
```

Run the simulation tests (Node ≥ 18, no dependencies):

```sh
node --test
```

## How to play (local hotseat)

Two players share one screen and pointer (mouse or touch).

- **Red** uses the card row at the **bottom-left**; **Green** the **bottom-right**.
- **Press a card, drag onto your half, release** to place. A ghost shows the
  snapped grid cell — white = valid, red = invalid (wrong half or too little mana).
- Red may place in the left half (x 0–10), Green in the right (x 12–22); the
  **Explosion** spell may be cast anywhere.
- Mana starts at 6, caps at 10, and regenerates +1 every 3.6 s. Cards you can't
  afford are grayed out.
- Destroy the enemy HQ to win. Hit **Play again** on the game-over overlay to reset.

Cards (both players get the same symmetric hand):

| Card | Unit | # | Cost | Notes |
|---|---|---|---|---|
| Tank | TANK | 2 | 4 | balanced |
| MdTank | MTANK | 1 | 5 | slow, tanky, hits hard |
| Infantry | INFANTRY | 3 | 2 | cheap swarm |
| Recon | RECON | 1 | 3 | fast, fragile |
| Explosion | spell | — | 3 | 85 dmg + knockback, radius 1.5, anywhere |

### Debug console

`window.game` is exposed for scripting/inspection:

```js
game.cmd('p1', 'PLACE_UNITS', 'tank', 5, 8);       // place red tanks at world (5,8)
game.cmd('p2', 'CAST_SPELL', 'explosion', 15, 6);  // green casts explosion
game.state;                                         // live, JSON-serializable state
game.reset();
```

## Architecture

The load-bearing rule: **`src/sim/` is a pure, DOM-free, deterministic
simulation.** It has no `window`/`document`/`performance`, no RNG, and no asset
references, so it runs unchanged in Node (for tests) and could run on a server
later. Rendering, audio, and input only *observe* the sim — they never mutate it.

```
index.html            # canvas + module entry
src/
  main.js             # bootstrap + fixed-timestep loop (accumulator + interpolation)
  sim/
    data.js           # ALL gameplay constants (verified against the Unity source)
    state.js          # createInitialState(), entity factories, serialize/deserialize
    sim.js            # step(state, commands): targeting, combat, mana, spell, win
    physics.js        # Euler integrate, drag, clamp, circle/circle & circle/wall
  render/
    camera.js         # letterbox world<->screen transform (shared with input)
    renderer.js       # draw loop; sprite backend + debug backend behind one API
    sprites.js        # atlas load + animation playback (render-time only)
    hud.js            # card rows, mana bars, drag ghost, game-over overlay
  input/
    pointer.js        # pointer events -> drag -> commands (mouse + touch)
  audio/
    sound.js          # Web Audio buffer pool; sim events -> SFX
assets/
  atlas.json          # frame rects + image table (generated)
  sprites/  audio/     # extracted from the Unity project
tools/
  extract_atlas.py    # one-off: Unity .png.meta slice rects -> atlas.json + asset copy
  smoke.mjs           # headless Chromium smoke test / screenshot grabber
test/
  sim.test.js         # targeting, mana, placement, combat, win
  determinism.test.js # replay determinism, save/resume round-trip, DOM-free check
```

Two ideas make this port multiplayer-ready:

- **Fixed-timestep determinism.** The sim ticks at a fixed 30 Hz (`DT = 1/30`).
  The render loop accumulates real time, advances the sim in whole ticks, and
  interpolates positions between the previous and current tick for smooth drawing.
  Same initial state + same command stream ⇒ byte-identical state (tested).
- **Commands, not clicks.** The only way anything enters the sim is
  `step(state, commands)`, where each command is
  `{ playerId, type: 'PLACE_UNITS' | 'CAST_SPELL', card, x, y }`. Local input
  produces these; validation (bounds, mana, grid snap) lives in the sim via
  `previewCommand`/`applyCommand`, not the UI.

### Adding networked multiplayer later

The seams are already in place:

- **Player identity is separate from team and input device** —
  `player = { id, team, mana }`. A remote client is just another `playerId`.
- **Transport the command objects.** Instead of applying local commands
  immediately, tag each with its target tick and exchange them (lockstep: apply
  every peer's commands for tick *N* before stepping *N*; or rollback: re-simulate
  from the last agreed state when a late command arrives). The sim already accepts
  a per-tick command list and is deterministic, so both models drop in.
- **State is one plain-JSON object** (`serialize`/`deserialize` round-trip is
  tested), so snapshots for join-in-progress or rollback are free.
- No RNG exists today; if one is ever added, seed it inside `state` so replays
  stay deterministic.

## Rendering & physics choices

- **Bespoke Canvas 2D, no game library.** The board peaks well under 100 small
  sprites, where Canvas 2D holds 60 fps trivially; a WebGL backend would buy
  nothing perceptible. The renderer sits behind a small interface so one could be
  swapped in without touching the sim.
- **Bespoke ~2D physics** (`physics.js`, ~120 lines). The Unity original only used
  zero-gravity `AddForce` steering with a velocity clamp, linear drag, circle
  colliders (units push each other), boundary walls, and a one-shot knockback
  impulse. This port reproduces that feel with semi-implicit Euler + the same
  force/drag/mass, so units cruise at `speed / (mass · drag)` exactly as they did
  in Unity. No physics dependency needed.

## Credits

Original prototype (Unity), design and code:

- Oscar — oscarreks@gmail.com — Coding and Design
- Tony — toscarreks@gmail.com — Coding and Art

Unit/HQ/explosion sprites and sound effects are **borrowed from Advance Wars**
(Intelligent Systems / Nintendo), as noted in the original prototype — used here
for a non-commercial class project.

[gameplay]: Assets/Sprites/gameplay_1.gif
