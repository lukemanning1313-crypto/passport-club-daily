// The globe: a relief globe on a brass stand, tinted like an old map. Real terrain and real oceans,
// country borders inked on top. Drag to spin, pinch or +/- to zoom, tap to place a pin.
/* global d3, topojson */
const RED = "#b23a2e", GREEN = "#2f6b4f", NAVY = "#1f2f4a";
const GRAT = d3.geoGraticule10(), RAD = Math.PI / 180, TAU = Math.PI * 2;
export const FLY_ZOOM = 2.2;   // the one scale every answer is shown at, so near looks near and far looks far
let WORLD = null, TEX = null;

function img(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }); }
// NASA imagery, restyled: land keeps its real relief and color but is washed toward parchment; water becomes a soft antique teal.
async function loadTexture() {
  const [color, water] = await Promise.all([img("vendor/earth_color.jpg"), img("vendor/earth_water.jpg")]);
  const w = color.width, h = color.height, cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const x = cv.getContext("2d", { willReadFrequently: true });
  x.drawImage(water, 0, 0, w, h); const wm = x.getImageData(0, 0, w, h).data;
  x.drawImage(color, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
  const out = new Uint32Array(w * h);
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    const r = d[i], g = d[i + 1], b = d[i + 2], lum = (.3 * r + .59 * g + .11 * b) / 255, m = wm[i] / 255;
    const lr = Math.min(255, (r * .52 + lum * 38 + 232 * .34) * 1.12), lg = Math.min(255, (g * .52 + lum * 38 + 214 * .34) * 1.12), lb = Math.min(255, (b * .46 + lum * 38 + 170 * .34) * 1.08);
    const t = Math.max(0, Math.min(1, (lum - .06) / .22)), or = 150 + 44 * t, og = 184 + 30 * t, ob = 184 + 20 * t;
    const R = lr * (1 - m) + or * m, G = lg * (1 - m) + og * m, B = lb * (1 - m) + ob * m;
    out[k] = (255 << 24 | B << 16 | G << 8 | R) >>> 0;
  }
  return { w, h, px: out };
}
export async function loadWorld() {
  if (WORLD) return WORLD;
  const w = await fetch("vendor/countries-110m.json").then(r => r.json());
  const countries = topojson.feature(w, w.objects.countries).features;
  const borders = topojson.mesh(w, w.objects.countries);
  WORLD = { countries, borders, byId: new Map(countries.map(f => [f.id, f])) };
  try { TEX = await loadTexture(); } catch { TEX = null; }
  return WORLD;
}

export class Globe {
  constructor(canvas, { interactive = true, onTap = null, stand = true, spin = false } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    this.interactive = interactive; this.onTap = onTap; this.stand = stand; this.spin = spin;
    this.rot = [80, -12, 0]; this.zoom = 1; this.zt = 0; this.target = null; this.liftOn = false;
    this.pad = { t: 0, b: 0 }; this.pin = null; this.rev = null; this.W = 0; this.H = 0; this.raf = 0; this.pulse = 0;
    this.proj = d3.geoOrthographic().clipAngle(90);
    this.path = d3.geoPath(this.proj, this.ctx);
    this.buf = document.createElement("canvas"); this.bctx = this.buf.getContext("2d");
    this.ptrs = new Map(); this.gesture = null;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    if (interactive) this.bind();
    this.resize();
  }
  resize() {
    const p = this.cv.parentElement; this.dpr = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    this.W = p.clientWidth; this.H = p.clientHeight;
    if (!this.W || !this.H) return;
    this.cv.width = this.W * this.dpr; this.cv.height = this.H * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.kick();
  }
  get availH() { return this.H - this.pad.t - this.pad.b; }
  get baseR() { return Math.max(40, Math.min(this.W - 4, this.availH - (this.stand ? 64 : 0)) / 2 - (this.stand ? 20 : 6)); }
  get center() { return [this.W / 2, this.pad.t + (this.availH - (this.stand ? 46 : 0)) / 2]; }
  lift() { return this.liftOn ? Math.asin(Math.min(.9, .42 / this.zoom)) / RAD : 0; }
  aim(p) { return [-p[0], Math.max(-85, Math.min(85, -p[1] + this.lift())), 0]; }
  kick() { if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()); }
  frame() {
    this.raf = 0; let again = false; const rv = this.rev;
    if (this.zt) { this.zoom += (this.zt - this.zoom) * .14; if (Math.abs(this.zt - this.zoom) < .01) { this.zoom = this.zt; this.zt = 0; } else again = true; }
    if (rv && rv.t < 1) {             // the flight: the camera rides along from the guess to the answer
      rv.t = Math.min(1, (performance.now() - rv.t0) / rv.dur);
      // ease in and out, and on a long trip pull back so the whole globe is in view mid-flight, then come back in:
      // you see where you were, where you are going, and what lies between
      rv.e = rv.t * rv.t * (3 - 2 * rv.t);
      this.zt = 0; this.zoom = Math.max(1, rv.z0 + (FLY_ZOOM - rv.z0) * rv.e - (Math.min(rv.z0, FLY_ZOOM) - rv.zmin) * Math.sin(Math.PI * rv.e));
      rv.at = rv.ip(rv.e); this.rot = this.aim(rv.at); this.target = null; again = true;
      if (rv.t >= 1) { rv.e = 1; rv.at = rv.target; this.zoom = FLY_ZOOM; if (rv.done) setTimeout(rv.done, 0); }
    } else if (this.target) {
      const d0 = (((this.target[0] - this.rot[0]) + 540) % 360) - 180, d1 = this.target[1] - this.rot[1];
      this.rot = [this.rot[0] + d0 * .12, this.rot[1] + d1 * .12, 0];
      if (Math.abs(d0) < .15 && Math.abs(d1) < .15) this.target = null; else again = true;
    } else if (this.spin && !this.ptrs.size) {
      // the idle spin on the start screen is decoration: draw it about 20 times a second so it doesn't cook the phone
      const now = performance.now();
      if (now - (this.lastSpin || 0) < 50) { this.kick(); return; }
      this.rot = [this.rot[0] + .4 * Math.min(3, (now - (this.lastSpin || now)) / 50 || 1), this.rot[1], 0]; this.lastSpin = now; again = true;
    }
    if (this.pin && !rv) { this.pulse += .06; again = true; }
    const moving = again || this.ptrs.size > 0;
    if (this.W && this.H && WORLD) this.draw(moving);
    if (again) this.kick();
    else if (moving) { clearTimeout(this.sharp); this.sharp = setTimeout(() => this.kick(), 120); }   // one crisp pass once things settle
  }
  // ---- public
  setPin(p) { this.pin = p; this.kick(); }
  clear() { this.pin = null; this.rev = null; this.kick(); }
  reveal(guess, target, label, ccn, done) {
    const sep = d3.geoDistance(guess, target) / RAD;
    this.pin = guess; this.target = null; this.zt = 0;
    const zmin = Math.max(1, Math.min(FLY_ZOOM, FLY_ZOOM * 24 / Math.max(1, sep)));
    this.rev = { guess, target, label, ccn, done, ip: d3.geoInterpolate(guess, target), at: guess, t: 0, e: 0, z0: this.zoom, zmin, t0: performance.now(), dur: Math.max(900, Math.min(7500, 1200 + sep * 50)) };
    this.kick();
  }
  showAnswer(guess, target, label, ccn) {
    this.pin = guess; this.zt = 0; this.zoom = FLY_ZOOM; this.target = null;
    this.rev = { guess, target, label, ccn, ip: d3.geoInterpolate(guess, target), at: target, t: 1, e: 1 };
    this.rot = this.aim(target); this.kick();
  }
  flyTo(p) { this.target = this.aim(p); this.kick(); }
  setZoom(z) { this.zt = 0; this.zoom = Math.max(1, Math.min(7, z)); this.kick(); }
  zoomTo(z) { this.zt = Math.max(1, Math.min(7, z)); this.kick(); }
  zoomBy(k) { this.setZoom(this.zoom * k); }
  // ---- input
  bind() {
    const cv = this.cv;
    cv.addEventListener("pointerdown", e => {
      if (this.rev && this.rev.t < 1) return;
      cv.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.ptrs.size === 1) this.gesture = { x: e.clientX, y: e.clientY, rot: [...this.rot], moved: false, t: performance.now(), multi: false };
      else if (this.ptrs.size === 2 && this.gesture) { this.gesture.multi = true; this.gesture.d0 = this.spread(); this.gesture.z0 = this.zoom; }
      this.target = null; this.zt = 0;
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
  // paint the terrain: for every pixel of the disc, work out which spot on Earth it shows and copy that spot's color
  raster(c, r, q) {
    const bw = Math.max(2, Math.round(this.W * q)), bh = Math.max(2, Math.round(this.H * q));
    if (this.buf.width !== bw || this.buf.height !== bh) { this.buf.width = bw; this.buf.height = bh; this.im = this.bctx.createImageData(bw, bh); this.im32 = new Uint32Array(this.im.data.buffer); }
    const out = this.im32, tx = TEX.px, tw = TEX.w, th = TEX.h, cx = c[0] * q, cy = c[1] * q, rad = r * q;
    const l0 = -this.rot[0] * RAD, p0 = -this.rot[1] * RAD, sp = Math.sin(p0), cp = Math.cos(p0);
    out.fill(0);
    const j0 = Math.max(0, Math.ceil(cy - rad)), j1 = Math.min(bh - 1, Math.floor(cy + rad));
    for (let j = j0; j <= j1; j++) {
      const y = (cy - j) / rad, xs = Math.sqrt(Math.max(0, 1 - y * y)) * rad;
      const i0 = Math.max(0, Math.ceil(cx - xs)), i1 = Math.min(bw - 1, Math.floor(cx + xs));
      let k = j * bw + i0;
      for (let i = i0; i <= i1; i++, k++) {
        const x = (i - cx) / rad, z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
        const lat = Math.asin(Math.max(-1, Math.min(1, z * sp + y * cp))), lon = l0 + Math.atan2(x, z * cp - y * sp);
        let u = lon / TAU + .5; u -= Math.floor(u);
        const v = Math.min(th - 1, (.5 - lat / Math.PI) * th | 0);
        out[k] = tx[v * tw + (u * tw | 0)];
      }
    }
    this.bctx.putImageData(this.im, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.buf, 0, 0, this.W, this.H);
  }
  draw(moving) {
    const { ctx, W, H, proj, path } = this, c = this.center, R = this.baseR, r = R * this.zoom, rv = this.rev;
    proj.scale(r).translate(c).rotate(this.rot);
    ctx.clearRect(0, 0, W, H);
    if (this.stand && this.zoom < 1.12) this.drawStand(c, R);
    if (TEX) this.raster(c, r, moving ? 1 : Math.min(2, this.dpr));
    else {
      ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = "#a9c2bd"; ctx.fill();
      ctx.beginPath(); for (const f of WORLD.countries) path(f); ctx.fillStyle = "#e0cfa8"; ctx.fill();
    }
    ctx.beginPath(); path(GRAT); ctx.strokeStyle = "#3d312218"; ctx.lineWidth = .6; ctx.stroke();
    ctx.lineJoin = "round";
    ctx.beginPath(); path(WORLD.borders); ctx.strokeStyle = "#3d3122a6"; ctx.lineWidth = this.zoom > 2 ? .9 : .7; ctx.stroke();
    if (rv && rv.ccn && rv.t >= 1) { const f = WORLD.byId.get(rv.ccn); if (f) { ctx.beginPath(); path(f); ctx.fillStyle = "#b23a2e2e"; ctx.fill(); ctx.strokeStyle = RED; ctx.lineWidth = 1.8; ctx.stroke(); } }
    ctx.beginPath(); path({ type: "Sphere" });
    const g = ctx.createRadialGradient(c[0] - r * .4, c[1] - r * .45, r * .2, c[0], c[1], r * 1.02);
    g.addColorStop(0, "rgba(255,250,235,.20)"); g.addColorStop(.6, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(40,30,15,.42)");
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#3d312299"; ctx.lineWidth = 1.2; ctx.stroke();
    if (rv) {
      const pts = []; for (let i = 0; i <= 64; i++) pts.push(rv.ip(i / 64 * rv.e));
      ctx.beginPath(); path({ type: "LineString", coordinates: pts });
      ctx.strokeStyle = RED; ctx.lineWidth = 2.4; ctx.setLineDash([7, 6]); ctx.lineCap = "round"; ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.pin) this.drawPin(this.pin, RED, false);
    if (rv && rv.t < 1) this.drawPlane(rv);
    if (rv && rv.t >= 1) this.drawPin(rv.target, GREEN, true, rv.label);
  }
  drawPlane(rv) {
    const a = this.proj(rv.at), b = this.proj(rv.ip(Math.min(1, rv.e + .02))), ctx = this.ctx;
    if (!a || !b) return;
    ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
    ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(3, 3); ctx.lineTo(-4, 13); ctx.lineTo(-8, 13); ctx.lineTo(-3, 3); ctx.lineTo(-11, 2.5); ctx.lineTo(-14, 7); ctx.lineTo(-16, 7); ctx.lineTo(-14.5, 0);
    ctx.lineTo(-16, -7); ctx.lineTo(-14, -7); ctx.lineTo(-11, -2.5); ctx.lineTo(-3, -3); ctx.lineTo(-8, -13); ctx.lineTo(-4, -13); ctx.lineTo(3, -3); ctx.closePath();
    ctx.fillStyle = NAVY; ctx.strokeStyle = "#f6eeda"; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke(); ctx.fill(); ctx.restore();
  }
  drawPin(p, color, isTarget, label) {
    if (!this.visible(p)) return;
    const { ctx, W } = this, [x, y] = this.proj(p);
    if (!isTarget && !this.rev) { const a = 10 + 5 * Math.sin(this.pulse); ctx.beginPath(); ctx.arc(x, y, a + 4, 0, 7); ctx.fillStyle = "#b23a2e38"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(x, y, isTarget ? 9 : 7, 0, 7); ctx.fillStyle = isTarget ? "#fff" : color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = isTarget ? color : "#f6eeda"; ctx.stroke();
    if (!isTarget) return;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fillStyle = color; ctx.fill();
    ctx.font = '600 14px "Iowan Old Style","Palatino Linotype",Georgia,serif';
    const w = ctx.measureText(label).width + 16, lx = Math.min(Math.max(x - w / 2, 6), W - w - 6), ly = y - 38 < 6 ? y + 16 : y - 38;
    ctx.fillStyle = "#f6eeda"; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(lx, ly, w, 24, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = NAVY; ctx.textBaseline = "middle"; ctx.fillText(label, lx + 8, ly + 12.5);
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
