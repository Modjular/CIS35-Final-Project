// hud.js — on-canvas UI: two card rows (Red bottom-left, Green bottom-right),
// two mana bars (bottom-center), the drag ghost, and the game-over overlay.
//
// All geometry is in canvas backing-store pixels (same space the renderer draws
// in). hitTest* accept backing-store pixels too; pointer.js converts from CSS.
// Card art here is placeholder (Phase 3 swaps in sprite faces).

import { CARDS, MANA, TEAM, PLAYERS } from '../sim/data.js';
import { previewCommand } from '../sim/sim.js';
import { worldToScreen } from './camera.js';

const RED = '#e8663a';
const GREEN = '#4fd08a';

export function createHud() {
  // Recomputed on every draw from the current canvas size.
  let layout = { cards: [], mana: [], restart: null };

  function computeLayout(cam) {
    const W = cam.cssW * cam.dpr;
    const H = cam.cssH * cam.dpr;
    const pad = Math.round(10 * cam.dpr);
    const rowW = W * 0.40;
    const gap = Math.round(6 * cam.dpr);
    const cardW = (rowW - gap * (CARDS.length - 1)) / CARDS.length;
    const cardH = Math.min(cardW * 1.25, H * 0.16);
    const y = H - cardH - pad;

    const cards = [];
    // Red row: bottom-left, left-to-right.
    PLAYERS.forEach((pl) => {
      const isRed = pl.team === TEAM.RED;
      const x0 = isRed ? pad : W - pad - rowW;
      CARDS.forEach((c, i) => {
        cards.push({
          playerId: pl.id, team: pl.team, card: c.id,
          type: c.spell ? 'CAST_SPELL' : 'PLACE_UNITS',
          x: x0 + i * (cardW + gap), y, w: cardW, h: cardH,
        });
      });
    });

    // Mana bars: centered, one per player just above the card baseline.
    const barW = W * 0.13;
    const barH = Math.round(14 * cam.dpr);
    const cx = W / 2;
    const mana = [
      { team: TEAM.RED,   x: cx - barW - pad / 2, y: H - pad - barH, w: barW, h: barH, dir: -1 },
      { team: TEAM.GREEN, x: cx + pad / 2,        y: H - pad - barH, w: barW, h: barH, dir: 1 },
    ];

    layout = { cards, mana, restart: null, cam };
    return layout;
  }

  function drawCard(ctx, cardRect, def, affordable, dragging, cam) {
    const { x, y, w, h } = cardRect;
    const teamColor = cardRect.team === TEAM.RED ? RED : GREEN;
    ctx.save();
    ctx.globalAlpha = affordable ? 1 : 0.4;
    // Card body.
    ctx.fillStyle = '#1b2029';
    roundRect(ctx, x, y, w, h, 6 * cam.dpr);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 2 * cam.dpr);
    ctx.strokeStyle = dragging ? '#fff' : teamColor;
    ctx.stroke();

    // Placeholder face: team-tinted disc + unit/spell label.
    ctx.fillStyle = teamColor;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.42, Math.min(w, h) * 0.24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#dfe6ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.14)}px system-ui, sans-serif`;
    const label = def.spell ? 'BOOM' : def.unit.slice(0, 5);
    ctx.fillText(label, x + w / 2, y + h * 0.74);

    // Cost badge (bottom-right).
    const bs = Math.round(h * 0.26);
    ctx.fillStyle = '#12305a';
    ctx.beginPath();
    ctx.arc(x + w - bs * 0.55, y + h - bs * 0.55, bs * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8fd7ff';
    ctx.font = `bold ${Math.round(bs * 0.8)}px system-ui, sans-serif`;
    ctx.fillText(String(def.cost), x + w - bs * 0.55, y + h - bs * 0.5);
    ctx.restore();
  }

  function drawManaBar(ctx, bar, mana, cam) {
    const pct = Math.max(0, Math.min(1, mana / MANA.max));
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, bar.x, bar.y, bar.w, bar.h, 4 * cam.dpr);
    ctx.fill();
    // Fill grows from the center outward (dir -1 => leftwards, +1 => rightwards).
    const fillW = bar.w * pct;
    ctx.fillStyle = bar.team === TEAM.RED ? RED : GREEN;
    const fx = bar.dir < 0 ? bar.x + bar.w - fillW : bar.x;
    ctx.fillRect(fx, bar.y, fillW, bar.h);
    // Pip separators.
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, cam.dpr);
    ctx.beginPath();
    for (let i = 1; i < MANA.max; i++) {
      const px = bar.x + (bar.w * i) / MANA.max;
      ctx.moveTo(px, bar.y); ctx.lineTo(px, bar.y + bar.h);
    }
    ctx.stroke();
    // Numeric mana.
    ctx.fillStyle = '#fff';
    ctx.textAlign = bar.dir < 0 ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(bar.h * 0.9)}px ui-monospace, monospace`;
    const tx = bar.dir < 0 ? bar.x - 6 * cam.dpr : bar.x + bar.w + 6 * cam.dpr;
    ctx.fillText(`${mana}`, tx, bar.y + bar.h / 2);
  }

  // Draw the snapped ghost cell + a translucent unit/spell marker while dragging.
  function drawGhost(ctx, cam, state, drag) {
    if (!drag || !drag.active) return;
    const pv = previewCommand(state, {
      playerId: drag.playerId, type: drag.type, card: drag.card,
      x: drag.worldX, y: drag.worldY,
    });
    const s = cam.scale;
    const center = worldToScreen(cam, pv.x, pv.y);
    const good = pv.ok;
    ctx.save();
    ctx.globalAlpha = 0.55;
    // Snapped 1x1 cell.
    const cell = worldToScreen(cam, pv.x - 0.5, pv.y + 0.5);
    ctx.strokeStyle = good ? '#fff' : '#ff5a5a';
    ctx.lineWidth = 2 * cam.dpr;
    ctx.strokeRect(cell.x, cell.y, s, s);
    // Marker disc.
    ctx.fillStyle = good ? (drag.team === TEAM.RED ? RED : GREEN) : 'rgba(255,80,80,0.6)';
    ctx.beginPath();
    ctx.arc(center.x, center.y, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGameOver(ctx, cam, state) {
    if (!state.winner) { layout.restart = null; return; }
    const W = cam.cssW * cam.dpr, H = cam.cssH * cam.dpr;
    ctx.save();
    ctx.fillStyle = 'rgba(6,8,12,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = state.winner === TEAM.RED ? RED : GREEN;
    ctx.font = `bold ${Math.round(H * 0.11)}px system-ui, sans-serif`;
    ctx.fillText(`${state.winner.toUpperCase()} WINS`, W / 2, H * 0.4);

    // Play-again button.
    const bw = W * 0.24, bh = H * 0.12;
    const bx = W / 2 - bw / 2, by = H * 0.55;
    ctx.fillStyle = '#1b2029';
    roundRect(ctx, bx, by, bw, bh, 10 * cam.dpr);
    ctx.fill();
    ctx.lineWidth = 2 * cam.dpr;
    ctx.strokeStyle = '#dfe6ee';
    ctx.stroke();
    ctx.fillStyle = '#dfe6ee';
    ctx.font = `bold ${Math.round(bh * 0.4)}px system-ui, sans-serif`;
    ctx.fillText('Play again', W / 2, by + bh / 2);
    layout.restart = { x: bx, y: by, w: bw, h: bh };
    ctx.restore();
  }

  function draw(ctx, cam, state, drag) {
    computeLayout(cam);
    const manaByTeam = Object.fromEntries(state.players.map((p) => [p.team, p.mana]));
    for (const cr of layout.cards) {
      const def = CARDS.find((c) => c.id === cr.card);
      const affordable = manaByTeam[cr.team] >= def.cost && !state.winner;
      const dragging = drag && drag.active && drag.card === cr.card && drag.playerId === cr.playerId;
      drawCard(ctx, cr, def, affordable, dragging, cam);
    }
    for (const bar of layout.mana) drawManaBar(ctx, bar, manaByTeam[bar.team], cam);
    drawGhost(ctx, cam, state, drag);
    drawGameOver(ctx, cam, state);
  }

  // Hit tests take backing-store pixels.
  function hitTestCard(px, py) {
    for (const cr of layout.cards) {
      if (px >= cr.x && px <= cr.x + cr.w && py >= cr.y && py <= cr.y + cr.h) return cr;
    }
    return null;
  }
  function hitTestRestart(px, py) {
    const r = layout.restart;
    return !!(r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  }

  return { draw, hitTestCard, hitTestRestart };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
