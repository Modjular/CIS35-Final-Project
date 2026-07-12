// data.js — ALL gameplay constants for the port.
//
// Every number here was extracted and re-verified against the Unity C# sources
// and prefab YAML in this repo (UnitStats.cs, GroundUnit.cs, GameManager.cs,
// Tower.cs, HoldDragPlaceUnit.cs, Spell.cs, Assets/UnitPrefabs/**).
//
// This module is pure data — no DOM, no imports. It must load unchanged in Node.

// ---- Simulation timing ----
export const TICK_RATE = 30;              // fixed-timestep sim frequency (Hz)
export const DT = 1 / TICK_RATE;          // seconds per sim tick

// Unity ran physics at a 0.02s fixed step; a few impulse/force values below are
// expressed relative to that reference step so the "feel" ports faithfully.
export const UNITY_FIXED_DT = 0.02;

// ---- Field & world ----
// World is 22 x 12 units, origin bottom-left, +y up. Red = left, Green = right.
export const FIELD = {
  W: 22,
  H: 12,
  ASPECT_W: 11,   // letterbox aspect (22:12 == 11:6)
  ASPECT_H: 6,
};

// Background map art's world-space placement (Assets/Main.unity "Map" object:
// position (-2,-2), sprite pivot bottom-left; map1_waterV2.png is 416x256px at
// 16px/unit = 26x16 world units). The art bleeds 2 units past FIELD on every
// side (water border around the playable field/camera). Stretching the image
// to fit FIELD exactly — instead of drawing it at this native size/offset —
// squashes it and throws the road/bridge art out of alignment with the lane
// waypoints below, which were authored against the real Unity world space.
export const MAP_RECT = { x: -2, y: -2, w: 26, h: 16 };

// Placement halves (inclusive world bounds used for validation + grid snap).
// Middle strip x in (10,12) is no-man's-land — nobody may place there.
export const PLACEMENT = {
  red:   { left: 0,  right: 10, bottom: 0, top: 12 },
  green: { left: 12, right: 22, bottom: 0, top: 12 },
  spell: { left: 0,  right: 22, bottom: 0, top: 12 }, // spell: full field
};

// ---- Teams ----
export const TEAM = { RED: 'red', GREEN: 'green' };

// ---- Shared unit sensing ----
export const SIGHT_RADIUS = 4;            // UnitStats.sight_radius

// ---- Unit stats (UnitStats.cs index[]) ----
// attack, health, speed, cost, range, attackPeriod (seconds between shots),
// radius (physics circle collider, from prefab YAML), mass, drag.
export const UNIT_MASS = 1.5;             // m_Mass on every unit prefab
export const UNIT_DRAG = 1;               // m_LinearDrag on every unit prefab

export const UNITS = {
  TANK:     { attack: 30, health: 120, speed: 1.2, cost: 4, range: 2.5, attackPeriod: 1.0,  radius: 0.18, bar: 'medium' },
  MTANK:    { attack: 50, health: 200, speed: 0.8, cost: 5, range: 2.5, attackPeriod: 1.2,  radius: 0.23, bar: 'large'  },
  INFANTRY: { attack: 15, health: 80,  speed: 1.2, cost: 2, range: 2.0, attackPeriod: 0.75, radius: 0.13, bar: 'small'  },
  RECON:    { attack: 20, health: 100, speed: 1.6, cost: 3, range: 2.0, attackPeriod: 0.5,  radius: 0.18, bar: 'small'  },
};

// ---- Towers (HQ) — Tower.cs + GameManager.spawnTowers() ----
export const TOWER = {
  health: 1200,
  attack: 40,
  attackPeriod: 2.0,
  range: SIGHT_RADIUS,     // tower fires within sight radius (4)
  radius: 0.89,            // CircleCollider2D on HQ prefab
  bar: 'large',
  positions: {
    red:   { x: 2.5,  y: 6 },
    green: { x: 19.5, y: 6 },
  },
};

// ---- Lane waypoints (GroundUnit.cs) ----
// side_index 0 = top (spawn y > 6), 1 = bottom. Advance when within ADVANCE_DIST.
export const LANE_ADVANCE_DIST = 0.9;
export const LANES = {
  // Red marches rightward toward Green HQ.
  red: [
    [ { x: 9.5, y: 9.5 }, { x: 19.5, y: 9.5 }, { x: 19.5, y: 6 } ],  // top
    [ { x: 9.5, y: 2.5 }, { x: 19.5, y: 2.5 }, { x: 19.5, y: 6 } ],  // bottom
  ],
  // Green marches leftward toward Red HQ.
  green: [
    [ { x: 12.5, y: 9.5 }, { x: 2.5, y: 9.5 }, { x: 2.5, y: 6 } ],   // top
    [ { x: 12.5, y: 2.5 }, { x: 2.5, y: 2.5 }, { x: 2.5, y: 6 } ],   // bottom
  ],
};

// ---- Mana (GameManager.cs) ----
export const MANA = {
  start: 6,
  max: 10,
  regenPeriod: 3.6,   // seconds per +1 (both players tick on one shared timer)
};

// ---- Cards / deck (symmetric — QoL fix: both players get all 5) ----
// count + offsets reproduce HoldDragPlaceUnit.spawnUnit()'s multi-spawn.
export const CARDS = [
  { id: 'tank',      unit: 'TANK',     cost: 4, count: 2, offsets: [ { x: 0, y: 0.3 }, { x: 0, y: -0.3 } ] },
  { id: 'mdtank',    unit: 'MTANK',    cost: 5, count: 1, offsets: [ { x: 0, y: 0 } ] },
  { id: 'infantry',  unit: 'INFANTRY', cost: 2, count: 3, offsets: [ { x: 0, y: 0.2 }, { x: 0, y: -0.2 }, { x: 0.1, y: 0 } ] },
  { id: 'recon',     unit: 'RECON',    cost: 3, count: 1, offsets: [ { x: 0, y: 0 } ] },
  { id: 'explosion', spell: 'EXPLOSION', cost: 3 },
];
export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

// ---- Explosion spell (Spell.cs + EXPLOSION prefab) ----
export const SPELL = {
  EXPLOSION: {
    damage: 85,
    radius: 1.5,
    force: 60,          // Unity AddForce magnitude (ForceMode2D.Force)
    duration: 0.625,    // one-shot animation lifetime (cosmetic)
  },
};
// Unity's AddForce(Force) applied once => Δv = force / mass * fixedDeltaTime.
// Reproduce that as an instantaneous velocity impulse on the sim body.
export const KNOCKBACK_IMPULSE = (SPELL.EXPLOSION.force / UNIT_MASS) * UNITY_FIXED_DT;

// ---- Presentation constants (shared by sim event timing + renderer) ----
export const FLASH_TIME = 0.3;            // seconds a damage flash lasts/decays
export const BAR_SCALE = { small: 0.8, medium: 1.0, large: 1.5 };

// Helper: which player owns which team (identity separate from team).
export const PLAYERS = [
  { id: 'p1', team: TEAM.RED },
  { id: 'p2', team: TEAM.GREEN },
];
