// Daily trip selection, scoring, saved progress, and the group-score backend adapter.
/* global d3 */
import { PLACES } from "./data.js";

export const LAUNCH = new Date(2026, 10, 13); // Trip #1, local time
export const WEIGHTS = [1, 1, 2, 3, 3];       // Navigator: harder stops are worth more (max 1,000)
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
export function tripFor(day) {
  const d = Math.max(0, day), per = Math.floor(TIERS[1].length) || 1, cycle = Math.floor(d / per), k = d % per;
  const [e, m, h] = TIERS.map((t, i) => shuffled(t, 9173 + cycle * 31 + i * 7));
  return [e[(2 * k) % e.length], e[(2 * k + 1) % e.length], m[k % m.length], h[(2 * k) % h.length], h[(2 * k + 1) % h.length]];
}
export function practiceTrip() {
  const s = Date.now() & 0xffff, [e, m, h] = TIERS.map((t, i) => shuffled(t, s + i));
  return [e[0], e[1], m[0], h[0], h[1]];
}

// ---------- scoring ----------
function params(place, mode, world) {
  const kid = mode === "explorer", fall = kid ? 3200 : 2000;
  const f = place.kind === "country" ? world.byId.get(place.ccn) : null;
  // grace: a country counts as "found" a little past its middle; a city or landmark within a short drive
  let grace = kid ? 220 : 110;
  if (place.kind === "country") grace = Math.max(kid ? 320 : 220, f ? Math.sqrt(d3.geoArea(f) * 6371 * 6371) * .3 : 0);
  return { f, fall, grace };
}
export function scoreGuess(place, guess, mode, world) {
  const km = d3.geoDistance(guess, [place.lon, place.lat]) * 6371, { f, fall, grace } = params(place, mode, world);
  const inside = !!(f && d3.geoContains(f, guess));
  const score = inside || km <= grace ? 100 : Math.max(0, Math.round(100 * Math.exp(-(km - grace) / fall)));
  return { km: Math.round(km), score, inside: inside || km <= grace, where: whereIs(guess, world) };
}
// the distance at which a guess is worth 75, 50 and 25 points: drawn as rings around the answer
export function rings(place, mode, world) {
  const { fall, grace } = params(place, mode, world);
  return [75, 50, 25].map(s => ({ km: grace + fall * Math.log(100 / s), label: s + " pts" }));
}
export function whereIs(p, world) {
  const f = world.countries.find(c => d3.geoContains(c, p));
  return f ? f.properties.name : "";
}
const REFS = [[205, "New York to Washington, D.C."], [355, "Minneapolis to Chicago"], [715, "New York to Chicago"], [1090, "New York to Miami"], [1525, "Minneapolis to Los Angeles"], [2450, "New York to Los Angeles"], [3460, "New York to London"], [4960, "New York to Honolulu"], [6740, "New York to Tokyo"]];
export function compare(km) {
  const mi = km * .621; if (mi < 170) return "";
  const near = REFS.reduce((a, b) => Math.abs(Math.log(b[0] / mi)) < Math.abs(Math.log(a[0] / mi)) ? b : a);
  if (Math.abs(near[0] / mi - 1) <= .15) return `That is about as far as ${near[1]}.`;
  const under = REFS.filter(r => r[0] < mi).pop();
  return under ? `That is farther than ${under[1]}.` : "";
}
export const weight = (i, mode) => mode === "navigator" ? WEIGHTS[i] : 1;
export const maxTotal = mode => WEIGHTS.reduce((a, _, i) => a + 100 * weight(i, mode), 0);
export const totalOf = (results, mode) => results.reduce((a, r, i) => a + (r ? r.score * weight(i, mode) : 0), 0);
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
