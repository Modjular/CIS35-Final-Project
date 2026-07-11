// determinism.test.js — the multiplayer-readiness guarantees:
//   1. same command stream => byte-identical state (deterministic replay)
//   2. serialize -> deserialize -> continue is identical (save/resume)
//   3. src/sim/ imports nothing DOM/host-specific (runs on a server unchanged)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createInitialState, serialize, deserialize, cloneState } from '../src/sim/state.js';
import { step } from '../src/sim/sim.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIM_DIR = join(HERE, '..', 'src', 'sim');

// A fixed, RNG-free command schedule: tick -> commands. Mana is pre-loaded
// identically in both runs so every placement lands (still fully deterministic).
const SCHEDULE = {
  2:   [['p1', 'PLACE_UNITS', 'tank', 5, 8], ['p2', 'PLACE_UNITS', 'tank', 14, 8]],
  20:  [['p1', 'PLACE_UNITS', 'infantry', 6, 4], ['p2', 'PLACE_UNITS', 'recon', 16, 4]],
  55:  [['p1', 'PLACE_UNITS', 'mdtank', 9, 6], ['p2', 'PLACE_UNITS', 'mdtank', 13, 6]],
  90:  [['p1', 'PLACE_UNITS', 'recon', 8, 9], ['p2', 'PLACE_UNITS', 'infantry', 15, 9]],
  130: [['p1', 'CAST_SPELL', 'explosion', 13, 6]],
};

function cmdsAt(tick) {
  return (SCHEDULE[tick] || []).map(([playerId, type, card, x, y]) =>
    ({ playerId, type, card, x, y }));
}

function runScripted(nTicks) {
  const s = createInitialState();
  for (const p of s.players) p.mana = 100;   // deterministic pre-load
  for (let t = 0; t < nTicks; t++) step(s, cmdsAt(t + 1));
  return s;
}

test('deterministic replay: identical command stream => identical state', () => {
  const a = serialize(runScripted(300));
  const b = serialize(runScripted(300));
  assert.equal(a, b);
});

test('replay is stable across many independent runs', () => {
  const ref = serialize(runScripted(200));
  for (let i = 0; i < 4; i++) assert.equal(serialize(runScripted(200)), ref);
});

test('serialize -> deserialize -> continue matches an uninterrupted run', () => {
  // Run to a mid-game checkpoint, snapshot, restore, then run both forward.
  const live = createInitialState();
  for (const p of live.players) p.mana = 100;
  for (let t = 0; t < 150; t++) step(live, cmdsAt(t + 1));

  const restored = deserialize(serialize(live));

  for (let t = 150; t < 300; t++) {
    const c = cmdsAt(t + 1);
    step(live, c);
    step(restored, c.map((x) => ({ ...x })));
  }
  assert.equal(serialize(live), serialize(restored));
});

test('cloneState round-trips exactly', () => {
  const s = runScripted(120);
  assert.equal(serialize(s), serialize(cloneState(s)));
});

test('src/sim is DOM-free (no window/document/performance/RNG/render imports)', () => {
  const forbidden = [
    /\bdocument\b/, /\bwindow\b/, /\bperformance\b/, /\bnavigator\b/,
    /Math\.random/, /requestAnimationFrame/,
    /from ['"]\.\.\/(render|audio|input)/, /from ['"]\.\/\.\.\/(render|audio|input)/,
  ];
  for (const file of readdirSync(SIM_DIR).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(SIM_DIR, file), 'utf8');
    for (const re of forbidden) {
      assert.ok(!re.test(src), `${file} must not match ${re}`);
    }
  }
});
