# Port Unity Game "CIS35-Final-Project" to a Vanilla JS Webapp

## Context

The Unity prototype in **this repo (`Modjular/CIS35-Final-Project`)** (Unity 2018.2, ~1,600 lines of C#) is a Clash Royale–style two-player tug-of-war: players drag unit cards onto their half of the field, units cost mana, march down lanes toward the enemy HQ tower, auto-fight what they meet, and the first tower destroyed loses. The goal is to port it to a browser game **in this same repo** on branch **`claude/unity-game-js-port-r1p306`**, playable offline as a local two-player (shared screen/mouse) MVP, with the simulation structured so real multiplayer can be added later. The web app lives at the repo root alongside the untouched Unity project (`Assets/` etc.), which doubles as the in-tree asset source.

User decisions already made:
- **Scope: parity + small QoL fixes** (listed below) — no new features from the README wishlist.
- **Renderer: bespoke Canvas 2D, zero runtime dependencies, no build step.** PixiJS/WebGL2 were evaluated and rejected: the game peaks well under 100 concurrent sprites of pixel art, where Canvas 2D holds 60fps trivially and GPU batching buys nothing perceptible. Keep the renderer behind a small interface so a WebGL2 backend could be swapped in later without touching the sim.
- **Physics: bespoke.** The Unity code only uses: zero gravity, `AddForce` steering with a velocity clamp, linear drag, circle colliders (units push each other), boundary walls, and a one-shot knockback impulse. No raycasts (that code path is commented out), no joints; the `Bullet` prefab is vestigial — combat applies damage directly. This is ~200 lines: semi-implicit Euler integration + circle-circle and circle-vs-bounds resolution.

## Source material

The Unity project is **already in this repo** — no cloning needed. Treat `Assets/` as a read-only reference and asset source; do not modify or delete Unity files.
Reference scripts (all under `Assets/Scripts/`): `GameManager.cs`, `Unit.cs`, `GroundUnit.cs`, `Tower.cs`, `UnitStats.cs`, `HoldDragPlaceUnit.cs`, `HoldDragPlaceSpell.cs`, `Spell.cs`, `HealthBar.cs`, `UnitSpriteManager.cs`, `SoundManager.cs`, `UIManager.cs`, `MoveBullet.cs` (vestigial), `DragDrop.cs` (dead code), `Messenger.cs` (unused generic event bus — do not port).

## Game specification (extracted from the Unity code — this is the porting contract)

*All constants below have been re-verified against the C# sources and prefab YAML in this repo (`UnitStats.cs`, `GroundUnit.cs`, `GameManager.cs`, `Tower.cs`, `HoldDragPlaceUnit.cs`, `Assets/UnitPrefabs/**`). Trust the tables; consult the source only for behavioral nuance.*

### Field & camera
- World: **22 × 12** units, origin bottom-left. Red = left half (x 0–10 placement), Green = right half (x 12–22 placement). Rows y 0–12.
- Camera: orthographic size 7 → view height 14 world units, field centered. For the port: letterbox a fixed 22:12 (11:6) playfield into the canvas, integer-ish scale for pixel art, `imageSmoothingEnabled = false`.
- Background: `Assets/Sprites/Maps/map1_waterV2.png` stretched to the field.
- Boundary walls on all four field edges (units collide, spells clamp).

### Towers (HQ)
- Positions: Red HQ **(2.5, 6)**, Green HQ **(19.5, 6)**. Stats: **1,200 HP, 40 attack, one shot per 2 s**, range = sight radius **4**. Static circle body (units collide with it, it never moves). Tower death → game over for its team.

### Units (`UnitStats.cs`)
| Unit | attack | health | speed | cost | range | attack period (s) |
|---|---|---|---|---|---|---|
| TANK | 30 | 120 | 1.2 | 4 | 2.5 | 1.0 |
| MTANK | 50 | 200 | 0.8 | 5 | 2.5 | 1.2 |
| INFANTRY | 15 | 80 | 1.2 | 2 | 2.0 | 0.75 |
| RECON | 20 | 100 | 1.6 | 3 | 2.0 | 0.5 |

- Shared sight radius **4**. Attack is instant damage on cooldown while target in `range` (no projectile).
- Physics body: circle radius per unit (**≈0.18** tank/mdtank/recon, **≈0.13** infantry — from prefab colliders), mass 1.5, linear drag 1, velocity clamped to `speed`. Steering = apply forward force of magnitude `speed` each fixed step while `|v| < speed` (reproduce feel, don't overthink — a "accelerate toward target, clamp at speed, apply drag" model is the honest port).
- **Targeting**: if no live target, scan enemy team; take the **closest** enemy within sight radius (QoL fix — Unity took first-found); otherwise target the next lane waypoint / enemy HQ.
- **Lanes** (`GroundUnit.cs`): two waypoint paths per direction. Rightward (Red): top `[(9.5,9.5),(19.5,9.5),(19.5,6)]`, bottom `[(9.5,2.5),(19.5,2.5),(19.5,6)]`. Leftward (Green): top `[(12.5,9.5),(2.5,9.5),(2.5,6)]`, bottom `[(12.5,2.5),(2.5,2.5),(2.5,6)]`. Lane chosen by spawn y (> 6 → top), re-evaluated each step; advance to next waypoint when within **0.9**.

### Mana & cards
- Per player: start **6**, max **10**, +1 every **3.6 s**. Card grays out when unaffordable.
- Cards (from prefabs; QoL fix: give **both** players the same symmetric 5-card hand):

| Card | unit | count | mana cost | placement |
|---|---|---|---|---|
| Tank | TANK | 2 (offset ±0.3 y) | 4 | own half |
| MdTank | MTANK | 1 | 5 | own half |
| Infantry | INFANTRY | 3 (±0.2 y, +0.1 x) | 2 | own half |
| Recon | RECON | 1 | 3 | own half |
| Explosion | spell | — | 3 | anywhere |

- **Placement UX** (`HoldDragPlaceUnit.cs`): press on card → ghost sprite (50% alpha) follows pointer, snapped to the 1×1 grid (cell centers, `ceil(pos) − 0.5`, clamped to bounds). Release: if in-bounds and affordable → spend mana + spawn; else error sound. Red may place at x 0–10, Green at x 12–22, y 0–12 (spell: full field).
- **Explosion spell** (`Spell.cs` + EXPLOSION prefab): **85 damage, radius 1.5, knockback impulse 60** away from center, to every enemy unit *and* tower in radius; plays a one-shot explosion animation (~0.6 s) then despawns.

### Presentation
- Sprites: Advance Wars sheets already in the Unity repo. Red player = Orange Star (`Assets/Sprites/Units-OrangeStar/`, `Assets/Animations/OS*/`), Green = Green Earth (`Units-GreenEarth/`, `GE*`). Each unit has **moving** and **firing** looped animations; HQ sprites are static; explosion has a one-shot animation (`Assets/Animations/Explosions/`).
- Facing: sprite `flipX` when moving/aiming leftward (sprite itself never rotates).
- Draw order: y-sort (lower y drawn later/on top — Unity used z = y/12).
- Health bars: green bar above each unit/tower, width scales with health %, shown always (bar sizes: small/medium/large ≈ 0.8/1.0/1.5 scale; towers large).
- Hit feedback: sprite flashes (tint toward cyan, ~0.3 s decay) on damage, plus damage sound.
- Sounds (`Assets/Sounds/`): firing (`shot.wav`/`heavy shot.wav`), damage (`damage.wav`), placement (`placement.wav`), error (`song104-error.wav`), death (`death.mp3`), explosion. Single shared channel at low volume (0.2–0.3) is faithful; a tiny pool of `AudioContext` buffer sources is the clean web equivalent.
- Mana bars: bottom center HUD, one per player, draining/filling per current mana (Unity drew "empty" overlay of width `(10 − mana)/10`).
- **Game over (QoL fix)**: overlay declaring the winner + "Play again" button (Unity insta-reloaded the scene).

## Architecture (multiplayer-minded — this is the load-bearing structure)

**Hard rule: `src/sim/` is pure and DOM-free** — no `window`, `document`, `performance`, `Math.random`, or asset references. It must run unchanged in Node for tests and, later, on a server. Rendering/audio/input observe the sim; they never mutate it.

- **Fixed-timestep deterministic simulation**: tick at **30 Hz** (`DT = 1/30`); render loop (`requestAnimationFrame`) accumulates real time, steps the sim 0..n times, and draws with interpolation between the last two states (store prev/cur position per entity). All gameplay constants in one `data.js`.
- **Commands, not clicks**: the only way anything enters the sim is `applyCommand(state, cmd)` with `cmd = { tick, playerId, type: 'PLACE_UNITS' | 'CAST_SPELL', card, x, y }`. Local input produces commands; future multiplayer transports the same objects. Validation (bounds, mana, cell) lives in the sim, not the UI.
- **Player data model**: `{ id: 'p1'|'p2', team: 'red'|'green', mana: number, hand: [cardIds] }` — identity separate from team and from input device.
- **State**: one plain-JSON-serializable object `{ tick, players, units[], towers[], effects[], winner }`; entities are plain objects with numeric ids. `JSON.stringify(state)` must round-trip.
- **Determinism**: no RNG needed (the game has none); if one is ever added, seed it in state. Same command list ⇒ identical state hash (tested in Phase 4).

### File layout (repo root, so GitHub Pages can serve it directly)
```
index.html
src/
  main.js               # bootstrap, RAF loop, fixed-step accumulator
  sim/
    data.js             # ALL constants: stats, cards, lanes, field, mana, spell
    state.js            # createInitialState(), serialization helpers
    sim.js              # step(state, dt-tick), applyCommand(), targeting, combat, mana, win
    physics.js          # integrate, drag, clamp, circle-circle & circle-walls resolution
  render/
    renderer.js         # canvas setup, letterbox transform, draw loop, y-sort, interpolation
    sprites.js          # atlas + animation playback (frame timing per anim)
    hud.js              # cards row, mana bars, ghost preview, game-over overlay
  input/
    pointer.js          # pointer events → drag state → commands (mouse + touch)
  audio/
    sound.js            # AudioContext, buffer loading, play(name, vol)
assets/
  atlas.json            # frame rects + animation definitions
  sprites/*.png         # copied sheets + map + card art
  audio/*.{wav,mp3}
tools/
  extract_atlas.py      # one-off: parse Unity .png.meta sprite rects → atlas.json
test/
  determinism.test.js   # Node, no deps: scripted battle → state hash replay check
  sim.test.js           # Node: targeting, mana, placement validation, win condition
```
No bundler, no npm dependencies. `node --test` for tests. Serve locally with `python3 -m http.server`.

## Phases (each ends with a commit to `claude/unity-game-js-port-r1p306` and a working, verifiable state)

### Phase 0 — Scaffold & loop
`index.html`, canvas letterboxed to 11:6, fixed-timestep loop with interpolation hooks, `data.js` filled with every constant from the spec tables above, empty-but-wired sim/render modules, README section on running locally. **Verify**: page serves, canvas shows field-colored background + debug grid, loop steps a visible tick counter.

### Phase 1 — Core simulation (debug rendering)
`physics.js` + `sim.js`: unit/tower entities, spawning via `applyCommand`, lane waypoint pathing, closest-in-sight targeting, movement with drag/clamp, unit-unit and unit-wall collision, attack cooldown damage, deaths, tower fire, win detection. Render everything as colored circles/rects with health bars — no art yet. Debug helper `window.game.cmd(...)` to inject commands from the console. **Verify** (Node tests + browser): two opposing tanks meet in a lane and fight; a lone unit reaches and kills the enemy tower; units don't overlap or leave the field.

### Phase 2 — Players, mana, cards, input
Mana regen; HUD card rows (Red bottom-left, Green bottom-right) with cost badges and gray-out; press-drag-release placement with grid-snapped ghost and validity per player half; multi-unit spawn offsets; Explosion spell (damage + knockback + full-field placement); all input flowing as commands from `pointer.js` (mouse and touch). **Verify**: full hotseat game is playable start-to-finish with debug art; invalid placement refunds nothing and plays error path; spell knocks units back.

### Phase 3 — Art, audio, game feel
Run `tools/extract_atlas.py` against the in-repo `Assets/` to build `atlas.json` from the `.png.meta` slice rects (regex the YAML — rects are simple), copy the needed sheets (OS + GE unit move/fire, HQs, explosion, map, card button PNGs from `Assets/Sprites/Buttons/`) and sounds into `assets/`. Implement animation playback (moving/firing states from sim state), flipX facing, y-sorted drawing, hit flash, health bars over sprites, map background, mana bars, sounds, explosion one-shot, game-over overlay with winner + restart. **Verify**: visually matches the Unity `gameplay_1.gif` vibe; animations switch moving↔firing; audio plays on fire/damage/place/error/win.

### Phase 4 — Multiplayer-readiness hardening & polish
Determinism test: fixed command script → run twice (and in Node) → identical `JSON.stringify(state)` hash at tick N. Serialization round-trip test (save state mid-game, restore, continue identically). Confirm `src/sim/` has zero DOM imports (grep in test). README: how to play, architecture notes, and a short "adding networked multiplayer" section pointing at the command/state seams. Final tuning pass (feel of unit pushing, spell knockback ≈ Unity's impulse 60 on mass 1.5). **Verify**: `node --test` green; fresh-eyes playthrough in Chromium (Playwright headless screenshot at `executablePath: '/opt/pw-browsers/chromium'` for the record).

## QoL fixes included (approved deviations from strict parity)
1. Game-over overlay + restart button (was: instant scene reload).
2. Closest-enemy targeting (was: first element found in team list).
3. Symmetric decks — both players get all 5 cards (was: asymmetric prototype decks).
4. Touch input alongside mouse (placement code was already written for it in Unity).

## Notes for the implementer
- Sprite sheets are Advance Wars rips (acknowledged in the source README) — fine for this class project; keep the same attribution line in the new README.
- The Unity `spawn()` prefab-index arithmetic is buggy prototype code; ignore it — map `(team, unitType)` straight to sprite sets.
- Tower is a static body: exclude it from integration but include it in collision resolution and targeting lists.
- Interpolation only for positions; animation frames can run on render time (cosmetic, stays out of the sim).

## Verification (end-to-end)
1. `python3 -m http.server` at repo root → play a full hotseat match in Chromium: place every card type on both sides, cast Explosion on a cluster, let a tower die, restart, play again.
2. `node --test test/` → sim unit tests + determinism + serialization round-trip all green.
3. Playwright (pre-installed Chromium) smoke test: load page, inject scripted commands via `window.game.cmd`, advance time, assert winner and capture a screenshot.
