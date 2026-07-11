// main.js — bootstrap + the fixed-timestep loop.
//
// Real time accumulates; the sim advances in whole DT ticks; rendering
// interpolates between the last two ticks by the leftover fraction. Input and
// (future) network only ever enqueue commands — they never touch state.

import { DT, TICK_RATE } from './sim/data.js';
import { createInitialState } from './sim/state.js';
import { step } from './sim/sim.js';
import { createRenderer } from './render/renderer.js';
import { createHud } from './render/hud.js';
import { setupPointer } from './input/pointer.js';

const canvas = document.getElementById('game');
const debugEl = document.getElementById('debug');
const renderer = createRenderer(canvas);
const hud = createHud();

let state = createInitialState();

const drag = setupPointer(canvas, renderer.cam, hud, {
  enqueue: (cmd) => enqueue(cmd),
  getState: () => state,
  restart: () => { state = createInitialState(); pending = []; },
});

// Pending commands, keyed by nothing fancy: everything queued before a tick is
// applied on that tick (later: sorted/validated per player for netcode).
let pending = [];

function enqueue(cmd) {
  pending.push(cmd);
}

// ---- Fixed-step accumulator --------------------------------------------------
const MAX_STEPS = 5;          // clamp catch-up after a stall
let acc = 0;
let last = performance.now();
let lastEvents = [];

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;   // avoid spiral-of-death after a tab switch
  acc += dt;

  let steps = 0;
  while (acc >= DT && steps < MAX_STEPS) {
    const cmds = pending;
    pending = [];
    step(state, cmds);
    lastEvents = state.events;
    onEvents(lastEvents);
    acc -= DT;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;

  const alpha = acc / DT;
  renderer.draw(state, alpha, { grid: DEBUG.grid });
  hud.draw(renderer.ctx, renderer.cam, state, drag);
  drawDebugOverlay(steps);
  requestAnimationFrame(frame);
}

// Audio/other side-effects observe sim events here (wired up in later phases).
function onEvents(events) { /* Phase 3: audio hooks */ }

// ---- Debug overlay + console API --------------------------------------------
const DEBUG = { grid: true, show: true };

function drawDebugOverlay() {
  if (!DEBUG.show) { debugEl.textContent = ''; return; }
  const p = state.players.map((pl) => `${pl.id}:${pl.team} mana=${pl.mana}`).join('  ');
  debugEl.textContent =
    `tick ${state.tick}  (${TICK_RATE}Hz)\n` +
    `${p}\n` +
    `units=${state.units.length} effects=${state.effects.length}` +
    (state.winner ? `\nWINNER: ${state.winner}` : '');
}

function onResize() { renderer.resize(); }
window.addEventListener('resize', onResize);
onResize();

// Console-injectable command helper for verification:
//   game.cmd('p1', 'PLACE_UNITS', 'tank', 5, 8)
//   game.cmd('p2', 'CAST_SPELL', 'explosion', 15, 6)
window.game = {
  get state() { return state; },
  get events() { return lastEvents; },
  cmd(playerId, type, card, x, y) {
    enqueue({ playerId, type, card, x, y });
  },
  enqueue,
  reset() { state = createInitialState(); pending = []; },
  debug: DEBUG,
};

requestAnimationFrame(frame);
