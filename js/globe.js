// The globe: an old-paper political globe on a brass stand. Drag to spin, pinch or +/- to zoom, tap to place a pin.
/* global d3, topojson */
const INK = "#5a4a35", RED = "#b23a2e", GREEN = "#2f6b4f";
const PAL = ["#e6d3a3", "#dcc0a0", "#cdd3a8", "#e3c7b8", "#d9cfa0", "#c3d0b8", "#d8c6c9"];
const GRAT = d3.geoGraticule10();
let WORLD = null;

export async function loadWorld() {
  if (WORLD) return WORLD;
  const w = await fetch("vendor/countries-110m.json").then(r => r.json());
  const countries = topojson.feature(w, w.objects.countries).features;
  const byId = new Map(countries.map(f => [f.id, f]));
  WORLD = { countries, byId };
  return WORLD;
}

export class Globe {
  constructor(canvas, { interactive = true, onTap = null, stand = true, spin = false } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    this.interactive = interactive; this.onTap = onTap; this.stand = stand; this.spin = spin;
    this.rot = [80, -12, 0]; this.zoom = 1; this.target = null;
    this.pin = null; this.rev = null; this.W = 0; this.H = 0; this.raf = 0; this.dirty = true;
    this.proj = d3.geoOrthographic().clipAngle(90);
    this.path = d3.geoPath(this.proj, this.ctx);
    this.ptrs = new Map(); this.gesture = null;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    if (interactive) this.bind();
    this.resize();
  }
  resize() {
    const p = this.cv.parentElement, d = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    this.W = p.clientWidth; this.H = p.clientHeight;
    if (!this.W || !this.H) return;
    this.cv.width = this.W * d; this.cv.height = this.H * d;
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    this.kick();
  }
  get baseR() { return Math.max(40, Math.min(this.W, this.H - (this.stand ? 64 : 0)) / 2 - (this.stand ? 22 : 6)); }
  get center() { return [this.W / 2, this.stand ? (this.H - 46) / 2 : this.H / 2]; }
  kick() { this.dirty = true; if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); }
  frame() {
    this.raf = 0; let again = false;
    if (this.target) {
      const d0 = (((this.target[0] - this.rot[0]) + 540) % 360) - 180, d1 = this.target[1] - this.rot[1];
      this.rot = [this.rot[0] + d0 * .12, this.rot[1] + d1 * .12, 0];
      if (Math.abs(d0) < .15 && Math.abs(d1) < .15) this.target = null; else again = true;
    } else if (this.spin && !this.ptrs.size) { this.rot = [this.rot[0] + .15, this.rot[1], 0]; again = true; }
    if (this.zt) { this.zoom += (this.zt - this.zoom) * .16; if (Math.abs(this.zt - this.zoom) < .01) { this.zoom = this.zt; this.zt = 0; } else again = true; }
    if (this.rev && this.rev.t < 1) { this.rev.t = Math.min(1, this.rev.t + .04); again = true; }
    if (this.pin && !this.rev) { this.pulse = (this.pulse || 0) + .06; again = true; }
    if (this.W && this.H && WORLD) this.draw();
    if (again) this.raf = requestAnimationFrame(() => this.frame());
  }
  // ---- public
  setPin(p) { this.pin = p; this.kick(); }
  clear() { this.pin = null; this.rev = null; this.kick(); }
  reveal(guess, target, label, ccn, dist, x = {}) { this.pin = guess; this.rev = { guess, target, label, ccn, dist, ...x, t: 0 }; this.kick(); }
  showAnswer(guess, target, label, ccn, dist, x = {}) { this.pin = guess; this.rev = { guess, target, label, ccn, dist, ...x, t: 1 }; this.kick(); }
  zoomTo(z) { this.zt = Math.max(1, Math.min(8, z)); this.kick(); }
  flyTo(p, up = 0) { this.target = [-p[0], Math.max(-85, Math.min(85, -p[1] + up))]; this.kick(); }
  setZoom(z) { this.zt = 0; this.zoom = Math.max(1, Math.min(8, z)); this.kick(); }
  zoomBy(k) { this.setZoom(this.zoom * k); }
  // ---- input
  bind() {
    const cv = this.cv;
    cv.addEventListener("pointerdown", e => {
      cv.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.ptrs.size === 1) this.gesture = { x: e.clientX, y: e.clientY, rot: [...this.rot], moved: false, t: performance.now(), multi: false };
      else if (this.ptrs.size === 2) { this.gesture.multi = true; this.gesture.d0 = this.spread(); this.gesture.z0 = this.zoom; }
      this.target = null;
    });
    cv.addEventListener("pointermove", e => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.gesture; if (!g) return;
      if (this.ptrs.size >= 2) { this.setZoom(g.z0 * this.spread() / g.d0); return; }
      if (g.multi) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.hypot(dx, dy) > 7) g.moved = true;
      if (g.moved) { const k = 57.3 / this.proj.scale(); this.rot = [g.rot[0] + dx * k, Math.max(-85, Math.min(85, g.rot[1] - dy * k)), 0]; this.kick(); }
    });
    const up = e => {
      if (!this.ptrs.has(e.pointerId)) return;
      this.ptrs.delete(e.pointerId);
      const g = this.gesture;
      if (this.ptrs.size === 0 && g) {
        this.gesture = null;
        if (!g.moved && !g.multi && e.type === "pointerup" && performance.now() - g.t < 700) this.tap(e);
        this.kick();
      }
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", e => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.12 : .89); }, { passive: false });
  }
  spread() { const [a, b] = [...this.ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  tap(e) {
    const b = this.cv.getBoundingClientRect(), k = this.W / b.width, x = (e.clientX - b.left) * k, y = (e.clientY - b.top) * k, c = this.center;
    if (Math.hypot(x - c[0], y - c[1]) > this.proj.scale()) return;
    const p = this.proj.invert([x, y]);
    if (p && !isNaN(p[0]) && this.onTap) this.onTap(p);
  }
  // ---- drawing
  visible(p) { return d3.geoDistance(p, [-this.rot[0], -this.rot[1]]) < Math.PI / 2 - .02; }
  draw() {
    const { ctx, W, H, proj, path } = this, c = this.center, R = this.baseR, r = R * this.zoom;
    proj.scale(r).translate(c).rotate(this.rot);
    ctx.clearRect(0, 0, W, H);
    if (this.stand && this.zoom < 1.12) this.drawStand(c, R);
    ctx.beginPath(); path({ type: "Sphere" });
    let g = ctx.createRadialGradient(c[0] - r * .35, c[1] - r * .4, r * .1, c[0], c[1], r);
    g.addColorStop(0, "#e4ead9"); g.addColorStop(1, "#a9c2bd"); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); path(GRAT); ctx.strokeStyle = "#5a4a3526"; ctx.lineWidth = .6; ctx.stroke();
    ctx.lineJoin = "round";
    for (const f of WORLD.countries) {
      ctx.beginPath(); path(f);
      ctx.fillStyle = PAL[(+f.id || 0) % PAL.length]; ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = .5; ctx.stroke();
    }
    const rv = this.rev;
    if (rv && rv.ccn && rv.t >= 1) { const f = WORLD.byId.get(rv.ccn); if (f) { ctx.beginPath(); path(f); ctx.fillStyle = "#b23a2e59"; ctx.fill(); ctx.strokeStyle = RED; ctx.lineWidth = 1.6; ctx.stroke(); } }
    ctx.beginPath(); path({ type: "Sphere" });
    g = ctx.createRadialGradient(c[0] - r * .4, c[1] - r * .45, r * .2, c[0], c[1], r * 1.02);
    g.addColorStop(0, "rgba(255,255,255,.26)"); g.addColorStop(.6, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(50,40,20,.30)");
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#5a4a3588"; ctx.lineWidth = 1; ctx.stroke();
    if (rv && rv.t >= 1 && rv.rings) this.drawRings(rv);
    if (rv) {
      const ip = d3.geoInterpolate(rv.guess, rv.target), pts = [];
      for (let i = 0; i <= 48; i++) pts.push(ip(i / 48 * rv.t));
      ctx.beginPath(); path({ type: "LineString", coordinates: pts });
      ctx.strokeStyle = RED; ctx.lineWidth = 2.2; ctx.setLineDash([7, 6]); ctx.lineCap = "round"; ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.pin) this.drawPin(this.pin, RED, false);
    if (rv && rv.t >= 1) this.drawPin(rv.target, GREEN, true, rv.label);
    if (rv && rv.t >= 1 && rv.dist) this.drawDist(rv);
    if (rv && rv.t >= 1 && rv.you && this.visible(rv.guess)) { const [x, y] = this.proj(rv.guess); this.pill(rv.you, x, y + 24, RED, '600 12.5px "Avenir Next",system-ui,sans-serif'); }
  }
  drawPin(p, color, isTarget, label) {
    if (!this.visible(p)) return;
    const { ctx, W } = this, [x, y] = this.proj(p);
    if (!isTarget && !this.rev) { const a = 10 + 5 * Math.sin(this.pulse || 0); ctx.beginPath(); ctx.arc(x, y, a + 4, 0, 7); ctx.fillStyle = "#b23a2e30"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(x, y, isTarget ? 9 : 7, 0, 7); ctx.fillStyle = isTarget ? "#fff" : color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = isTarget ? color : "#f6eeda"; ctx.stroke();
    if (!isTarget) return;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fillStyle = color; ctx.fill();
    ctx.font = '600 14px "Iowan Old Style","Palatino Linotype",Georgia,serif';
    const w = ctx.measureText(label).width + 16, lx = Math.min(Math.max(x - w / 2, 6), W - w - 6), ly = y - 38 < 6 ? y + 16 : y - 38;
    ctx.fillStyle = "#f6eeda"; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(lx, ly, w, 24, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#1f2f4a"; ctx.textBaseline = "middle"; ctx.fillText(label, lx + 8, ly + 12.5);
  }
  // the miles, written on the line itself, so a short-looking line on a whole-globe view can't mislead
  drawDist(rv) {
    const mid = d3.geoInterpolate(rv.guess, rv.target)(.5); if (!this.visible(mid)) return;
    const { ctx, W } = this, [x, y] = this.proj(mid), [ax, ay] = this.proj(rv.guess), [bx, by] = this.proj(rv.target);
    if (Math.hypot(ax - bx, ay - by) < 70) return;
    ctx.font = '700 12px "Courier New",Courier,monospace';
    const w = ctx.measureText(rv.dist).width + 12, lx = Math.min(Math.max(x - w / 2, 6), W - w - 6);
    ctx.fillStyle = "#f6eeda"; ctx.strokeStyle = RED; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(lx, y - 10, w, 20, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = RED; ctx.textBaseline = "middle"; ctx.fillText(rv.dist, lx + 6, y + .5);
  }
  // a bullseye around the answer: each ring is where the points drop to 75, 50 and 25, so distance reads as score
  drawRings(rv) {
    const { ctx, path } = this, cols = [GREEN, "#b06a12", RED];
    rv.rings.forEach((r, i) => {
      const circle = d3.geoCircle().center(rv.target).radius(r.km / 111.19).precision(3)();
      ctx.beginPath(); path(circle); ctx.strokeStyle = cols[i]; ctx.globalAlpha = .75; ctx.lineWidth = 1.6; ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      let best = null;
      for (const p of circle.coordinates[0]) { if (!this.visible(p)) continue; const q = this.proj(p); if (q[0] < 40 || q[0] > this.W - 40 || q[1] < 14) continue; if (!best || q[1] < best[1]) best = q; }
      if (best) this.pill(r.label, best[0], best[1], cols[i], '700 11px "Courier New",Courier,monospace');
    });
  }
  pill(text, x, y, color, font) {
    const { ctx, W } = this; ctx.font = font;
    const w = ctx.measureText(text).width + 12, lx = Math.min(Math.max(x - w / 2, 6), W - w - 6);
    ctx.fillStyle = "#f6eeda"; ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(lx, y - 10, w, 20, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textBaseline = "middle"; ctx.fillText(text, lx + 6, y + .5);
  }
  drawStand(c, r) {
    const ctx = this.ctx, by = c[1] + r + 30;
    ctx.save();
    ctx.fillStyle = "rgba(60,40,10,.16)"; ctx.beginPath(); ctx.ellipse(c[0], by + 15, r * .6, 11, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#7a5230"; ctx.beginPath(); ctx.ellipse(c[0], by + 8, r * .44, 10, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#94643a"; ctx.beginPath(); ctx.ellipse(c[0], by + 3, r * .44, 10, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#b8893a"; ctx.fillRect(c[0] - 6, c[1] + r + 4, 12, 28);
    ctx.strokeStyle = "#c79a45"; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(c[0], c[1], r + 13, -Math.PI * .62, Math.PI * .5); ctx.stroke();
    ctx.strokeStyle = "#e6c477"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(c[0], c[1], r + 15, -Math.PI * .6, Math.PI * .48); ctx.stroke();
    ctx.restore();
  }
}
