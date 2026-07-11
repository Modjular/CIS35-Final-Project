// sprites.js — atlas loading + animation playback (render-side only).
//
// Animation is purely cosmetic: frame timing runs on render time, never in the
// sim. The sim provides the *state* to display (facing, attacking, hitFlash);
// this module maps (team, unit, state) -> a logical image and plays its frames.
//
// Source-art note: the ripped Advance Wars sheets are asymmetric. Orange Star
// (red) has rich fire anims but single-frame move sprites for tank/mtank/recon;
// Green Earth (green) has no recon art at all. Fallbacks below keep every unit
// rendering with the correct team color (documented per-entry).

import { TEAM } from '../sim/data.js';

// (team, unit) -> { move, fire, moveStatic? }.  logical names index atlas.images.
const MAP = {
  red: {
    TANK:     { move: 'os_tank_move',  fire: 'os_tank_fire'  }, // move = single frame
    MTANK:    { move: 'os_mtank_fire', fire: 'os_mtank_fire', moveStatic: true }, // no OS mtank move sheet
    INFANTRY: { move: 'os_inf_move',   fire: 'os_inf_fire'   },
    RECON:    { move: 'os_recon_move', fire: 'os_recon_fire' }, // move = single frame
  },
  green: {
    TANK:     { move: 'ge_tank_move',  fire: 'ge_tank_fire'  },
    MTANK:    { move: 'ge_mtank_move', fire: 'ge_mtank_fire' },
    INFANTRY: { move: 'ge_inf_move',   fire: 'ge_inf_fire'   },
    RECON:    { move: 'ge_tank_move',  fire: 'ge_tank_fire'  }, // no GE recon art -> tank stand-in
  },
};

// Target on-screen heights in WORLD units (normalizes the wildly different
// source frame sizes into consistent, readable unit scales).
const TARGET_H = { INFANTRY: 0.8, TANK: 1.15, MTANK: 1.35, RECON: 1.0 };
const HQ_TARGET_H = 3.0;
const EXPLOSION_TARGET_H = 3.0;

export async function loadSprites(base = 'assets/') {
  const atlas = await fetch(base + 'atlas.json').then((r) => r.json());
  const images = atlas.images;
  await Promise.all(Object.values(images).map((im) => new Promise((res) => {
    const img = new Image();
    img.onload = () => { im.img = img; res(); };
    img.onerror = () => { im.img = null; res(); };
    img.src = base + 'sprites/' + im.file;
  })));
  return new SpriteManager(atlas);
}

class SpriteManager {
  constructor(atlas) {
    this.atlas = atlas;
    this.fps = atlas.fps || 12;
    this.ready = true;
    // Reusable offscreen buffer for per-sprite hit-flash tinting.
    this._buf = document.createElement('canvas');
    this._bctx = this._buf.getContext('2d');
  }

  image(name) { return this.atlas.images[name]; }
  hasMap() { return !!(this.atlas.images.map && this.atlas.images.map.img); }
  worldHeightOf(e) { return e.kind === 'tower' ? HQ_TARGET_H : TARGET_H[e.unitType]; }

  frameIndex(im, clock, phase = 0) {
    const n = im.frames.length;
    if (n <= 1) return 0;
    return Math.floor((clock + phase) * this.fps) % n;
  }

  // Draw a unit/tower sprite centered at screen (cx, cy). worldH in world units,
  // scalePx = camera scale. flip mirrors horizontally. flash in [0,1] tints cyan.
  _blit(ctx, im, frame, cx, cy, worldH, scalePx, flip, flash) {
    if (!im || !im.img) return false;
    const dh = worldH * scalePx;
    const dw = dh * (frame.w / frame.h);
    let src = im.img;
    let sx = frame.x, sy = frame.y, sw = frame.w, sh = frame.h;

    // Hit-flash: composite a cyan wash onto just the sprite's pixels via a buffer.
    if (flash > 0) {
      this._buf.width = sw; this._buf.height = sh;
      this._bctx.clearRect(0, 0, sw, sh);
      this._bctx.drawImage(im.img, sx, sy, sw, sh, 0, 0, sw, sh);
      this._bctx.globalCompositeOperation = 'source-atop';
      this._bctx.fillStyle = `rgba(90,255,255,${0.6 * flash})`;
      this._bctx.fillRect(0, 0, sw, sh);
      this._bctx.globalCompositeOperation = 'source-over';
      src = this._buf; sx = 0; sy = 0;
    }

    ctx.save();
    ctx.translate(cx, cy);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(src, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return true;
  }

  drawUnit(ctx, u, cx, cy, scalePx, clock) {
    const set = MAP[u.team][u.unitType];
    const state = u.attacking ? 'fire' : 'move';
    const im = this.image(set[state]);
    const isStatic = state === 'move' && set.moveStatic;
    const phase = (u.id % 7) * 0.03; // desync identical units slightly
    const frame = im.frames[isStatic ? 0 : this.frameIndex(im, clock, phase)];
    // The ripped sheets natively face LEFT, so mirror when the unit faces right
    // (i.e. Red marching rightward). Green marching left needs no flip.
    const flip = u.facing > 0;
    return this._blit(ctx, im, frame, cx, cy, TARGET_H[u.unitType], scalePx, flip, u.hitFlash > 0 ? Math.min(1, u.hitFlash / 0.3) : 0);
  }

  drawTower(ctx, t, cx, cy, scalePx) {
    const im = this.image(t.team === TEAM.RED ? 'hq_red' : 'hq_green');
    return this._blit(ctx, im, im.frames[0], cx, cy, HQ_TARGET_H, scalePx, false,
      t.hitFlash > 0 ? Math.min(1, t.hitFlash / 0.3) : 0);
  }

  // Explosion one-shot: pick a frame from age/ttl (no loop).
  drawExplosion(ctx, fx, cx, cy, scalePx) {
    const im = this.image('explosion');
    if (!im || !im.img) return false;
    const n = im.frames.length;
    const idx = Math.min(n - 1, Math.floor((fx.age / fx.ttl) * n));
    return this._blit(ctx, im, im.frames[idx], cx, cy, EXPLOSION_TARGET_H, scalePx, false, 0);
  }
}
