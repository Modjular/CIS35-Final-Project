// physics.js — bespoke ~2D physics: semi-implicit Euler + linear drag + velocity
// clamp + circle/circle and circle/wall resolution. Pure, DOM-free, deterministic.
//
// Faithful to the Unity feel: units use AddRelativeForce(speed) with ForceMode.Force
// against mass 1.5 and linear drag 1, so their equilibrium cruise speed settles at
// speed / (mass * drag) — noticeably below the nominal `speed` stat. We reproduce
// the exact same discrete equations rather than hand-tuning a target velocity.

import { UNIT_MASS, UNIT_DRAG, FIELD } from './data.js';

function mag(x, y) {
  return Math.sqrt(x * x + y * y);
}

// Apply steering toward a unit-vector direction, then drag, clamp, and integrate.
// Mirrors Unity: force is only added while |v| < speed (matches the C# clamp).
export function steerAndIntegrate(e, dirx, diry, speed, dt) {
  e.px = e.x;
  e.py = e.y;

  const v = mag(e.vx, e.vy);
  if (v < speed) {
    const accel = (speed / UNIT_MASS) * dt; // Δv = F/m * dt, F magnitude = speed
    e.vx += dirx * accel;
    e.vy += diry * accel;
  }

  // Linear drag (Unity: velocity *= 1/(1 + drag*dt)).
  const damp = 1 / (1 + UNIT_DRAG * dt);
  e.vx *= damp;
  e.vy *= damp;

  // Hard clamp (rarely triggers given drag, but faithful to the C#).
  const v2 = mag(e.vx, e.vy);
  if (v2 > speed && v2 > 0) {
    const k = speed / v2;
    e.vx *= k;
    e.vy *= k;
  }

  e.x += e.vx * dt;
  e.y += e.vy * dt;
}

// A stationary body still needs its previous position recorded and drag applied
// (e.g. after a knockback impulse when the unit is in-range and not steering).
export function driftAndIntegrate(e, dt) {
  e.px = e.x;
  e.py = e.y;
  const damp = 1 / (1 + UNIT_DRAG * dt);
  e.vx *= damp;
  e.vy *= damp;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
}

// Instantaneous velocity change (knockback).
export function applyImpulse(e, ix, iy) {
  e.vx += ix;
  e.vy += iy;
}

// Separate two overlapping circles. `bMass = Infinity` makes b immovable (towers).
export function resolveCirclePair(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let dist = mag(dx, dy);
  const minDist = a.radius + b.radius;
  if (dist >= minDist) return;

  // Degenerate exact-overlap: nudge along a fixed axis deterministically.
  let nx, ny;
  if (dist === 0) {
    nx = 1; ny = 0; dist = 0.0001;
  } else {
    nx = dx / dist; ny = dy / dist;
  }
  const overlap = minDist - dist;

  const aStatic = a.kind === 'tower';
  const bStatic = b.kind === 'tower';
  if (aStatic && bStatic) return;

  if (aStatic) {
    b.x += nx * overlap; b.y += ny * overlap;
  } else if (bStatic) {
    a.x -= nx * overlap; a.y -= ny * overlap;
  } else {
    const half = overlap * 0.5;
    a.x -= nx * half; a.y -= ny * half;
    b.x += nx * half; b.y += ny * half;
  }
}

// Keep a circle inside the field walls; kill the velocity component into the wall.
export function resolveBounds(e) {
  const r = e.radius;
  if (e.x < r) { e.x = r; if (e.vx < 0) e.vx = 0; }
  if (e.x > FIELD.W - r) { e.x = FIELD.W - r; if (e.vx > 0) e.vx = 0; }
  if (e.y < r) { e.y = r; if (e.vy < 0) e.vy = 0; }
  if (e.y > FIELD.H - r) { e.y = FIELD.H - r; if (e.vy > 0) e.vy = 0; }
}

// Resolve all unit/unit and unit/tower overlaps + walls for one tick.
// A couple of relaxation passes keeps dense clusters from exploding.
export function resolveAllCollisions(units, towers) {
  const PASSES = 2;
  for (let p = 0; p < PASSES; p++) {
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        resolveCirclePair(units[i], units[j]);
      }
      for (let t = 0; t < towers.length; t++) {
        resolveCirclePair(units[i], towers[t]);
      }
    }
  }
  for (const u of units) resolveBounds(u);
}
