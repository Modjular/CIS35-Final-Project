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

import { TEAM, FLASH_TIME, CARD_BY_ID } from '../sim/data.js';

// (team, unit) -> { move, fire, moveStatic?, face }. logical names index atlas.images.
//
// `face` is the sheet's NATIVE facing (+1 right, -1 left), determined from the
// actual art: the ripped infantry sheets face RIGHT, every vehicle sheet faces
// LEFT. The renderer mirrors a sprite only when the unit's facing differs from
// its sheet's native facing — so a blanket assumption can't send one unit type
// the wrong way (the earlier bug: infantry rendered backwards for both teams).
const MAP = {
  red: {
    TANK:     { move: 'os_tank_move',  fire: 'os_tank_fire',  face: -1 }, // move = single frame
    MTANK:    { move: 'os_mtank_fire', fire: 'os_mtank_fire', face: -1, moveStatic: true }, // no OS mtank move sheet
    INFANTRY: { move: 'os_inf_move',   fire: 'os_inf_fire',   face: 1  },
    RECON:    { move: 'os_recon_move', fire: 'os_recon_fire', face: -1 }, // move = single frame
  },
  green: {
    TANK:     { move: 'ge_tank_move',  fire: 'ge_tank_fire',  face: -1 },
    MTANK:    { move: 'ge_mtank_move', fire: 'ge_mtank_fire', face: -1 },
    INFANTRY: { move: 'ge_inf_move',   fire: 'ge_inf_fire',   face: 1  },
    RECON:    { move: 'ge_tank_move',  fire: 'ge_tank_fire',  face: -1 }, // no GE recon art -> tank stand-in
  },
};

// Target on-screen heights in WORLD units (normalizes the wildly different
// source frame sizes into consistent, readable unit scales).
const TARGET_H = { INFANTRY: 0.8, TANK: 1.15, MTANK: 1.35, RECON: 1.0 };
const HQ_TARGET_H = 3.0;
const EXPLOSION_TARGET_H = 3.0;

// Normalized damage-flash amount in [0,1] for an entity (0 = no flash).
function flashAmt(e) {
  return e.hitFlash > 0 ? Math.min(1, e.hitFlash / FLASH_TIME) : 0;
}

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
    // Mirror only when the unit faces opposite to the sheet's native facing.
    const flip = u.facing !== (set.face ?? -1);
    return this._blit(ctx, im, frame, cx, cy, TARGET_H[u.unitType], scalePx, flip, flashAmt(u));
  }

  drawTower(ctx, t, cx, cy, scalePx) {
    const im = this.image(t.team === TEAM.RED ? 'hq_red' : 'hq_green');
    return this._blit(ctx, im, im.frames[0], cx, cy, HQ_TARGET_H, scalePx, false, flashAmt(t));
  }

  // Draw a card's face (unit sheet frame 0, or an explosion frame) fit into the
  // box (bx,by,bw,bh), preserving aspect and always facing right for a tidy row.
  drawCardFace(ctx, team, cardId, bx, by, bw, bh) {
    const card = CARD_BY_ID[cardId];
    if (!card) return false;
    let im, frame, flip = false;
    if (card.spell) {
      im = this.image('explosion');
      if (!im || !im.img) return false;
      frame = im.frames[Math.floor(im.frames.length / 2)];   // mid-blast, most filled
    } else {
      const set = MAP[team][card.unit];
      im = this.image(set.move);
      if (!im || !im.img) return false;
      frame = im.frames[0];
      flip = (set.face ?? -1) === -1;                        // mirror left-facing art to face right
    }
    const ar = frame.w / frame.h;
    let dw = bw, dh = bw / ar;
    if (dh > bh) { dh = bh; dw = bh * ar; }
    const cx = bx + bw / 2, cy = by + bh / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, cy);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(im.img, frame.x, frame.y, frame.w, frame.h, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return true;
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
