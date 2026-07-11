// renderer.js — canvas setup + the draw loop.
//
// Deliberately behind a tiny interface (createRenderer -> { resize, draw }) with
// a swappable "debug" backend (colored circles/rects) and a "sprite" backend
// (added in Phase 3). The sim is never touched here — we only read state and
// interpolate positions between the previous and current tick.

import { FIELD, TEAM, UNITS, TOWER, BAR_SCALE } from '../sim/data.js';
import { createCamera, fit, worldToScreen } from './camera.js';

const COLORS = {
  fieldRed:  '#3a2f2f',
  fieldGreen:'#2f3a33',
  water:     '#10141c',
  grid:      'rgba(255,255,255,0.05)',
  midline:   'rgba(255,255,255,0.18)',
  red:       '#e8663a',
  green:     '#4fd08a',
  redDark:   '#7a2f18',
  greenDark: '#1f6a44',
  hpBack:    'rgba(0,0,0,0.55)',
  hpFill:    '#5ad15a',
  flash:     '#8ff',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = createCamera();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stage = canvas.parentElement;
    const cssW = stage.clientWidth;
    const cssH = stage.clientHeight;
    // Canvas fills the field's letterbox area exactly (integer-ish backing store).
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    fit(cam, cssW, cssH, dpr);
    ctx.imageSmoothingEnabled = false;
  }

  // rp: interpolated render position for an entity.
  function rp(e, alpha) {
    return {
      x: e.px + (e.x - e.px) * alpha,
      y: e.py + (e.y - e.py) * alpha,
    };
  }

  function drawField(showGrid) {
    const s = cam.scale;
    // Water backdrop over the whole canvas.
    ctx.fillStyle = COLORS.water;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tl = worldToScreen(cam, 0, FIELD.H);
    const fieldW = FIELD.W * s;
    const fieldH = FIELD.H * s;
    // Team halves.
    ctx.fillStyle = COLORS.fieldRed;
    ctx.fillRect(tl.x, tl.y, (FIELD.W / 2) * s, fieldH);
    ctx.fillStyle = COLORS.fieldGreen;
    ctx.fillRect(tl.x + (FIELD.W / 2) * s, tl.y, (FIELD.W / 2) * s, fieldH);

    if (showGrid) {
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= FIELD.W; x++) {
        const p = worldToScreen(cam, x, 0);
        ctx.moveTo(p.x, tl.y); ctx.lineTo(p.x, tl.y + fieldH);
      }
      for (let y = 0; y <= FIELD.H; y++) {
        const p = worldToScreen(cam, 0, y);
        ctx.moveTo(tl.x, p.y); ctx.lineTo(tl.x + fieldW, p.y);
      }
      ctx.stroke();
    }
    // Placement no-man's-land dividers at x=10 and x=12.
    ctx.strokeStyle = COLORS.midline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const x of [10, 12]) {
      const p = worldToScreen(cam, x, 0);
      ctx.moveTo(p.x, tl.y); ctx.lineTo(p.x, tl.y + fieldH);
    }
    ctx.stroke();
  }

  function drawHealthBar(e, screen, scalePx) {
    const spec = e.kind === 'tower' ? TOWER : UNITS[e.unitType];
    const barScale = BAR_SCALE[spec.bar] || 1;
    const w = barScale * scalePx * 1.1;
    const h = Math.max(3, scalePx * 0.12);
    const pct = Math.max(0, e.health / e.maxHealth);
    const bodyR = e.radius * scalePx;
    const x = screen.x - w / 2;
    const y = screen.y - bodyR - h - 4;
    ctx.fillStyle = COLORS.hpBack;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = e.team === TEAM.RED ? COLORS.red : COLORS.green;
    ctx.fillStyle = COLORS.hpFill;
    ctx.fillRect(x, y, w * pct, h);
  }

  function drawDebugEntity(e, alpha) {
    const s = cam.scale;
    const pos = rp(e, alpha);
    const screen = worldToScreen(cam, pos.x, pos.y);
    const r = Math.max(4, e.radius * s);

    // Body.
    const base = e.team === TEAM.RED ? COLORS.red : COLORS.green;
    ctx.fillStyle = e.hitFlash > 0 ? COLORS.flash : base;
    if (e.kind === 'tower') {
      ctx.fillStyle = e.hitFlash > 0 ? COLORS.flash
        : (e.team === TEAM.RED ? COLORS.redDark : COLORS.greenDark);
      ctx.fillRect(screen.x - r, screen.y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Facing tick + firing flash.
      ctx.strokeStyle = e.firing ? '#fff' : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(screen.x + e.facing * r, screen.y);
      ctx.stroke();
    }
    drawHealthBar(e, screen, s);
  }

  function drawEffects(alpha) {
    const s = cam.scale;
    for (const fx of state_effects) {
      if (fx.type !== 'explosion') continue;
      const screen = worldToScreen(cam, fx.x, fx.y);
      const t = Math.min(1, fx.age / fx.ttl);
      const r = (0.4 + t * 1.5) * s;
      ctx.strokeStyle = `rgba(255,${Math.round(200 * (1 - t))},80,${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  let state_effects = [];

  function draw(state, alpha, opts = {}) {
    drawField(opts.grid !== false);

    // y-sort: lower world-y drawn later (on top), matching Unity z = y/12.
    const drawables = [...state.towers, ...state.units]
      .slice()
      .sort((a, b) => b.y - a.y);
    for (const e of drawables) drawDebugEntity(e, alpha);

    state_effects = state.effects;
    drawEffects(alpha);
  }

  return { resize, draw, cam };
}
