// Builds web/public/games.json, the list of games players can guess from, using Wikidata
// (CC0). Only notable games are kept (Wikipedia articles in 3+ languages, ~20k titles),
// so the answer is never the only plausible entry and the list stays a few hundred KB.
//
//   npm run games
//
// Platform names are converted to The Models Resource's names so the game can tell
// players when they picked the right platform.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "web/public/games.json");
const MIN_SITELINKS = 3;

// Wikidata platform label -> The Models Resource console name.
const PLATFORM_NAMES = {
  "Nintendo GameCube": "GameCube",
  "Nintendo 3DS": "3DS",
  "New Nintendo 3DS": "3DS",
  "Nintendo DS": "DS / DSi",
  "Nintendo DSi": "DS / DSi",
  "Microsoft Windows": "PC / Computer",
  "DOS": "PC / Computer",
  "MS-DOS": "PC / Computer",
  "macOS": "PC / Computer",
  "Classic Mac OS": "PC / Computer",
  "Linux": "PC / Computer",
  "Android": "Mobile",
  "iOS": "Mobile",
  "iPadOS": "Mobile",
  "32X": "Sega 32X",
  "Sega Genesis": "Genesis / 32X / SCD",
  "Mega Drive": "Genesis / 32X / SCD",
  "Sega CD": "Genesis / 32X / SCD",
  "Nintendo Entertainment System": "NES",
  "Famicom": "NES",
  "Super Nintendo Entertainment System": "SNES",
  "Super Famicom": "SNES",
  "arcade video game machine": "Arcade",
  "Dreamcast": "Dreamcast",
  "Sega Saturn": "Saturn",
  "Xbox Series X and Series S": "Xbox Series X/S",
};

// Video games, plus types Wikidata files separately that can still be answers:
// Pokémon paired releases ("Pokémon X and Y") and their remakes ("HeartGold and SoulSilver"),
// compilations ("Super Mario 3D All-Stars") and expansions.
const TYPES = ["Q7889", "Q116774927", "Q116774997", "Q16070115", "Q209163"].map((q) => `wd:${q}`).join(" ");
const BASE = `VALUES ?type { ${TYPES} } ?g wdt:P31 ?type; wikibase:sitelinks ?s. FILTER(?s >= ${MIN_SITELINKS})`;
// Wikidata stores many names under the language-neutral "mul" code rather than "en".
const LANGS = `("en", "mul")`;
const QUERIES = {
  labels: `SELECT ?g ?v ?l ?s WHERE { ${BASE} ?g rdfs:label ?v. BIND(LANG(?v) AS ?l) FILTER(?l IN ${LANGS}) }`,
  platforms: `SELECT ?g ?v WHERE { ${BASE} ?g wdt:P400 ?p. ?p rdfs:label ?v. FILTER(LANG(?v) IN ${LANGS}) }`,
  aliases: `SELECT ?g ?v WHERE { ${BASE} ?g skos:altLabel ?v. FILTER(LANG(?v) IN ${LANGS}) }`,
  // Japanese titles, so players can type the original name (ロックマン finds Mega Man).
  japanese: `SELECT ?g ?v WHERE { ${BASE} { ?g rdfs:label ?v } UNION { ?g skos:altLabel ?v } FILTER(LANG(?v) = "ja") }`,
};

async function sparql(query) {
  const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "texturdle-game-list/1.0 (https://github.com/Farhannibal/texturdle)" },
  });
  const text = await res.text();
  if (!res.ok || !text.startsWith("{")) throw new Error(`Wikidata query failed (${res.status}): ${text.slice(0, 120)}`);
  return JSON.parse(text).results.bindings;
}

const games = new Map();
for (const b of await sparql(QUERIES.labels)) {
  const id = b.g.value.split("/").pop();
  // Prefer the English label; fall back to the language-neutral one.
  if (b.l.value === "en" || !games.has(id)) {
    games.set(id, { title: b.v.value, platforms: new Set(), aliases: new Set(), pop: Number(b.s.value) });
  }
}
for (const b of await sparql(QUERIES.platforms)) {
  const name = PLATFORM_NAMES[b.v.value] ?? b.v.value;
  games.get(b.g.value.split("/").pop())?.platforms.add(name);
}
for (const b of [...(await sparql(QUERIES.aliases)), ...(await sparql(QUERIES.japanese))]) {
  const g = games.get(b.g.value.split("/").pop());
  if (g && b.v.value !== g.title) g.aliases.add(b.v.value);
}

// Compact format: a shared platform table, then [title, platform indexes, aliases, popularity].
const platforms = [...new Set([...games.values()].flatMap((g) => [...g.platforms]))].sort();
const platformIndex = new Map(platforms.map((p, i) => [p, i]));
const rows = [...games.values()]
  .sort((a, b) => b.pop - a.pop)
  .map((g) => [g.title, [...g.platforms].map((p) => platformIndex.get(p)), [...g.aliases], g.pop]);

fs.writeFileSync(OUT, JSON.stringify({ source: "Wikidata (CC0)", builtAt: new Date().toISOString(), platforms, games: rows }));
console.log(`${rows.length} games, ${platforms.length} platforms, ${Math.round(fs.statSync(OUT).size / 1024)} KB -> web/public/games.json`);
