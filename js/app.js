import { Globe, loadWorld, FLY_ZOOM } from "./globe.js";
import * as C from "./core.js";
/* global d3 */

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const INKS = ["#b23a2e", "#1f4f8a", "#2f6b4f", "#7a3f8f", "#b06a12"], ROTS = [-8, 5, -4, 7, -6];
const MODE_NAME = { explorer: "Explorer", navigator: "Navigator" };

let S = C.load(), world = null, globe = null, homeGlobe = null, G = null;
const today = () => C.dayIndex();

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); }
function go(screen) {
  document.body.dataset.screen = screen;
  if (homeGlobe) { homeGlobe.spin = screen === "home"; homeGlobe.resize(); }
  if (screen === "home") renderHome();
  if (screen === "passport") renderPassport();
  if (screen === "groups") renderGroups();
  if (screen === "game" && globe) globe.resize();
}

// ================= HOME =================
function renderHome() {
  const d = today(), day = S.days[d], started = !!(day && day.results.length);
  $("#homeDate").textContent = `Trip #${d + 1} · ${C.fmtLong(new Date())}`;
  const mode = day?.mode || S.mode;
  document.querySelectorAll(".modepick button").forEach(b => { b.setAttribute("aria-pressed", b.dataset.mode === mode); b.disabled = started && b.dataset.mode !== mode; });
  $("#playBtn").textContent = day?.done ? "See today's passport page" : started ? `Keep going · stop ${day.results.length + 1} of 5` : "Start today's trip";
  $("#stStreak").textContent = C.streak(S, d);
  $("#stCountries").textContent = Object.keys(S.stamps).length;
  const best = Object.values(S.days).filter(x => x.done).map(x => Math.round(100 * C.totalOf(x.results, x.mode) / C.maxTotal(x.mode)));
  $("#stBest").textContent = best.length ? Math.max(...best) + "%" : "–";
}

// ================= GAME =================
function startTrip(practice = false) {
  const d = today(), day = S.days[d];
  if (!practice && day?.done) { showEnd(); return; }
  G = practice
    ? { practice: true, day: d, trip: C.practiceTrip(), results: [], mode: S.mode }
    : { practice: false, day: d, trip: C.tripFor(d), results: day ? day.results : [], mode: day?.mode || S.mode };
  G.idx = G.results.length; G.revealed = false; G.pending = null; G.review = false;
  go("game"); renderStop();
}
function renderStop() {
  const p = G.trip[G.idx], w = C.weight(G.idx, G.mode);
  $("#gMode").textContent = MODE_NAME[G.mode];
  $("#gTrip").textContent = G.review ? "Looking back" : G.practice ? "Practice trip" : `Trip #${G.day + 1}`;
  $("#gKind").innerHTML = esc(KIND[p.kind]) + (w > 1 ? ` <span class="mult">×${w} points</span>` : "");
  $("#gQ").textContent = p.q;
  $("#gHint").textContent = G.mode === "explorer" ? "Hint: " + p.hint : "";
  $("#gStop").textContent = `${G.idx + 1}/5`;
  $("#sheet").hidden = true; $("#sheet").classList.remove("open");
  $("#lockbar").hidden = true; $("#gTip").hidden = G.review;
  G.revealed = false; G.pending = null;
  globe.liftOn = false; globe.clear(); globe.setZoom(1);
  renderStrip();
  if (G.review) revealStop(false);
}
const KIND = { country: "Find the country", capital: "Find the capital", landmark: "Find the landmark", nature: "Find the place" };
function renderStrip() {
  $("#gStamps").innerHTML = G.trip.map((p, i) => {
    const r = G.results[i];
    if (!r) return `<div class="slot ${i === G.idx ? "now" : ""}">${i + 1}</div>`;
    const ok = r.score >= C.STAMP_AT;
    return `<div class="stampd ${ok ? "" : "miss"}" style="--c:${INKS[i]};--rot:${ROTS[i]}deg" title="${esc(p.country)}">${p.flag}</div>`;
  }).join("");
  $("#gTotal").textContent = C.totalOf(G.results, G.mode);
  $("#gMax").textContent = "/ " + C.maxTotal(G.mode);
  const n = G.results.filter(r => r && r.score >= C.STAMP_AT).length;
  $("#gNote").innerHTML = `${n} stamp${n === 1 ? "" : "s"}<br>today`;
}
function onTap(p) {
  if (!G || G.revealed || G.review) return;
  G.pending = p; globe.setPin(p);
  // glide in on the pin so you can see exactly where it landed before you lock it
  globe.flyTo(p); if (globe.zoom < FLY_ZOOM) globe.zoomTo(FLY_ZOOM);
  $("#lockbar").hidden = false; $("#gTip").hidden = true;
}
function lock() {
  if (!G.pending || G.revealed) return;
  const p = G.trip[G.idx], r = C.scoreGuess(p, G.pending, G.mode, world);
  r.g = [+G.pending[0].toFixed(2), +G.pending[1].toFixed(2)];
  G.results[G.idx] = r;
  if (!G.practice) { S.days[G.day] = { mode: G.mode, results: G.results, done: false }; C.save(S); }
  revealStop(true);
}
function revealStop(animate) {
  const p = G.trip[G.idx], r = G.results[G.idx], tgt = [p.lon, p.lat];
  G.revealed = true; $("#lockbar").hidden = true; $("#gTip").hidden = true;
  if (r.where === undefined) r.where = C.whereIs(r.g, world);
  globe.liftOn = true;
  // The answer is shown as a flight from the pin to the real spot, always at the same scale.
  // A near miss is a short hop that stays on screen; a far one is a long trip that leaves the pin behind.
  if (animate) globe.reveal(r.g, tgt, p.name, p.ccn, () => { renderStrip(); renderSheet(); });
  else { globe.showAnswer(r.g, tgt, p.name, p.ccn); renderSheet(); }
  renderStrip();
}
function renderSheet() {
  const p = G.trip[G.idx], r = G.results[G.idx], w = C.weight(G.idx, G.mode), box = $("#sheet"), open = box.classList.contains("open");
  const last = G.idx >= 4;
  box.innerHTML = `
    <div class="place"><div class="flag">${p.flag}</div>
      <div><b>${esc(p.name)}</b><span>${esc(p.sub)} · ${C.milesText(r)}</span></div>
      <div class="score ${r.score < 50 ? "low" : ""}">${r.score}<small>${w > 1 ? `×${w} = ${r.score * w}` : "OF 100"}</small></div></div>
    ${r.inside ? "" : `<p class="landed">Your pin landed ${r.where ? "in " + esc(r.where) : "in open water"}.</p>`}
    <p class="wow">${esc(p.wow)}</p>
    <div class="morebox">
      <ul class="facts">${p.fast.map(f => `<li><span>${esc(f[0])}</span><div>${esc(f[1])}</div></li>`).join("")}</ul>
      ${p.more.map(m => `<p class="extra">${esc(m)}</p>`).join("")}
    </div>
    <div class="btns"><button class="btn" id="moreBtn">${open ? "Show the globe" : "Tell me more"}</button>
      <button class="btn primary" id="nextBtn">${last ? (G.review ? "Done" : "My passport page") : "Next stop"}</button></div>`;
  box.hidden = false;
  $("#moreBtn").onclick = () => { box.classList.toggle("open"); renderSheet(); };
  $("#nextBtn").onclick = nextStop;
}
function nextStop() {
  if (G.idx >= 4) { finish(); return; }
  G.idx++; renderStop();
}
function finish() {
  if (G.review) { showEnd(); return; }
  if (!G.practice) {
    const day = S.days[G.day];
    if (!day.done) { day.done = true; C.awardStamps(S, G.day, G.trip, G.results); C.save(S); submitAll(); }
  }
  showEnd();
}

// ================= END / SHARE =================
function endData() {
  if (G && G.practice && G.results.length === 5) return { practice: true, day: G.day, mode: G.mode, results: G.results, trip: G.trip };
  const d = today(), day = S.days[d];
  return day?.done ? { practice: false, day: d, mode: day.mode, results: day.results, trip: C.tripFor(d) } : null;
}
function showEnd() {
  const E = endData(); if (!E) { go("home"); return; }
  go("end");
  const cv = drawCard(E); $("#cardImg").src = cv.toDataURL("image/png"); showEnd.cv = cv; showEnd.E = E;
  const ms = C.midnight(new Date(Date.now() + 864e5)) - Date.now(), h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  $("#nextTrip").textContent = E.practice ? "Practice trips don't count toward your passport" : `Next trip in ${h} h ${m} min`;
  $("#reviewBtn").hidden = false;
  renderEndBoards(E);
}
function shareText(E) {
  const tot = C.totalOf(E.results, E.mode), n = E.results.filter(r => r.score >= C.STAMP_AT).length, st = C.streak(S);
  const dots = E.results.map(r => (r.score === 100 ? "⭐" : r.score >= C.STAMP_AT ? "🟢" : r.score >= 40 ? "🟡" : "🔴") + r.score).join(" ");
  return `Passport Club Daily #${E.day + 1} · ${MODE_NAME[E.mode]}\n${dots}\n${tot}/${C.maxTotal(E.mode)} · ${n} stamp${n === 1 ? "" : "s"}${st > 1 ? ` · 🔥${st}` : ""}\n${location.origin + location.pathname}`;
}
async function share() {
  const E = showEnd.E, text = shareText(E);
  try {
    const blob = await new Promise(r => showEnd.cv.toBlob(r, "image/png"));
    const file = new File([blob], `passport-club-trip-${E.day + 1}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  copyText();
}
async function copyText() {
  try { await navigator.clipboard.writeText(shareText(showEnd.E)); toast("Copied. Paste it in your group chat."); }
  catch { toast("Couldn't copy on this device."); }
}
// The card never names the places, so it can't spoil the trip for someone who hasn't played yet.
function drawCard(E) {
  const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const x = cv.getContext("2d"), INK = "#1f2f4a", RED = "#b23a2e", MUTED = "#7a6a52";
  const serif = '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif', mono = '"Courier New",Courier,monospace';
  x.fillStyle = "#f6eeda"; x.fillRect(0, 0, W, H);
  x.strokeStyle = "#1f2f4a14"; x.lineWidth = 2; for (let y = 330; y < H - 80; y += 56) { x.beginPath(); x.moveTo(70, y); x.lineTo(W - 70, y); x.stroke(); }
  x.strokeStyle = INK; x.lineWidth = 6; x.strokeRect(34, 34, W - 68, H - 68); x.lineWidth = 2; x.strokeRect(50, 50, W - 100, H - 100);
  // seal
  const sx = 170, sy = 185; x.lineWidth = 6; x.beginPath(); x.arc(sx, sy, 84, 0, 7); x.stroke(); x.lineWidth = 2; x.beginPath(); x.arc(sx, sy, 72, 0, 7); x.stroke();
  x.fillStyle = INK; x.beginPath(); x.arc(sx, sy, 44, 0, 7); x.fill();
  x.strokeStyle = "#f6eeda"; x.lineWidth = 3; x.beginPath(); x.moveTo(sx - 40, sy); x.lineTo(sx + 40, sy); x.moveTo(sx - 33, sy - 20); x.lineTo(sx + 33, sy - 20); x.moveTo(sx - 33, sy + 20); x.lineTo(sx + 33, sy + 20); x.stroke();
  x.beginPath(); x.ellipse(sx, sy, 20, 43, 0, 0, 7); x.stroke();
  x.fillStyle = INK; x.textBaseline = "alphabetic";
  x.font = `700 68px ${serif}`; x.fillText("Passport Club Daily", 290, 180);
  x.font = `700 30px ${mono}`; x.fillStyle = MUTED;
  x.fillText(`${E.practice ? "PRACTICE TRIP" : "TRIP #" + (E.day + 1)} · ${C.fmtShort(C.dayDate(E.day)).toUpperCase()} · ${MODE_NAME[E.mode].toUpperCase()}`, 292, 232);
  if (S.name) { x.font = `italic 40px ${serif}`; x.fillStyle = INK; x.fillText(`${S.name}'s passport page`, 80, 370); }
  // stamps
  E.results.forEach((r, i) => {
    const cx = 172 + i * 184, cy = S.name ? 560 : 500, ok = r.score >= C.STAMP_AT, col = ok ? INKS[i] : "#9b8f7c";
    x.save(); x.translate(cx, cy); x.rotate(ROTS[i] * Math.PI / 180);
    x.strokeStyle = col; x.fillStyle = col;
    if (ok) { x.lineWidth = 7; x.beginPath(); x.arc(0, 0, 80, 0, 7); x.stroke(); x.lineWidth = 2.5; x.beginPath(); x.arc(0, 0, 68, 0, 7); x.stroke(); }
    else { x.lineWidth = 4; x.setLineDash([12, 10]); x.beginPath(); x.arc(0, 0, 78, 0, 7); x.stroke(); x.setLineDash([]); }
    x.textAlign = "center"; x.font = `700 58px ${serif}`; x.fillText(r.score, 0, 12);
    x.font = `700 20px ${mono}`; x.fillText(ok ? (r.score === 100 ? "PERFECT" : "STAMPED") : "NO STAMP", 0, 44);
    x.font = `700 18px ${mono}`; x.fillText("STOP " + (i + 1) + (C.weight(i, E.mode) > 1 ? " ×" + C.weight(i, E.mode) : ""), 0, -34);
    x.restore();
  });
  // total
  const tot = C.totalOf(E.results, E.mode), n = E.results.filter(r => r.score >= C.STAMP_AT).length, st = C.streak(S);
  x.textAlign = "left"; x.fillStyle = INK; x.font = `700 230px ${serif}`; x.fillText(tot, 76, 900);
  const tw = x.measureText(String(tot)).width; x.font = `700 64px ${serif}`; x.fillStyle = MUTED; x.fillText("/ " + C.maxTotal(E.mode), 100 + tw, 900);
  x.fillStyle = INK; x.font = `44px ${serif}`;
  const bits = [`${n} of 5 stamps`]; if (st > 1) bits.push(`${st}-day streak`);
  x.fillText(bits.join("  ·  "), 82, 990);
  x.fillText(`${Object.keys(S.stamps).length} countries in my passport`, 82, 1052);
  x.fillStyle = RED; x.font = `700 32px ${mono}`; x.fillText("FIVE STOPS AROUND THE WORLD, EVERY DAY", 82, 1180);
  x.fillStyle = INK; x.font = `700 34px ${mono}`; x.fillText((location.host + location.pathname).replace(/\/(index\.html)?$/, "").toUpperCase(), 82, 1232);
  return cv;
}

// ================= GROUPS =================
function myRow(E, grp) {
  return { day: E.day, grp, name: S.name, mode: E.mode, score: C.totalOf(E.results, E.mode), stamps: E.results.filter(r => r.score >= C.STAMP_AT).length, detail: E.results.map(r => r.score) };
}
function submitAll() {
  const E = endData(); if (!E || E.practice || !S.name) return;
  S.groups.forEach(g => C.submitScore(myRow(E, g)));
}
async function boardHTML(grp, E, withLeave) {
  let rows = await C.board(today(), grp);
  const mine = E && !E.practice && S.name ? myRow(E, grp) : null;
  if (!rows) rows = mine ? [mine] : [];
  else if (mine && !rows.some(r => r.name === mine.name && r.mode === mine.mode)) rows.push(mine);
  const by = m => rows.filter(r => r.mode === m).sort((a, b) => b.score - a.score);
  const list = m => { const rs = by(m); return rs.length ? `<div class="tag">${MODE_NAME[m]} · out of ${C.maxTotal(m)}</div><ol>${rs.map((r, i) => `<li class="${S.name && r.name === S.name ? "me" : ""}"><span class="n">${i + 1}</span>${esc(r.name)}<b>${r.score}</b></li>`).join("")}</ol>` : ""; };
  const body = list("navigator") + list("explorer") || `<p class="fine">Nobody has finished today's trip yet.</p>`;
  return `<div class="card board" style="margin-top:10px"><div class="hd"><h3>${esc(grp)} · today</h3>${withLeave ? `<button class="x" data-leave="${esc(grp)}">leave</button>` : ""}</div>${body}</div>`;
}
async function renderEndBoards(E) {
  const box = $("#endBoards");
  if (E.practice) { box.innerHTML = ""; return; }
  if (!S.groups.length) { box.innerHTML = `<div class="card" style="text-align:center"><p class="fine" style="margin:0 0 10px">Play with your family or your class and see each other's scores.</p><button class="btn" data-go="groups" style="width:100%">Set up a group</button></div>`; return; }
  box.innerHTML = (await Promise.all(S.groups.map(g => boardHTML(g, E, false)))).join("");
}
async function renderGroups() {
  $("#nameIn").value = S.name; $("#grpOffline").hidden = C.backendOn();
  const E = endData();
  $("#grpList").innerHTML = S.groups.length ? (await Promise.all(S.groups.map(g => boardHTML(g, E, true)))).join("") : "";
}
function joinGroup() {
  const name = C.cleanName($("#nameIn").value), code = C.cleanCode($("#codeIn").value);
  if (!name) { toast("Add your first name first."); $("#nameIn").focus(); return; }
  if (code.length < 3) { toast("A group code needs at least 3 letters."); return; }
  S.name = name; if (!S.groups.includes(code)) S.groups.push(code); C.save(S);
  $("#codeIn").value = ""; submitAll(); renderGroups(); toast(`You're in ${code}.`);
}

// ================= PASSPORT =================
function renderPassport() {
  const st = Object.entries(S.stamps), trips = Object.values(S.days).filter(d => d.done).length;
  $("#ppName").textContent = S.name ? `${S.name}'s passport` : "My passport";
  $("#ppLine").textContent = `${st.length} countr${st.length === 1 ? "y" : "ies"} · ${trips} trip${trips === 1 ? "" : "s"} · ${C.streak(S)}-day streak`;
  if (!st.length) { $("#ppBody").innerHTML = `<div class="pp-sec pp-empty">No stamps yet.<br>Score 70 or better at a stop and that country stamps your passport for good.</div>`; return; }
  const order = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"];
  $("#ppBody").innerHTML = order.map(c => {
    const list = st.filter(([, v]) => v.continent === c).sort((a, b) => a[1].first - b[1].first);
    if (!list.length) return "";
    return `<div class="pp-sec"><h3>${c} · ${list.length}</h3><div class="pp-grid">${list.map(([iso, v], i) =>
      `<div class="pp-stamp" style="--c:${INKS[(i + c.length) % 5]};--rot:${ROTS[(i * 2 + c.length) % 5]}deg" title="${esc(v.country)}"><div><i>${v.flag}</i><b>${iso}</b><small>${C.fmtShort(C.dayDate(v.first)).toUpperCase()}</small></div></div>`).join("")}</div></div>`;
  }).join("");
}

// ================= WIRING =================
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) { go(g.dataset.go); return; }
  const l = e.target.closest("[data-leave]"); if (l) { S.groups = S.groups.filter(x => x !== l.dataset.leave); C.save(S); renderGroups(); }
});
document.querySelectorAll(".modepick button").forEach(b => b.onclick = () => { if (b.disabled) return; S.mode = b.dataset.mode; C.save(S); renderHome(); });
$("#playBtn").onclick = () => startTrip(false);
$("#lockBtn").onclick = lock;
$("#zin").onclick = () => globe.zoomBy(1.6);
$("#zout").onclick = () => globe.zoomBy(1 / 1.6);
$("#shareBtn").onclick = share;
$("#copyBtn").onclick = copyText;
$("#reviewBtn").onclick = () => { const E = showEnd.E; G = { practice: E.practice, day: E.day, trip: E.trip, results: E.results, mode: E.mode, idx: 0, review: true }; go("game"); renderStop(); };
$("#joinBtn").onclick = joinGroup;
$("#nameIn").onchange = e => { S.name = C.cleanName(e.target.value); C.save(S); };
$("#codeIn").oninput = e => { e.target.value = C.cleanCode(e.target.value); };
$("#howBtn").onclick = () => $("#how").showModal();
$("#howClose").onclick = () => { $("#how").close(); S.seenHow = true; C.save(S); };

(async function boot() {
  renderHome();
  world = await loadWorld();
  globe = new Globe($("#globe"), { onTap });
  homeGlobe = new Globe($("#homeGlobe"), { interactive: false, spin: true });
  window.__pcd = { ready: true, get G() { return G; }, get S() { return S; }, globe, onTap, lock, nextStop, C };
  if (!S.seenHow) $("#how").showModal();
})();
