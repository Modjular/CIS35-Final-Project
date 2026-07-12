// pointer.js — turns pointer gestures into sim commands.
//
// Model (local hotseat): each card row belongs to a team, so grabbing a Red card
// begins a Red placement and a Green card a Green placement — the "player" is the
// row you pressed. Press a card -> drag a snapped ghost -> release over the field
// to enqueue a PLACE_UNITS / CAST_SPELL command. Release elsewhere cancels.
//
// Works for mouse, touch, and pen via Pointer Events. The drag state is exposed
// so the renderer/HUD can draw the ghost; input never mutates sim state.

import { screenToWorld } from '../render/camera.js';
import { FIELD } from '../sim/data.js';

function inField(x, y) {
  return x >= 0 && x <= FIELD.W && y >= 0 && y <= FIELD.H;
}

export function setupPointer(canvas, cam, hud, api) {
  // api: { enqueue(cmd), getState(), restart() }
  const drag = {
    active: false, pointerId: null,
    playerId: null, team: null, card: null, type: null,
    worldX: 0, worldY: 0,
  };

  // CSS px (relative to canvas) -> backing-store px for HUD hit tests.
  function toBacking(e) {
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    return { cssX, cssY, px: cssX * cam.dpr, py: cssY * cam.dpr };
  }

  function onDown(e) {
    const { cssX, cssY, px, py } = toBacking(e);

    // Game-over: click "Play again".
    if (api.getState().winner) {
      if (hud.hitTestRestart(px, py)) { api.restart(); }
      return;
    }

    const card = hud.hitTestCard(px, py);
    if (!card) return;
    drag.active = true;
    drag.pointerId = e.pointerId;
    drag.playerId = card.playerId;
    drag.team = card.team;
    drag.card = card.card;
    drag.type = card.type;
    const w = screenToWorld(cam, cssX, cssY);
    drag.worldX = w.x; drag.worldY = w.y;
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    const { cssX, cssY } = toBacking(e);
    const w = screenToWorld(cam, cssX, cssY);
    drag.worldX = w.x; drag.worldY = w.y;
    e.preventDefault();
  }

  function onUp(e) {
    if (!drag.active || e.pointerId !== drag.pointerId) return;
    // Only a release over the play area (and NOT over the card row, which
    // visually overlaps the field's bottom edge) is a real placement attempt.
    // A plain tap on a card, or a release in the letterbox, silently cancels
    // instead of firing an off-field command + error beep. Valid in-field drops
    // still go to the sim, which authoritatively re-validates (mana/half).
    const { px, py } = toBacking(e);
    if (inField(drag.worldX, drag.worldY) && !hud.hitTestCard(px, py)) {
      api.enqueue({
        playerId: drag.playerId, type: drag.type, card: drag.card,
        x: drag.worldX, y: drag.worldY,
      });
    }
    drag.active = false;
    drag.pointerId = null;
    canvas.releasePointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onCancel(e) {
    if (e.pointerId !== drag.pointerId) return;
    drag.active = false;
    drag.pointerId = null;
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  return drag;
}
