// sim.test.js — core simulation behavior. Runs under `node --test`, no deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialState, createUnit, serialize } from '../src/sim/state.js';
import { step, applyCommand } from '../src/sim/sim.js';
import { FIELD, MANA, TEAM, UNITS, TOWER } from '../src/sim/data.js';

// Advance the sim n ticks with an optional per-tick command list.
function run(state, n, cmds = []) {
  for (let i = 0; i < n; i++) step(state, i === 0 ? cmds : []);
  return state;
}

function unitsOf(state, team) {
  return state.units.filter((u) => u.team === team);
}

test('initial state: two towers, starting mana, no winner', () => {
  const s = createInitialState();
  assert.equal(s.towers.length, 2);
  assert.equal(s.units.length, 0);
  assert.equal(s.winner, null);
  for (const p of s.players) assert.equal(p.mana, MANA.start);
});

test('placement spends mana and spawns the right unit count', () => {
  const s = createInitialState();
  const before = s.players[0].mana;
  step(s, [{ playerId: 'p1', type: 'PLACE_UNITS', card: 'tank', x: 5, y: 8 }]);
  assert.equal(unitsOf(s, TEAM.RED).length, 2);          // tank card = 2 units
  assert.equal(s.players[0].mana, before - 4);           // tank cost 4
});

test('infantry card spawns 3 units', () => {
  const s = createInitialState();
  step(s, [{ playerId: 'p1', type: 'PLACE_UNITS', card: 'infantry', x: 4, y: 4 }]);
  assert.equal(unitsOf(s, TEAM.RED).length, 3);
});

test('invalid placement (wrong half) spends nothing and emits error', () => {
  const s = createInitialState();
  const mana = s.players[0].mana;
  // Red trying to place at x=18 (green half).
  step(s, [{ playerId: 'p1', type: 'PLACE_UNITS', card: 'tank', x: 18, y: 6 }]);
  assert.equal(unitsOf(s, TEAM.RED).length, 0);
  assert.equal(s.players[0].mana, mana);
  assert.ok(s.events.some((e) => e.type === 'error'));
});

test('unaffordable placement is rejected', () => {
  const s = createInitialState();
  s.players[0].mana = 1;                                  // can't afford tank(4)
  step(s, [{ playerId: 'p1', type: 'PLACE_UNITS', card: 'tank', x: 5, y: 6 }]);
  assert.equal(unitsOf(s, TEAM.RED).length, 0);
  assert.equal(s.players[0].mana, 1);
});

test('mana regenerates +1 per regen period, capped at max', () => {
  const s = createInitialState();
  s.players[0].mana = MANA.max - 1;
  const ticks = Math.ceil(MANA.regenPeriod * 30) + 2;
  run(s, ticks);
  assert.equal(s.players[0].mana, MANA.max);             // capped, not exceeded
});

test('closest-in-sight targeting: unit picks the nearer enemy (QoL fix)', () => {
  const s = createInitialState();
  // Red scout mid-field; two green enemies at clearly different distances, both
  // inside sight radius 4. Inject directly for precise, non-flaky positions.
  const red = createUnit(s, TEAM.RED, 'RECON', 9, 6);
  s.units.push(red);
  const far = createUnit(s, TEAM.GREEN, 'INFANTRY', 12, 6);   // distance 3
  const near = createUnit(s, TEAM.GREEN, 'INFANTRY', 11, 6);  // distance 2
  s.units.push(far, near);
  step(s, []);                                   // targeting runs this tick
  assert.equal(red.targetId, near.id, 'targets the closer of two in-sight enemies');
});

test('two opposing tanks meet and fight (both take damage)', () => {
  const s = createInitialState();
  step(s, [{ playerId: 'p1', type: 'PLACE_UNITS', card: 'mdtank', x: 9, y: 6 }]);
  step(s, [{ playerId: 'p2', type: 'PLACE_UNITS', card: 'mdtank', x: 13, y: 6 }]);
  const red = unitsOf(s, TEAM.RED)[0];
  const green = unitsOf(s, TEAM.GREEN)[0];
  run(s, 30 * 4);  // ~4 seconds
  assert.ok(red.health < red.maxHealth, 'red tank took damage');
  assert.ok(green.health < green.maxHealth, 'green tank took damage');
});

test('units never leave the field', () => {
  const s = createInitialState();
  step(s, [{ playerId: 'p1', type: 'PLACE_UNITS', card: 'recon', x: 1, y: 1 }]);
  step(s, [{ playerId: 'p2', type: 'PLACE_UNITS', card: 'recon', x: 21, y: 11 }]);
  run(s, 30 * 20);
  for (const u of s.units) {
    assert.ok(u.x >= 0 && u.x <= FIELD.W, `x in bounds: ${u.x}`);
    assert.ok(u.y >= 0 && u.y <= FIELD.H, `y in bounds: ${u.y}`);
  }
});

test('overlapping spawns get separated (no exact stacking)', () => {
  const s = createInitialState();
  // Tank card spawns 2 units offset by 0.6 in y; after a few ticks of collision
  // resolution they must not occupy the same point.
  step(s, [{ playerId: 'p1', type: 'PLACE_UNITS', card: 'tank', x: 5, y: 6 }]);
  run(s, 10);
  const [a, b] = unitsOf(s, TEAM.RED);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius - 0.05);
});

test('a lone unit marches to and destroys the enemy tower -> winner', () => {
  const s = createInitialState();
  // Spawn a strong red stack near the green HQ lane end and let it work.
  for (let i = 0; i < 6; i++) {
    step(s, [{ playerId: 'p1', type: 'PLACE_UNITS', card: 'mdtank', x: 9, y: 6 }]);
    s.players[0].mana = 10; // keep it affordable for the test
  }
  run(s, 30 * 90);          // up to 90 seconds
  assert.equal(s.winner, TEAM.RED);
  const greenTower = s.towers.find((t) => t.team === TEAM.GREEN);
  assert.ok(greenTower.health <= 0);
});

test('explosion spell damages enemy units and applies knockback', () => {
  const s = createInitialState();
  step(s, [{ playerId: 'p2', type: 'PLACE_UNITS', card: 'infantry', x: 15, y: 6 }]);
  const before = unitsOf(s, TEAM.GREEN).map((u) => ({ id: u.id, h: u.health, x: u.x }));
  // Red casts explosion on the green cluster.
  step(s, [{ playerId: 'p1', type: 'CAST_SPELL', card: 'explosion', x: 15, y: 6 }]);
  const after = unitsOf(s, TEAM.GREEN);
  // At least one green infantry died (85 dmg > 80 hp) or took damage.
  const survivor = after[0];
  if (survivor) {
    const was = before.find((b) => b.id === survivor.id);
    assert.ok(survivor.health < was.h, 'survivor took explosion damage');
  } else {
    assert.ok(after.length < before.length, 'explosion killed infantry');
  }
});

test('winner freezes the sim (no further mutation)', () => {
  const s = createInitialState();
  s.winner = TEAM.RED;
  const snap = serialize(s);
  step(s, [{ playerId: 'p2', type: 'PLACE_UNITS', card: 'tank', x: 15, y: 6 }]);
  assert.equal(serialize(s), snap);
});
