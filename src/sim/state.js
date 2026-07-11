// state.js — the plain-JSON state object + factories + serialization helpers.
//
// Pure: no DOM, no RNG, no asset refs. `JSON.stringify(state)` must round-trip.
// Rendering/audio/input observe this; they never mutate it directly (commands do).

import { UNITS, TOWER, MANA, PLAYERS, TEAM, LANES } from './data.js';

// Monotonic entity id source lives IN state so it serializes deterministically.
function nextId(state) {
  return state._nextId++;
}

// Choose lane side by spawn y (GroundUnit.SetPath: y > 6 => top => side_index 0).
function laneSideForY(y) {
  return y > 6 ? 0 : 1;
}

export function createUnit(state, team, unitType, x, y) {
  const s = UNITS[unitType];
  const lanes = LANES[team];
  const side = laneSideForY(y);
  return {
    id: nextId(state),
    kind: 'unit',
    team,
    unitType,
    x, y,
    px: x, py: y,      // previous-tick position (for render interpolation)
    vx: 0, vy: 0,
    health: s.health,
    maxHealth: s.health,
    radius: s.radius,
    fireCooldown: 0,   // seconds since last shot; fires when >= attackPeriod
    targetId: null,    // locked enemy entity id, or null
    laneSide: side,    // 0 top / 1 bottom
    nextNode: 0,       // index into LANES[team][laneSide]
    facing: team === TEAM.RED ? 1 : -1,  // +1 right, -1 left (sprite flipX)
    firing: false,     // presentation hint: attacked this tick
    hitFlash: 0,       // presentation: seconds of damage-flash remaining
    lane: lanes,       // reference kept out of serialization (see serialize)
  };
}

export function createTower(state, team) {
  const pos = TOWER.positions[team];
  return {
    id: nextId(state),
    kind: 'tower',
    team,
    x: pos.x, y: pos.y,
    px: pos.x, py: pos.y,
    vx: 0, vy: 0,
    health: TOWER.health,
    maxHealth: TOWER.health,
    radius: TOWER.radius,
    fireCooldown: 0,
    targetId: null,
    facing: team === TEAM.RED ? 1 : -1,
    firing: false,
    hitFlash: 0,
  };
}

export function createEffect(state, type, x, y, ttl) {
  return { id: nextId(state), type, x, y, age: 0, ttl };
}

export function createInitialState() {
  const state = {
    tick: 0,
    _nextId: 1,
    manaTimer: 0,       // shared regen accumulator (Unity used one timer)
    players: PLAYERS.map((p) => ({
      id: p.id,
      team: p.team,
      mana: MANA.start,
    })),
    units: [],
    towers: [],
    effects: [],
    winner: null,       // null | 'red' | 'green'
    events: [],         // transient per-tick presentation events (not persisted)
  };
  state.towers.push(createTower(state, TEAM.RED));
  state.towers.push(createTower(state, TEAM.GREEN));
  return state;
}

// ---- Serialization ----
// Two things are excluded from the canonical serialization:
//  - `lane`: a derived reference into LANES, re-attached on load from `team`.
//  - `events`: transient per-tick presentation signals, not part of game state.
// This keeps `serialize` a stable identity fingerprint for determinism tests.
export function serialize(state) {
  return JSON.stringify(state, (key, val) =>
    (key === 'lane' || key === 'events') ? undefined : val);
}

export function deserialize(str) {
  const state = JSON.parse(str);
  state.events = [];
  for (const u of state.units) {
    u.lane = LANES[u.team];
  }
  return state;
}

// Deep structural clone via the serialization path (guarantees round-trip parity).
export function cloneState(state) {
  return deserialize(serialize(state));
}
