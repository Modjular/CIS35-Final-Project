// sim.js — the deterministic, DOM-free game simulation.
//
// Contract: the ONLY way anything mutates state is step(state, commands), which
// applies this tick's commands (via applyCommand) then advances one fixed tick.
// Same initial state + same command stream => identical state (tested in Phase 4).

import {
  DT, SIGHT_RADIUS, UNITS, TOWER, MANA, TEAM,
  LANE_ADVANCE_DIST, PLACEMENT, CARD_BY_ID, SPELL, KNOCKBACK_IMPULSE,
} from './data.js';
import { createUnit, createEffect } from './state.js';
import {
  steerAndIntegrate, driftAndIntegrate, applyImpulse,
  resolveAllCollisions,
} from './physics.js';

const FLASH_TIME = 0.3;   // seconds of damage flash (presentation)

function dist(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function emit(state, ev) {
  if (state.events) state.events.push(ev);
}

// ---- Commands ----------------------------------------------------------------

function playerByTeam(state, team) {
  return state.players.find((p) => p.team === team);
}

// Grid snap: cell centers at *.5, clamped into the placement half.
function snap(x, y, half) {
  const sx = Math.min(Math.max(Math.ceil(x), half.left + 1), half.right) - 0.5;
  const sy = Math.min(Math.max(Math.ceil(y), half.bottom + 1), half.top) - 0.5;
  return { x: sx, y: sy };
}

function inHalf(x, y, half) {
  return x >= half.left && x <= half.right && y >= half.bottom && y <= half.top;
}

// Non-mutating validation + grid snap. The UI uses this for the drag ghost and
// validity highlight so placement rules live in ONE place (the sim), never the UI.
// Returns { ok, affordable, placeable, x, y, cost, team } (x/y are snapped).
export function previewCommand(state, cmd) {
  const player = state.players.find((p) => p.id === cmd.playerId);
  if (!player) return { ok: false };
  const team = player.team;
  const card = CARD_BY_ID[cmd.card];
  if (!card) return { ok: false };

  const isSpell = cmd.type === 'CAST_SPELL';
  const half = isSpell ? PLACEMENT.spell : PLACEMENT[team];
  const affordable = player.mana >= card.cost;
  const placeable = inHalf(cmd.x, cmd.y, half);
  const pos = snap(cmd.x, cmd.y, half);
  return {
    ok: affordable && placeable && !state.winner,
    affordable, placeable, x: pos.x, y: pos.y, cost: card.cost, team, isSpell,
  };
}

// Validate + apply a single command. Returns true on success.
// Invalid placement / insufficient mana emits an 'error' event and spends nothing.
export function applyCommand(state, cmd) {
  if (state.winner) return false;
  const player = state.players.find((p) => p.id === cmd.playerId);
  if (!player) return false;
  const team = player.team;
  const card = CARD_BY_ID[cmd.card];
  if (!card) return false;

  const pv = previewCommand(state, cmd);
  if (!pv.ok) {
    emit(state, { type: 'error', team });
    return false;
  }

  const pos = { x: pv.x, y: pv.y };
  player.mana -= card.cost;
  const isSpell = cmd.type === 'CAST_SPELL';

  if (isSpell) {
    castExplosion(state, team, pos.x, pos.y);
    emit(state, { type: 'cast', team, spell: card.spell });
  } else {
    for (const off of card.offsets) {
      const u = createUnit(state, team, card.unit, pos.x + off.x, pos.y + off.y);
      state.units.push(u);
    }
    emit(state, { type: 'spawn', team, unit: card.unit });
  }
  return true;
}

function castExplosion(state, team, x, y) {
  const spec = SPELL.EXPLOSION;
  const enemyTeam = team === TEAM.RED ? TEAM.GREEN : TEAM.RED;

  // Enemy units in radius: damage + knockback away from center.
  for (const u of state.units) {
    if (u.team !== enemyTeam) continue;
    const d = dist(x, y, u.x, u.y);
    if (d < spec.radius) {
      damage(state, u, spec.damage);
      let nx = u.x - x, ny = u.y - y;
      const m = Math.sqrt(nx * nx + ny * ny) || 1;
      applyImpulse(u, (nx / m) * KNOCKBACK_IMPULSE, (ny / m) * KNOCKBACK_IMPULSE);
    }
  }
  // Enemy tower in radius: damage only (static body — no knockback).
  for (const t of state.towers) {
    if (t.team !== enemyTeam) continue;
    if (dist(x, y, t.x, t.y) < spec.radius) damage(state, t, spec.damage);
  }

  state.effects.push(createEffect(state, 'explosion', x, y, spec.duration));
  emit(state, { type: 'explosion', x, y });
}

// ---- Combat helpers ----------------------------------------------------------

function damage(state, target, amount) {
  target.health -= amount;
  target.hitFlash = FLASH_TIME;
  emit(state, { type: 'hit', team: target.team, kind: target.kind });
}

// Candidate enemies for an attacker: enemy units + enemy tower.
function enemiesOf(state, team) {
  const enemyTeam = team === TEAM.RED ? TEAM.GREEN : TEAM.RED;
  const list = [];
  for (const u of state.units) if (u.team === enemyTeam && u.health > 0) list.push(u);
  for (const t of state.towers) if (t.team === enemyTeam && t.health > 0) list.push(t);
  return list;
}

function findEntity(state, id) {
  if (id == null) return null;
  for (const u of state.units) if (u.id === id) return u;
  for (const t of state.towers) if (t.id === id) return t;
  return null;
}

// Keep a live, in-sight target; otherwise acquire the CLOSEST enemy in sight
// (QoL fix — Unity took the first found). Returns the target entity or null.
function acquireTarget(state, self) {
  const cur = findEntity(state, self.targetId);
  if (cur && cur.health > 0 && dist(self.x, self.y, cur.x, cur.y) <= SIGHT_RADIUS) {
    return cur;
  }
  let best = null, bestD = Infinity;
  for (const e of enemiesOf(state, self.team)) {
    const d = dist(self.x, self.y, e.x, e.y);
    if (d <= SIGHT_RADIUS && d < bestD) { best = e; bestD = d; }
  }
  self.targetId = best ? best.id : null;
  return best;
}

function faceToward(e, tx) {
  const dx = tx - e.x;
  if (Math.abs(dx) > 1e-4) e.facing = dx < 0 ? -1 : 1;
}

// ---- Per-entity tick ---------------------------------------------------------

function tickUnit(state, u) {
  u.fireCooldown += DT;
  u.firing = false;
  const stats = UNITS[u.unitType];
  const target = acquireTarget(state, u);

  if (target) {
    faceToward(u, target.x);
    if (dist(u.x, u.y, target.x, target.y) < stats.range) {
      // In range: hold position (drag bleeds off any knockback) and attack.
      driftAndIntegrate(u, DT);
      if (u.fireCooldown >= stats.attackPeriod) {
        u.fireCooldown = 0;
        u.firing = true;
        damage(state, target, stats.attack);
        emit(state, { type: 'fire', team: u.team, unit: u.unitType });
      }
      return;
    }
    // Have a target but out of range: steer toward it.
    steerToward(u, target.x, target.y, stats.speed);
    return;
  }

  // No enemy in sight: follow the lane toward the enemy HQ.
  const lane = u.lane[laneSide(u)];
  advanceLane(u, lane);
  const wp = lane[u.nextNode];
  faceToward(u, wp.x);
  steerToward(u, wp.x, wp.y, stats.speed);
}

function steerToward(u, tx, ty, speed) {
  let dx = tx - u.x, dy = ty - u.y;
  const m = Math.sqrt(dx * dx + dy * dy) || 1;
  steerAndIntegrate(u, dx / m, dy / m, speed, DT);
}

function laneSide(u) {
  return u.y > 6 ? 0 : 1;   // top if above mid-line, else bottom
}

function advanceLane(u, lane) {
  u.laneSide = laneSide(u);
  if (u.nextNode < lane.length - 1) {
    const wp = lane[u.nextNode];
    if (dist(u.x, u.y, wp.x, wp.y) < LANE_ADVANCE_DIST) u.nextNode++;
  }
}

function tickTower(state, t) {
  t.fireCooldown += DT;
  t.firing = false;
  const target = acquireTarget(state, t);
  if (target && dist(t.x, t.y, target.x, target.y) < TOWER.range) {
    faceToward(t, target.x);
    if (t.fireCooldown >= TOWER.attackPeriod) {
      t.fireCooldown = 0;
      t.firing = true;
      damage(state, target, TOWER.attack);
      emit(state, { type: 'fire', team: t.team, unit: 'TOWER' });
    }
  }
}

// ---- Mana --------------------------------------------------------------------

function tickMana(state) {
  state.manaTimer += DT;
  if (state.manaTimer >= MANA.regenPeriod) {
    state.manaTimer -= MANA.regenPeriod;
    for (const p of state.players) {
      if (p.mana < MANA.max) p.mana++;
    }
  }
}

// ---- Death & win -------------------------------------------------------------

function reap(state) {
  // Units at/under 0 HP die.
  const survivors = [];
  for (const u of state.units) {
    if (u.health <= 0) {
      emit(state, { type: 'death', team: u.team, unit: u.unitType });
    } else {
      survivors.push(u);
    }
  }
  state.units = survivors;

  // A destroyed tower ends the game for its team.
  for (const t of state.towers) {
    if (t.health <= 0 && !state.winner) {
      state.winner = t.team === TEAM.RED ? TEAM.GREEN : TEAM.RED;
      emit(state, { type: 'gameover', winner: state.winner });
    }
  }
}

// ---- Top-level tick ----------------------------------------------------------

// Advance the sim by exactly one fixed tick, after applying this tick's commands.
export function step(state, commands = []) {
  state.events = [];
  if (state.winner) return state;

  for (const cmd of commands) applyCommand(state, cmd);

  state.tick++;
  tickMana(state);

  // Decay presentation-only hit flashes.
  for (const e of state.units) if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - DT);
  for (const e of state.towers) if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - DT);

  for (const u of state.units) tickUnit(state, u);
  for (const t of state.towers) tickTower(state, t);

  resolveAllCollisions(state.units, state.towers);

  // Age effects (cosmetic) and drop expired ones.
  for (const fx of state.effects) fx.age += DT;
  state.effects = state.effects.filter((fx) => fx.age < fx.ttl);

  reap(state);
  return state;
}
