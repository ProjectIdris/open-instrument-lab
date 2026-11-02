// SPDX-License-Identifier: GPL-3.0-only
// The window on the bench: where the drawing is looking, how far in, and the pointer in millimetres.
// Shared by every kind of bench; each draws its own picture into the same SVG.

export class ViewPort {
  constructor(svg) {
    this.svg = svg;
    this.view = { cx: 0, cy: 0, scale: 1 };
    this.size = { w: 1, h: 1 };
    this.autoFit = true;
    this.measure();
  }

  measure() {
    const rect = this.svg.getBoundingClientRect();
    this.size = { w: Math.max(100, rect.width), h: Math.max(100, rect.height) };
  }

  /** Frame a box (x0, y0, x1, y1 in mm) so all of it shows. */
  fitExtent(extent) {
    this.measure();
    const w = extent.x1 - extent.x0;
    const h = extent.y1 - extent.y0;
    this.autoFit = true;
    this.view = { cx: (extent.x0 + extent.x1) / 2, cy: (extent.y0 + extent.y1) / 2, scale: Math.min(this.size.w / w, this.size.h / h) };
    this.apply();
    this.render();
  }

  apply() {
    const { cx, cy, scale } = this.view;
    const w = this.size.w / scale;
    const h = this.size.h / scale;
    this.svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
  }

  zoomAt(factor, clientX, clientY) {
    this.autoFit = false;
    const before = this.toMm(clientX, clientY);
    this.view.scale = Math.min(12, Math.max(0.25, this.view.scale * factor));
    this.apply();
    const after = this.toMm(clientX, clientY);
    this.view.cx += before.x - after.x;
    this.view.cy += before.y - after.y;
    this.apply();
    this.render();
  }

  panBy(dxPx, dyPx) {
    this.autoFit = false;
    this.view.cx -= dxPx / this.view.scale;
    this.view.cy -= dyPx / this.view.scale;
    this.apply();
  }

  get pxPerMm() { return this.view.scale; }

  /** A length in screen pixels as millimetres on the bench. */
  px(n) { return n / this.view.scale; }

  toMm(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const { cx, cy, scale } = this.view;
    return { x: cx + (clientX - rect.left - rect.width / 2) / scale, y: cy + (clientY - rect.top - rect.height / 2) / scale };
  }
}
