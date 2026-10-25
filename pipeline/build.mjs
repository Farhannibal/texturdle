// Turns every zip in data/modelzipped into a playable puzzle under web/public/puzzles.
//
//   npm run puzzles                 build every zip
//   npm run puzzles -- --new        only zips that haven't been built yet
//   npm run puzzles -- sonic        only zips whose slug contains "sonic"
//
// Every build also writes data/review/report.json and a preview render per model, which
// the dev-only review page (/review.html) reads. Approving or rejecting there writes
// "status" into data/overrides.json; a rejected model is treated like "skip".
//
// Zip names follow the Models Resource download pattern:
//   "<Platform> - <Game> - <Category> - <Model>.zip"
// Per-puzzle fixes go in data/overrides.json, keyed by slug:
//   { "<slug>": { "model": "path/inside/zip.dae", "excludeTextures": ["eye"] } }
// "accept": ["Other Title"] makes other game-list titles count as correct too.
// Set "skip": true (with an optional "reason") to leave a model out of the game, or
// "rotateX": -90 to stand up a model that was exported lying down.

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

// Hints 1-3 show ~10%, ~30% and ~50% of the texture pixels, each including the last one's
// area; hint 4 is the full sheet. An 8x8 grid keeps the small first step close to 10%.
const GRID = 8;
const REVEAL = [0.1, 0.3, 0.5];
const MIN_TILE = 96; // tiny textures are scaled up by whole multiples so they stay readable
const MAX_TILE = 512; // modern high-res textures are scaled down so the sheet stays a sensible size
const PAD = 4;

const REVIEW = path.join(ROOT, "data/review");
const BLENDER_TIMEOUT_MS = 4 * 60 * 1000;

const overrides = readJson(path.join(ROOT, "data/overrides.json"), {});
// Models Resource game name -> the name used in the game list, for the few that differ
// (e.g. "Pokemon X / Y" -> "Pokémon X and Y"). The puzzle id still uses the original name.
const gameNames = readJson(path.join(ROOT, "data/game-names.json"), {});
const normalize = (s) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/&/g, "and").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); // same as web/src/catalog.ts
const gameList = readJson(path.join(ROOT, "web/public/games.json"), null);

// Each zip's Models Resource page. Browsers on Windows record the page a file was downloaded
// from in a hidden "Zone.Identifier" note on the file; copying the zip elsewhere usually strips
// it, so every address found is also saved to data/sources.json (committed) and kept from then on.
const SOURCES = path.join(ROOT, "data/sources.json");
const sources = readJson(SOURCES, {});

function downloadPage(zipFile) {
  try {
    const note = fs.readFileSync(`${zipFile}:Zone.Identifier`, "utf8");
    return note.match(/ReferrerUrl=(https:\/\/models\.spriters-resource\.com\/\S+\/asset\/\d+\/?)/)?.[1] ?? null;
  } catch {
    return null; // not on NTFS, or the note was stripped by copying
  }
}
const knownGames = gameList && new Set(gameList.games.flatMap(([title, , aliases]) => [title, ...aliases].map(normalize)));
const cliArgs = process.argv.slice(2);
const onlyNew = cliArgs.includes("--new");
const filter = cliArgs.find((a) => !a.startsWith("--"))?.toLowerCase();
const isSkipped = (o) => o?.skip || o?.status === "rejected";

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function parseZipName(file) {
  const parts = path.basename(file, ".zip").split(" - ");
  if (parts.length < 4) throw new Error(`Expected "Platform - Game - Category - Model.zip", got "${file}"`);
  const [platform, game, category, ...rest] = parts;
  // Windows can't store ":" or "/" in filenames, so downloads use "_ " and " _ " instead.
  const clean = (s) => s.replace(/ _ /g, " / ").replace(/_ /g, ": ").trim();
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

// Alternate forms and spare parts that sometimes outweigh the main model.
const VARIANT = /mega|gmax|gibs|lod\d|_lod|shadow|shd\b|multiplayer|effects?[\\/]|wpn|weapon/i;

/** Model files to try, best first. */
function modelCandidates(files, override, dir) {
  if (override?.model) return [path.join(dir, override.model)];
  const models = files.filter((f) => MODEL_EXTS.includes(path.extname(f).toLowerCase()));
  if (!models.length) throw new Error("No supported model file (.dae/.obj/.fbx/.glb) in zip");
  // The main body is almost always the biggest file; extra parts (hands, hats) are smaller.
  // Variants (Mega forms, gibs, LODs, multiplayer recolours) go last.
  const variant = (f) => Number(VARIANT.test(path.relative(dir, f)));
  return models.sort((a, b) => variant(a) - variant(b) || fs.statSync(b).size - fs.statSync(a).size);
}

// Rippers credit themselves in a text file inside the zip, worded many ways:
// "Originally Submitted by: X", "Model ripped by X, no credit needed.",
// "Model Rippers: X and Y", "This rip revision by X".
const CREDIT = /(?:submitted by|ripped by|rippers?|revision by)\s*:?\s*([^\r\n]+)/i;

function findCredit(files) {
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".txt") || /^materials/i.test(path.basename(f))) continue;
    const m = fs.readFileSync(f, "utf8").match(CREDIT);
    // Keep the name only: drop ", no credit needed", trailing dashes and full stops.
    const name = m?.[1].split(",")[0].replace(/[\s.\-–—:]+$/, "").trim();
    if (name) return name;
  }
  return null;
}

// Shelf-pack textures into one sheet, sorted tallest first.
async function buildSheet(texturePaths) {
  const tiles = [];
  for (const file of texturePaths) {
    const meta = await sharp(file).metadata();
    const side = Math.max(meta.width, meta.height);
    const scale = side > MAX_TILE ? MAX_TILE / side : Math.max(1, Math.ceil(MIN_TILE / side));
    const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
    const kernel = scale < 1 ? "lanczos3" : "nearest";
    const buf = await sharp(file).ensureAlpha().resize(w, h, { kernel }).png().toBuffer();
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
  return { hints, fill: total / (width * height) };
}

/** Things worth a second look on the review page. None of them block a build. */
function qualityFlags(info, used, textureCount, glbBytes, fill) {
  const flags = [];
  if (/location|course|stage|map|area|level|room|track|world/i.test(info.category)) flags.push("Location, not a character");
  if (textureCount < 2) flags.push("Only one texture");
  if (used.missing.length) flags.push(`${used.missing.length} texture file(s) missing`);
  if (used.untexturedMaterials) flags.push(`${used.untexturedMaterials} untextured material(s), may render plain`);
  if (used.triangles > 80_000) flags.push(`Heavy model (${Math.round(used.triangles / 1000)}k triangles)`);
  if (glbBytes > 4e6) flags.push(`Large file (${(glbBytes / 1e6).toFixed(1)} MB)`);
  const { width, depth, height } = used.size;
  const biggest = Math.max(width, depth, height);
  if (biggest > 5000 || biggest < 0.01) flags.push("Unusual scale");
  if (depth > height * 1.3 && depth > width * 0.8) flags.push("May be lying down");
  if (fill < 0.35) flags.push("Texture sheet is mostly empty space");
  return flags;
}

async function buildPuzzle(zipFile) {
  const info = parseZipName(zipFile);
  const id = slugify(`${info.game}-${info.name}`);
  info.game = gameNames[info.game] ?? info.game;
  if (filter && !id.includes(filter)) return null;
  const override = overrides[id] ?? {};
  if (onlyNew && (isSkipped(override) || fs.existsSync(path.join(OUT, id, "model.glb")))) return null;
  console.log(`\n▸ ${id}`);
  if (isSkipped(override)) {
    console.log(`  skipped  ${override.reason ?? (override.status === "rejected" ? "rejected in review" : "marked skip in data/overrides.json")}`);
    fs.rmSync(path.join(OUT, id), { recursive: true, force: true });
    return { id, skipped: true };
  }

  const raw = path.join(RAW, id);
  fs.rmSync(raw, { recursive: true, force: true });
  new AdmZip(zipFile).extractAllTo(raw, true);
  const files = walk(raw);

  const out = path.join(OUT, id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const report = path.join(raw, "_textures.json");
  fs.mkdirSync(REVIEW, { recursive: true });
  const glb = path.join(out, "model.glb");

  const runBlender = (model) => {
    try {
      execFileSync(
        BLENDER,
        // --python-exit-code makes a crash in the script fail the run instead of exiting 0.
        ["-b", "--factory-startup", "--python-exit-code", "1", "-P", path.join(ROOT, "pipeline/blender_export.py"), "--",
          model, glb, report, String(override.rotateX ?? 0), path.join(REVIEW, `${id}.png`)],
        { stdio: process.env.VERBOSE ? "inherit" : "pipe", timeout: BLENDER_TIMEOUT_MS },
      );
    } catch (err) {
      if (err.code === "ETIMEDOUT") return `Blender took longer than ${BLENDER_TIMEOUT_MS / 60000} minutes`;
      // Report the Python exception line rather than Blender's generic "script failed".
      const lines = `${err.stdout ?? ""}\n${err.stderr ?? ""}`
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /error|exception/i.test(l) && !/script failed/i.test(l));
      return `Blender failed: ${lines.at(-1) ?? "unknown error"}`;
    }
    return fs.existsSync(glb) ? null : "Blender finished without writing a model";
  };

  // If a file won't import (old ASCII FBX, COLLADA with morph targets), fall back to the
  // next candidate, up to four tries.
  let model = null;
  const candidates = modelCandidates(files, override, raw);
  const errors = [];
  for (const candidate of candidates.slice(0, 4)) {
    const error = runBlender(candidate);
    if (!error) {
      model = candidate;
      break;
    }
    errors.push(`${path.basename(candidate)}: ${error}`);
    console.log(`  tried    ${path.relative(raw, candidate)} (${error})`);
  }
  if (!model) throw new Error(errors.join(" | "));
  console.log(`  model    ${path.relative(raw, model)}`);
  const used = readJson(report, { textures: [], missing: [], untexturedMaterials: 0, triangles: 0, size: { width: 1, depth: 1, height: 1 } });
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
  const { hints, fill } = await buildHints(sheet, width, height, id);
  hints.forEach((h, i) => fs.writeFileSync(path.join(out, `hint${i + 1}.png`), h.png));
  fs.writeFileSync(path.join(out, `hint${hints.length + 1}.png`), sheet);
  console.log(`  reveal   ${hints.map((h) => Math.round(h.share * 100) + "%").join(" → ")} → 100%`);

  const glbBytes = fs.statSync(glb).size;
  const flags = qualityFlags(info, used, textures.length, glbBytes, fill);
  if (knownGames && !knownGames.has(normalize(info.game))) {
    flags.push(`"${info.game}" isn't in the game list; if it's listed under another name, map it in data/game-names.json`);
  }
  if (model !== candidates[0]) flags.push(`Fell back to ${path.basename(model)}`);
  if (VARIANT.test(path.relative(raw, model))) flags.push("Used a variant or spare-part file");
  if (flags.length) console.log(`  flags    ${flags.join("; ")}`);
  review[id] = {
    ...info,
    zip: path.basename(zipFile),
    flags,
    stats: { textures: textures.length, triangles: used.triangles, kb: Math.round(glbBytes / 1024), fill: Math.round(fill * 100) },
    builtAt: new Date().toISOString(),
  };

  return {
    id,
    ...info,
    credit: override.credit ?? findCredit(files),
    sourceUrl: override.sourceUrl ?? sources[id] ?? null,
    // Other titles that also count as correct (e.g. a regional release listed separately).
    ...(override.accept?.length ? { accept: override.accept } : {}),
    textureCount: textures.length,
    sheet: { width, height },
  };
}

const zips = fs.readdirSync(ZIPS).filter((f) => f.toLowerCase().endsWith(".zip")).map((f) => path.join(ZIPS, f));
const index = path.join(OUT, "index.json");
const existing = new Map(readJson(index, []).map((p) => [p.id, p]));
const reportFile = path.join(REVIEW, "report.json");
const review = readJson(reportFile, {});
let failed = 0;
// Record download pages for every zip first (cheap), so links fill in even for zips this
// run doesn't rebuild.
for (const zip of zips) {
  try {
    const info = parseZipName(zip);
    const page = downloadPage(zip);
    if (page) sources[slugify(`${info.game}-${info.name}`)] = page;
  } catch {
    // Unparseable name; the build loop reports it.
  }
}
for (const zip of zips) {
  try {
    const puzzle = await buildPuzzle(zip);
    if (puzzle?.skipped) existing.delete(puzzle.id);
    else if (puzzle) existing.set(puzzle.id, puzzle);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${path.basename(zip)}: ${err.message}`);
    // Failed builds still show on the review page so they can be rejected or fixed.
    try {
      const info = parseZipName(zip);
      const id = slugify(`${info.game}-${info.name}`);
      existing.delete(id);
      fs.rmSync(path.join(OUT, id), { recursive: true, force: true });
      review[id] = { ...info, zip: path.basename(zip), error: err.message, flags: [], builtAt: new Date().toISOString() };
    } catch {
      // Unparseable zip name; the console error is all we can offer.
    }
  }
}
// A full build also drops puzzles whose zip has been removed from data/modelzipped.
if (!filter) {
  const live = new Set(
    zips.flatMap((z) => {
      try {
        const i = parseZipName(z);
        return [slugify(`${i.game}-${i.name}`)];
      } catch {
        return [];
      }
    }),
  );
  for (const id of existing.keys()) {
    if (live.has(id)) continue;
    existing.delete(id);
    fs.rmSync(path.join(OUT, id), { recursive: true, force: true });
    console.log(`\n▸ ${id}\n  removed  its zip is no longer in data/modelzipped`);
  }
  for (const id of Object.keys(review)) if (!live.has(id)) delete review[id];
}
fs.mkdirSync(REVIEW, { recursive: true });
// Fill links (and credits set in overrides) into puzzles built before they were known, and
// onto the review cards, without rebuilding the models.
for (const [id, p] of existing) {
  const url = overrides[id]?.sourceUrl ?? sources[id] ?? null;
  const credit = overrides[id]?.credit ?? p.credit?.replace(/[\s.\-–—:]+$/, "") ?? null;
  if ((url && p.sourceUrl !== url) || credit !== p.credit) existing.set(id, { ...p, sourceUrl: url ?? p.sourceUrl, credit });
}
for (const [id, r] of Object.entries(review)) {
  const url = overrides[id]?.sourceUrl ?? sources[id] ?? null;
  r.sourceUrl = url;
  const missing = "No Models Resource link; add \"sourceUrl\" in data/overrides.json";
  r.flags = (r.flags ?? []).filter((f) => f !== missing);
  if (!url && !r.error) r.flags.push(missing);
}
fs.writeFileSync(SOURCES, JSON.stringify(Object.fromEntries(Object.entries(sources).sort()), null, 2) + "\n");
fs.writeFileSync(reportFile, JSON.stringify(review, null, 2));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(index, JSON.stringify([...existing.values()].sort((a, b) => a.id.localeCompare(b.id)), null, 2));
console.log(`\n${existing.size} puzzles in web/public/puzzles/index.json${failed ? `, ${failed} failed` : ""}`);
process.exitCode = failed ? 1 : 0;
