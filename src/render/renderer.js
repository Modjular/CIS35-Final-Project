// renderer.js — canvas setup + the draw loop.
//
// Two backends behind one interface: a "debug" backend (colored circles/rects,
// used before art loads and for verification) and a "sprite" backend (Advance
// Wars sheets via SpriteManager). The sim is never mutated here — we only read
// state and interpolate positions between the previous and current tick.

import { FIELD, TEAM, UNITS, TOWER, BAR_SCALE } from '../sim/data.js';
import { createCamera, fit, worldToScreen } from './camera.js';

const COLORS = {
  fieldRed:  '#3a2f2f',
  fieldGreen:'#2f3a33',
  water:     '#0d1b2a',
  grid:      'rgba(255,255,255,0.05)',
  midline:   'rgba(255,255,255,0.14)',
  red:       '#e8663a',
  green:     '#4fd08a',
  redDark:   '#7a2f18',
  greenDark: '#1f6a44',
  hpBack:    'rgba(0,0,0,0.6)',
  hpFill:    '#5ad15a',
  flash:     '#8ff',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = createCamera();
  let sprites = null;                 // SpriteManager once art is loaded
  const startTime = (typeof performance !== 'undefined' ? performance.now() : 0);

  function setSprites(sm) { sprites = sm; }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stage = canvas.parentElement;
    const cssW = stage.clientWidth;
    const cssH = stage.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    fit(cam, cssW, cssH, dpr);
    ctx.imageSmoothingEnabled = false;
  }

  function rp(e, alpha) {
    return { x: e.px + (e.x - e.px) * alpha, y: e.py + (e.y - e.py) * alpha };
  }

  function drawField(showGrid) {
    const s = cam.scale;
    ctx.fillStyle = COLORS.water;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tl = worldToScreen(cam, 0, FIELD.H);
    const fieldW = FIELD.W * s, fieldH = FIELD.H * s;

    if (sprites && sprites.hasMap()) {
      const im = sprites.image('map');
      ctx.drawImage(im.img, 0, 0, im.w, im.h, tl.x, tl.y, fieldW, fieldH);
    } else {
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

  // topPx: screen-y of the sprite's top, so bars sit just above the art.
  function drawHealthBar(e, screen, scalePx, topPx) {
    const spec = e.kind === 'tower' ? TOWER : UNITS[e.unitType];
    const barScale = BAR_SCALE[spec.bar] || 1;
    const w = barScale * scalePx * 0.9;
    const h = Math.max(3, scalePx * 0.1);
    const pct = Math.max(0, e.health / e.maxHealth);
    const x = screen.x - w / 2;
    const y = topPx - h - 3;
    ctx.fillStyle = COLORS.hpBack;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = COLORS.hpFill;
    ctx.fillRect(x, y, w * pct, h);
  }

  function drawSpriteEntity(e, alpha, clock) {
    const s = cam.scale;
    const pos = rp(e, alpha);
    const screen = worldToScreen(cam, pos.x, pos.y);
    let ok;
    if (e.kind === 'tower') ok = sprites.drawTower(ctx, e, screen.x, screen.y, s);
    else ok = sprites.drawUnit(ctx, e, screen.x, screen.y, s, clock);
    const worldH = sprites.worldHeightOf(e) || 1;
    const topPx = screen.y - (worldH * s) / 2;
    if (ok) drawHealthBar(e, screen, s, topPx);
    else drawDebugEntity(e, alpha);   // fallback if an image failed to load
  }

  function drawDebugEntity(e, alpha) {
    const s = cam.scale;
    const pos = rp(e, alpha);
    const screen = worldToScreen(cam, pos.x, pos.y);
    const r = Math.max(4, e.radius * s);
    const base = e.team === TEAM.RED ? COLORS.red : COLORS.green;
    if (e.kind === 'tower') {
      ctx.fillStyle = e.hitFlash > 0 ? COLORS.flash
        : (e.team === TEAM.RED ? COLORS.redDark : COLORS.greenDark);
      ctx.fillRect(screen.x - r, screen.y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = e.hitFlash > 0 ? COLORS.flash : base;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = e.firing ? '#fff' : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(screen.x + e.facing * r, screen.y);
      ctx.stroke();
    }
    drawHealthBar(e, screen, s, screen.y - r);
  }

  function drawEffects(alpha, clock) {
    const s = cam.scale;
    for (const fx of curEffects) {
      if (fx.type !== 'explosion') continue;
      const screen = worldToScreen(cam, fx.x, fx.y);
      if (sprites && sprites.drawExplosion(ctx, fx, screen.x, screen.y, s)) continue;
      // Debug ring fallback.
      const t = Math.min(1, fx.age / fx.ttl);
      ctx.strokeStyle = `rgba(255,${Math.round(200 * (1 - t))},80,${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, (0.4 + t * 1.5) * s, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  let curEffects = [];

  function draw(state, alpha, opts = {}) {
    const clock = ((typeof performance !== 'undefined' ? performance.now() : 0) - startTime) / 1000;
    drawField(opts.grid !== false);

    // y-sort: lower world-y drawn later (on top), matching Unity z = y/12.
    const drawables = [...state.towers, ...state.units].sort((a, b) => b.y - a.y);
    const useSprites = sprites && sprites.ready;
    for (const e of drawables) {
      if (useSprites) drawSpriteEntity(e, alpha, clock);
      else drawDebugEntity(e, alpha);
    }
    curEffects = state.effects;
    drawEffects(alpha, clock);
  }

  return { resize, draw, cam, ctx, setSprites };
}
