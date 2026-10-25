// Runs after `vite build`, before upload: keeps only approved puzzles in dist/, so models
// that are built but not yet reviewed (or rejected) never reach the live site.
// Approval lives in data/overrides.json as "status": "approved" (set on /review.html).

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist/puzzles");
const overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/overrides.json"), "utf8"));
const approved = new Set(Object.keys(overrides).filter((id) => overrides[id].status === "approved"));

const indexFile = path.join(DIST, "index.json");
const all = JSON.parse(fs.readFileSync(indexFile, "utf8"));
const live = all.filter((p) => approved.has(p.id));
fs.writeFileSync(indexFile, JSON.stringify(live, null, 2));

const held = [];
for (const entry of fs.readdirSync(DIST, { withFileTypes: true })) {
  if (entry.isDirectory() && !approved.has(entry.name)) {
    fs.rmSync(path.join(DIST, entry.name), { recursive: true, force: true });
    held.push(entry.name);
  }
}

console.log(`Publishing ${live.length} approved puzzles.`);
if (held.length) console.log(`Held back ${held.length} not yet approved: ${held.join(", ")}`);
if (!live.length) {
  console.error("No approved puzzles: approve some on /review.html before deploying.");
  process.exit(1);
}
