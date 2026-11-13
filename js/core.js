// Daily trip selection, scoring, saved progress, and the group-score backend adapter.
/* global d3 */
import { PLACES } from "./data.js";
import { PHOTOS } from "./photos.js";

export const LAUNCH = new Date(2026, 10, 13); // Trip #1, local time
// Navigator: harder stops are worth more, and the total is always 1,000. Six stops since the picture stop arrived.
const W5 = [1, 1, 2, 3, 3], W6 = [1, 1, 2, 2, 3, 1];
const weightsFor = n => n >= 6 ? W6 : W5;
export const STAMP_AT = 70;
const KEY = "pcd.v1";

// ---------- dates ----------
export const midnight = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const dayIndex = (d = new Date()) => Math.round((midnight(d) - LAUNCH) / 864e5);
export const dayDate = i => new Date(LAUNCH.getFullYear(), LAUNCH.getMonth(), LAUNCH.getDate() + i);
export const fmtLong = d => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
export const fmtShort = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ---------- daily trip: same five stops for everyone, no repeats inside a 16-day cycle ----------
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffled(arr, seed) { const a = [...arr], r = rng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const TIERS = [1, 2, 3].map(t => PLACES.filter(p => p.tier === t).sort((a, b) => a.id < b.id ? -1 : 1));
// The picture stop: a photo with no name. Starts with Trip #2; Trip #1 was played as five stops and stays that way.
export const PIC_FROM = 1;
const PICS = PLACES.filter(p => PHOTOS[p.id] && PHOTOS[p.id].lon !== undefined).sort((a, b) => a.id < b.id ? -1 : 1);
function picItem(place) {
  const ph = PHOTOS[place.id];
  return { ...place, id: "pic-" + place.id, photo: place.id, kind: "picture", q: "Where in the world is this?", name: ph.article, sub: place.country, lon: ph.lon, lat: ph.lat, hint: "It is in " + place.continent + "." };
}
function pictureFor(seedDay, avoid) {
  const order = shuffled(PICS, 4441 + Math.floor(seedDay / PICS.length) * 13);
  for (let k = 0; k < order.length; k++) { const c = order[(seedDay + k) % order.length]; if (!avoid.includes(c.id)) return picItem(c); }
  return picItem(order[0]);
}
export function tripFor(day) {
  const d = Math.max(0, day), per = Math.floor(TIERS[1].length) || 1, cycle = Math.floor(d / per), k = d % per;
  const [e, m, h] = TIERS.map((t, i) => shuffled(t, 9173 + cycle * 31 + i * 7));
  const five = [e[(2 * k) % e.length], e[(2 * k + 1) % e.length], m[k % m.length], h[(2 * k) % h.length], h[(2 * k + 1) % h.length]];
  return d >= PIC_FROM ? [...five, pictureFor(d, five.map(p => p.id))] : five;
}
export function bonusTrip(avoid = []) {
  const s = Date.now() & 0xffff, [e, m, h] = TIERS.map((t, i) => shuffled(t.filter(p => !avoid.includes(p.id)), s + i));
  const five = [e[0], e[1], m[0], h[0], h[1]];
  return [...five, pictureFor(s, [...avoid, ...five.map(p => p.id)])];
}

// Every target is a single spot. Only a pin within a few miles scores a perfect 100; after that the points fall away with distance.
export function scoreGuess(place, guess, mode, world) {
  const km = d3.geoDistance(guess, [place.lon, place.lat]) * 6371, kid = mode === "explorer";
  const grace = kid ? 60 : 20, fall = kid ? 2600 : 1500;
  const score = km <= grace ? 100 : Math.min(99, Math.max(0, Math.round(100 * Math.exp(-(km - grace) / fall))));
  return { km: Math.round(km), score, inside: km <= grace, where: whereIs(guess, world) };
}
export function whereIs(p, world) {
  const f = world.countries.find(c => d3.geoContains(c, p));
  return f ? f.properties.name : "";
}
export const weight = (i, mode, n) => mode === "navigator" ? weightsFor(n)[i] : 1;
export const maxTotal = (mode, n) => weightsFor(n).reduce((a, _, i) => a + 100 * weight(i, mode, n), 0);
export const totalOf = (results, mode, n) => results.reduce((a, r, i) => a + (r ? r.score * weight(i, mode, n) : 0), 0);
export const milesText = r => r.inside ? "Right on it" : Math.round(r.km * .621).toLocaleString() + " miles away";

// ---------- saved progress (this phone only) ----------
const blank = () => ({ name: "", mode: "navigator", groups: [], days: {}, stamps: {}, seenHow: false });
export function load() { try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return blank(); } }
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: play still works, nothing is kept */ } }
export function streak(s, today = dayIndex()) {
  let n = 0, d = s.days[today]?.done ? today : today - 1;
  while (s.days[d]?.done) { n++; d--; }
  return n;
}
export function awardStamps(s, day, trip, results) {
  trip.forEach((p, i) => {
    if (!results[i] || results[i].score < STAMP_AT) return;
    const st = s.stamps[p.iso3] || (s.stamps[p.iso3] = { first: day, count: 0, flag: p.flag, country: p.country, continent: p.continent });
    st.count++;
  });
}

// ---------- group scores ----------
// Until window.PCD_CONFIG has a backend, groups work on this phone only (you see your own score).
const cfg = () => window.PCD_CONFIG || {};
export const backendOn = () => !!(cfg().url && cfg().key);
const hdr = () => ({ apikey: cfg().key, Authorization: "Bearer " + cfg().key, "Content-Type": "application/json" });
export async function submitScore(row) {
  if (!backendOn()) return false;
  try {
    const r = await fetch(cfg().url + "/rest/v1/pcd_scores?on_conflict=day,grp,name,mode", { method: "POST", headers: { ...hdr(), Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) });
    return r.ok;
  } catch { return false; }
}
export async function board(day, grp) {
  if (!backendOn()) return null;
  try {
    const r = await fetch(`${cfg().url}/rest/v1/pcd_scores?day=eq.${day}&grp=eq.${encodeURIComponent(grp)}&select=name,mode,score,stamps&order=score.desc&limit=200`, { headers: hdr() });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
export const cleanCode = v => (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
export const cleanName = v => (v || "").replace(/[<>]/g, "").trim().slice(0, 16);
