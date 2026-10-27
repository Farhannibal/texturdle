// Maintains web/public/schedule.json: which puzzle is shown on which day.
//
//   npm run schedule          (also runs automatically as part of `npm run deploy`)
//
// Days that have happened, today and tomorrow are fixed, so the archive and anyone mid-game
// are never affected (tomorrow is kept as a margin for deploys near midnight UTC). Every later
// day is reshuffled on each run, together with newly approved puzzles, so batches mix across
// the whole future instead of queuing up in blocks. When the schedule runs out the game loops
// back to day 1's puzzle.

import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.join(ROOT, "web/public/schedule.json");
const LAUNCH = "2026-09-17"; // day 1 (UTC). Only used when the schedule is first created.
const FIRST = ["the-legend-of-zelda-the-wind-waker-link"]; // day 1 when first created
const SPREAD_DAYS = 10; // keep the same game at least this many days apart where possible
const SERIES_DAYS = 3; // and the same series (Zelda, Final Fantasy...) at least this many

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);
const overrides = readJson(path.join(ROOT, "data/overrides.json"), {});
const puzzles = new Map(readJson(path.join(ROOT, "web/public/puzzles/index.json"), []).map((p) => [p.id, p]));
const schedule = readJson(FILE, { launch: LAUNCH, days: [] });

const today = Math.floor((Date.now() - Date.parse(`${schedule.launch}T00:00:00Z`)) / 86_400_000) + 1;
const usable = (id) => overrides[id]?.status === "approved" && puzzles.has(id);

// Past days, today and tomorrow stay exactly as they are.
const fixedCount = Math.min(schedule.days.length, Math.max(0, today + 1));
const fixed = schedule.days.slice(0, fixedCount);
const fixedSet = new Set(fixed);

// Everything else that's approved goes back in the pot: future days plus new approvals.
const pool = [...new Set([...schedule.days.slice(fixedCount), ...puzzles.keys()])].filter((id) => usable(id) && !fixedSet.has(id));
for (let i = pool.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
if (!fixed.length) {
  for (const id of [...FIRST].reverse()) {
    const i = pool.indexOf(id);
    if (i >= 0) pool.unshift(...pool.splice(i, 1));
  }
}

// Lay out the future: prefer a puzzle whose game hasn't appeared in the last SPREAD_DAYS days,
// whose series hasn't in the last SERIES_DAYS, and whose platform differs from the previous
// day's; relax those one at a time if nothing fits.
const days = [...fixed];
const gameOf = (id) => puzzles.get(id)?.game;
const platformOf = (id) => puzzles.get(id)?.platform;
// Rough series key: the title before any colon, minus accents, numbers and Roman numerals
// ("The Legend of Zelda: Majora's Mask 3D" -> "the legend of zelda", "Final Fantasy VIII" ->
// "final fantasy"). Pokémon titles rarely use a colon, so they all count as one series.
const seriesOf = (id) => {
  const key = (gameOf(id) ?? "")
    .split(":")[0]
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(?:[ivx]+|\d+d?)\b/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key.startsWith("pokemon") ? "pokemon" : key;
};
while (pool.length) {
  const recent = new Set(days.slice(-SPREAD_DAYS).map(gameOf));
  const recentSeries = new Set(days.slice(-SERIES_DAYS).map(seriesOf));
  const lastPlatform = platformOf(days.at(-1));
  let i = pool.findIndex((id) => !recent.has(gameOf(id)) && !recentSeries.has(seriesOf(id)) && platformOf(id) !== lastPlatform);
  if (i < 0) i = pool.findIndex((id) => !recent.has(gameOf(id)) && !recentSeries.has(seriesOf(id)));
  if (i < 0) i = pool.findIndex((id) => !recent.has(gameOf(id)));
  if (i < 0) i = 0;
  days.push(...pool.splice(i, 1));
}

const added = days.filter((id) => !schedule.days.includes(id)).length;
const dropped = schedule.days.slice(fixedCount).filter((id) => !days.includes(id)).length;
fs.writeFileSync(FILE, JSON.stringify({ ...schedule, days }, null, 2) + "\n");

console.log(`Schedule: ${days.length} days from ${schedule.launch}; today is #${today}. Days 1-${fixedCount} fixed, ${days.length - fixedCount} reshuffled (${added} new, ${dropped} removed).`);
const left = days.length - today;
console.log(left >= 0 ? `${left} day(s) of new puzzles left after today.` : `Queue ran out ${-left} day(s) ago; the game is looping.`);
const missing = fixed.filter((id) => !usable(id));
if (missing.length) console.warn(`Warning: fixed days whose puzzle is no longer approved or built (a stand-in is shown): ${missing.join(", ")}`);
