// camera.js — the letterbox transform between world (22x12, +y up, origin
// bottom-left) and canvas pixels (+y down). Shared by the renderer and input so
// pointer coordinates and drawing always agree.

import { FIELD } from '../sim/data.js';

export function createCamera() {
  // Filled in by fit(): pixel scale + top-left offset of the letterboxed field.
  return { scale: 1, ox: 0, oy: 0, cssW: 0, cssH: 0, dpr: 1 };
}

// Fit the 22:12 field into the canvas backing store, centered (letterboxed).
export function fit(cam, cssW, cssH, dpr) {
  cam.cssW = cssW;
  cam.cssH = cssH;
  cam.dpr = dpr;
  const pxW = cssW * dpr;
  const pxH = cssH * dpr;
  cam.scale = Math.min(pxW / FIELD.W, pxH / FIELD.H);
  cam.ox = (pxW - FIELD.W * cam.scale) * 0.5;
  cam.oy = (pxH - FIELD.H * cam.scale) * 0.5;
  return cam;
}

// World -> canvas backing-store pixels.
export function worldToScreen(cam, wx, wy) {
  return {
    x: cam.ox + wx * cam.scale,
    y: cam.oy + (FIELD.H - wy) * cam.scale,
  };
}

// CSS pixels (pointer event clientX/Y relative to canvas) -> world units.
export function screenToWorld(cam, cssX, cssY) {
  const px = cssX * cam.dpr;
  const py = cssY * cam.dpr;
  return {
    x: (px - cam.ox) / cam.scale,
    y: FIELD.H - (py - cam.oy) / cam.scale,
  };
}
