// Maintains web/public/schedule.json: which puzzle is shown on which day. It is append-only:
// days already scheduled never change, so the archive and today's puzzle stay put when new
// models are added. Newly approved puzzles join the end of the queue.
//
//   npm run schedule          (also runs automatically as part of `npm run deploy`)
//
// When the queue runs out the game loops back to day 1's puzzle.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.join(ROOT, "web/public/schedule.json");
const LAUNCH = "2026-09-17"; // day 1 (UTC). Only used when the schedule is first created.
const FIRST = ["the-legend-of-zelda-the-wind-waker-link"]; // pinned to day 1 onward
const SPREAD_DAYS = 10; // try not to repeat a game within this many days

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);
const overrides = readJson(path.join(ROOT, "data/overrides.json"), {});
const puzzles = new Map(readJson(path.join(ROOT, "web/public/puzzles/index.json"), []).map((p) => [p.id, p]));
const schedule = readJson(FILE, { launch: LAUNCH, days: [] });

// Only approved puzzles that are actually built can be scheduled.
const approved = [...puzzles.keys()].filter((id) => overrides[id]?.status === "approved");
const scheduled = new Set(schedule.days);
const missing = schedule.days.filter((id) => overrides[id]?.status !== "approved" || !puzzles.has(id));

// Fixed shuffle (by id hash) so reruns are reproducible, then pinned puzzles first.
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
const pool = approved.filter((id) => !scheduled.has(id)).sort((a, b) => hash(a) - hash(b));
for (const id of [...FIRST].reverse()) {
  const i = pool.indexOf(id);
  if (i >= 0 && schedule.days.length === 0) pool.unshift(...pool.splice(i, 1));
}

// Append, picking the next puzzle whose game hasn't appeared in the last SPREAD_DAYS days.
const added = [];
while (pool.length) {
  const recent = new Set(schedule.days.slice(-SPREAD_DAYS).map((id) => puzzles.get(id)?.game));
  const i = Math.max(0, pool.findIndex((id) => !recent.has(puzzles.get(id).game)));
  const [id] = pool.splice(i, 1);
  schedule.days.push(id);
  added.push(id);
}

fs.writeFileSync(FILE, JSON.stringify(schedule, null, 2) + "\n");

const today = Math.floor((Date.now() - Date.parse(`${schedule.launch}T00:00:00Z`)) / 86_400_000) + 1;
const left = schedule.days.length - today;
console.log(`Schedule: ${schedule.days.length} days from ${schedule.launch}; today is #${today}. Added ${added.length}.`);
console.log(left >= 0 ? `${left} day(s) of new puzzles left after today.` : `Queue ran out ${-left} day(s) ago; the game is looping.`);
if (missing.length) console.warn(`Warning: scheduled but not approved or not built (those days fall back to a stand-in): ${missing.join(", ")}`);
