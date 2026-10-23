// Turns every zip in data/modelzipped into a playable puzzle under web/public/puzzles.
//
//   npm run puzzles                 build every zip
//   npm run puzzles -- sonic        only zips whose slug contains "sonic"
//
// Zip names follow the Models Resource download pattern:
//   "<Platform> - <Game> - <Category> - <Model>.zip"
// Per-puzzle fixes go in data/overrides.json, keyed by slug:
//   { "<slug>": { "model": "path/inside/zip.dae", "excludeTextures": ["eye"] } }

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const ZIPS = path.join(ROOT, "data/modelzipped");
const RAW = path.join(ROOT, "data/raw");
const OUT = path.join(ROOT, "web/public/puzzles");
const BLENDER = process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 4.3/blender.exe";
const MODEL_EXTS = [".dae", ".obj", ".fbx", ".glb", ".gltf"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".tga", ".bmp"];

// Hint 1 shows ~25% of the texture pixels, hint 2 ~75% (always including hint 1's area).
const GRID = 6;
const REVEAL = [0.25, 0.75];
const MIN_TILE = 96; // tiny textures are scaled up by whole multiples so they stay readable
const PAD = 4;

const overrides = readJson(path.join(ROOT, "data/overrides.json"), {});
const filter = process.argv[2]?.toLowerCase();

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function parseZipName(file) {
  const parts = path.basename(file, ".zip").split(" - ");
  if (parts.length < 4) throw new Error(`Expected "Platform - Game - Category - Model.zip", got "${file}"`);
  const [platform, game, category, ...rest] = parts;
  // Windows can't store ":" in filenames, so downloads use "_ " instead.
  const clean = (s) => s.replace(/_ /g, ": ").trim();
  const name = clean(rest.join(" - "));
  return { platform: clean(platform), game: clean(game), category: clean(category), name };
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

// Small deterministic RNG so a puzzle's mask never changes between builds.
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 3432918353), (h = (h << 13) | (h >>> 19));
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function pickModel(files, override, dir) {
  if (override?.model) return path.join(dir, override.model);
  const models = files.filter((f) => MODEL_EXTS.includes(path.extname(f).toLowerCase()));
  if (!models.length) throw new Error("No supported model file (.dae/.obj/.fbx/.glb) in zip");
  // The main body is almost always the biggest file; extra parts (hands, hats) are smaller.
  return models.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
}

function findCredit(files) {
  const readme = files.find((f) => /readme|credit/i.test(path.basename(f)) && f.endsWith(".txt"));
  const m = readme && fs.readFileSync(readme, "utf8").match(/submitted by:?\s*(.+)/i);
  return m ? m[1].trim() : null;
}

// Shelf-pack textures into one sheet, sorted tallest first.
async function buildSheet(texturePaths) {
  const tiles = [];
  for (const file of texturePaths) {
    const meta = await sharp(file).metadata();
    const scale = Math.max(1, Math.ceil(MIN_TILE / Math.max(meta.width, meta.height)));
    const w = meta.width * scale, h = meta.height * scale;
    const buf = await sharp(file).ensureAlpha().resize(w, h, { kernel: "nearest" }).png().toBuffer();
    tiles.push({ file, w, h, buf });
  }
  tiles.sort((a, b) => b.h - a.h || b.w - a.w);

  const area = tiles.reduce((s, t) => s + (t.w + PAD) * (t.h + PAD), 0);
  const width = Math.max(Math.max(...tiles.map((t) => t.w)) + PAD * 2, Math.ceil(Math.sqrt(area) * 1.15));

  let x = PAD, y = PAD, shelf = 0;
  for (const t of tiles) {
    if (x + t.w + PAD > width) (x = PAD), (y += shelf + PAD), (shelf = 0);
    Object.assign(t, { x, y });
    x += t.w + PAD;
    shelf = Math.max(shelf, t.h);
  }
  const height = y + shelf + PAD;

  const sheet = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles.map((t) => ({ input: t.buf, left: t.x, top: t.y })))
    .png()
    .toBuffer();
  return { sheet, width, height };
}

// Split the sheet into a GRID x GRID set of cells and reveal them in a seeded order
// until each hint shows its share of the non-transparent pixels. Hidden cells are erased
// to full transparency, so nothing about them (colour, shape or position) leaks.
async function buildHints(sheet, width, height, seed) {
  const { data } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
  const cells = [];
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = Math.floor((gx * width) / GRID), x1 = Math.floor(((gx + 1) * width) / GRID);
      const y0 = Math.floor((gy * height) / GRID), y1 = Math.floor(((gy + 1) * height) / GRID);
      let filled = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * width + x) * 4 + 3] > 8) filled++;
      cells.push({ x0, y0, w: x1 - x0, h: y1 - y0, filled });
    }
  }
  const total = cells.reduce((s, c) => s + c.filled, 0);
  const rand = rng(seed);
  const order = cells.filter((c) => c.filled > 0).map((c) => ({ c, k: rand() })).sort((a, b) => a.k - b.k).map((o) => o.c);

  const revealed = new Set();
  const hints = [];
  let shown = 0;
  for (const target of REVEAL) {
    for (const c of order) {
      if (shown / total >= target) break;
      if (revealed.has(c)) continue;
      revealed.add(c);
      shown += c.filled;
    }
    const hidden = cells.filter((c) => !revealed.has(c));
    const erasers = await Promise.all(
      hidden.map(async (c) => ({
        input: await sharp({ create: { width: c.w, height: c.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(),
        left: c.x0,
        top: c.y0,
        blend: "dest-out",
      })),
    );
    hints.push({ png: await sharp(sheet).composite(erasers).png().toBuffer(), share: shown / total });
  }
  return hints;
}

async function buildPuzzle(zipFile) {
  const info = parseZipName(zipFile);
  const id = slugify(`${info.game}-${info.name}`);
  if (filter && !id.includes(filter)) return null;
  const override = overrides[id] ?? {};
  console.log(`\n▸ ${id}`);

  const raw = path.join(RAW, id);
  fs.rmSync(raw, { recursive: true, force: true });
  new AdmZip(zipFile).extractAllTo(raw, true);
  const files = walk(raw);

  const model = pickModel(files, override, raw);
  console.log(`  model    ${path.relative(raw, model)}`);

  const out = path.join(OUT, id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const report = path.join(raw, "_textures.json");
  execFileSync(BLENDER, ["-b", "--factory-startup", "-P", path.join(ROOT, "pipeline/blender_export.py"), "--", model, path.join(out, "model.glb"), report], {
    stdio: process.env.VERBOSE ? "inherit" : "pipe",
  });
  const used = readJson(report, { textures: [], missing: [] });
  if (used.missing.length) console.log(`  missing  ${used.missing.map((p) => path.basename(p)).join(", ")}`);

  // Fall back to every image next to the model if the importer found no texture links.
  let textures = used.textures.length
    ? used.textures
    : files.filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()) && path.dirname(f) === path.dirname(model));
  const exclude = override.excludeTextures ?? [];
  textures = textures.filter((t) => !exclude.some((e) => path.basename(t).toLowerCase().includes(e.toLowerCase())));
  if (!textures.length) throw new Error("No textures found for this model");
  console.log(`  textures ${textures.length}`);

  const { sheet, width, height } = await buildSheet(textures);
  const hints = await buildHints(sheet, width, height, id);
  fs.writeFileSync(path.join(out, "hint1.png"), hints[0].png);
  fs.writeFileSync(path.join(out, "hint2.png"), hints[1].png);
  fs.writeFileSync(path.join(out, "hint3.png"), sheet);
  console.log(`  reveal   ${hints.map((h) => Math.round(h.share * 100) + "%").join(" → ")} → 100%`);

  return {
    id,
    ...info,
    credit: override.credit ?? findCredit(files),
    sourceUrl: override.sourceUrl ?? null,
    textureCount: textures.length,
    sheet: { width, height },
  };
}

const zips = fs.readdirSync(ZIPS).filter((f) => f.toLowerCase().endsWith(".zip")).map((f) => path.join(ZIPS, f));
const index = path.join(OUT, "index.json");
const existing = new Map(readJson(index, []).map((p) => [p.id, p]));
let failed = 0;
for (const zip of zips) {
  try {
    const puzzle = await buildPuzzle(zip);
    if (puzzle) existing.set(puzzle.id, puzzle);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${path.basename(zip)}: ${err.message}`);
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(index, JSON.stringify([...existing.values()].sort((a, b) => a.id.localeCompare(b.id)), null, 2));
console.log(`\n${existing.size} puzzles in web/public/puzzles/index.json${failed ? `, ${failed} failed` : ""}`);
process.exitCode = failed ? 1 : 0;
