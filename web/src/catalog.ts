// Games players can pick from: ~20k notable games from Wikidata (public/games.json, built by
// `npm run games`), plus the hand-written list below, which mainly adds familiar shorthand
// (SA2B, OoT, KH2) to those entries. Puzzle answers are merged in too, so the answer is
// always pickable.

export interface Game {
  id: string;
  title: string;
  platforms: string[];
  aliases: string[];
  /** Rough fame (Wikipedia language editions); ranks well-known games first in search. */
  pop: number;
  /** Wikidata ids of the series this game is part of (e.g. Resident Evil), for "Same series". */
  series: string[];
  /** Normalized title and aliases, precomputed so search stays fast over 20k games. */
  keys: string[];
  /** The same keys with spaces removed, so "biohazard" finds "Bio Hazard". */
  compact: string[];
}

interface GameList {
  platforms: string[];
  games: [title: string, platforms: number[], aliases: string[], pop: number, series?: string[]][];
}

type Entry = [title: string, platforms: string, aliases?: string];

const ENTRIES: Entry[] = [
  // GameCube
  ["Super Mario Sunshine", "GameCube", "SMS"],
  ["The Legend of Zelda: The Wind Waker", "GameCube", "Wind Waker, TWW"],
  ["The Legend of Zelda: Twilight Princess", "GameCube, Wii", "TP"],
  ["The Legend of Zelda: Four Swords Adventures", "GameCube"],
  ["Sonic Adventure 2: Battle", "GameCube", "SA2B, SA2 Battle"],
  ["Sonic Adventure DX: Director's Cut", "GameCube", "SADX"],
  ["Sonic Heroes", "GameCube, PlayStation 2, Xbox"],
  ["Shadow the Hedgehog", "GameCube, PlayStation 2, Xbox"],
  ["Sonic Riders", "GameCube, PlayStation 2, Xbox"],
  ["Super Smash Bros. Melee", "GameCube", "Melee, SSBM"],
  ["Luigi's Mansion", "GameCube"],
  ["Pikmin", "GameCube"],
  ["Pikmin 2", "GameCube"],
  ["Metroid Prime", "GameCube"],
  ["Metroid Prime 2: Echoes", "GameCube"],
  ["Paper Mario: The Thousand-Year Door", "GameCube", "TTYD"],
  ["Mario Kart: Double Dash!!", "GameCube", "Double Dash"],
  ["Mario Party 4", "GameCube"],
  ["Mario Party 7", "GameCube"],
  ["Mario Power Tennis", "GameCube"],
  ["Mario Superstar Baseball", "GameCube"],
  ["Super Mario Strikers", "GameCube"],
  ["Star Fox Adventures", "GameCube"],
  ["Star Fox: Assault", "GameCube"],
  ["F-Zero GX", "GameCube"],
  ["Kirby Air Ride", "GameCube"],
  ["Animal Crossing", "GameCube"],
  ["Donkey Konga", "GameCube"],
  ["Donkey Kong Jungle Beat", "GameCube"],
  ["Wario World", "GameCube"],
  ["Fire Emblem: Path of Radiance", "GameCube"],
  ["Pokémon Colosseum", "GameCube", "Pokemon Colosseum"],
  ["Pokémon XD: Gale of Darkness", "GameCube", "Pokemon XD"],
  ["Pokémon Box: Ruby & Sapphire", "GameCube"],
  ["Tales of Symphonia", "GameCube, PlayStation 2"],
  ["Skies of Arcadia Legends", "GameCube"],
  ["Baten Kaitos: Eternal Wings and the Lost Ocean", "GameCube"],
  ["Eternal Darkness: Sanity's Requiem", "GameCube"],
  ["Resident Evil", "GameCube", "REmake, RE1"],
  ["Resident Evil 4", "GameCube, PlayStation 2", "RE4"],
  ["Resident Evil Zero", "GameCube", "RE0"],
  ["Viewtiful Joe", "GameCube, PlayStation 2"],
  ["Killer7", "GameCube, PlayStation 2"],
  ["Ikaruga", "GameCube, Dreamcast"],
  ["Super Monkey Ball", "GameCube"],
  ["Super Monkey Ball 2", "GameCube"],
  ["Billy Hatcher and the Giant Egg", "GameCube"],
  ["Custom Robo", "GameCube"],
  ["Chibi-Robo!", "GameCube"],
  ["Geist", "GameCube"],
  ["Mario Golf: Toadstool Tour", "GameCube"],
  ["Kirby's Return to Dream Land", "Wii"],
  ["Soulcalibur II", "GameCube, PlayStation 2, Xbox", "SC2"],
  ["Beyond Good & Evil", "GameCube, PlayStation 2, Xbox", "BG&E"],
  ["Prince of Persia: The Sands of Time", "GameCube, PlayStation 2, Xbox"],
  ["TimeSplitters 2", "GameCube, PlayStation 2, Xbox"],
  ["Tony Hawk's Underground", "GameCube, PlayStation 2, Xbox", "THUG"],
  ["Spider-Man 2", "GameCube, PlayStation 2, Xbox"],
  ["The Simpsons: Hit & Run", "GameCube, PlayStation 2, Xbox"],
  ["Ty the Tasmanian Tiger", "GameCube, PlayStation 2, Xbox"],
  ["Crash Bandicoot: The Wrath of Cortex", "GameCube, PlayStation 2, Xbox"],
  ["Spyro: Enter the Dragonfly", "GameCube, PlayStation 2"],
  ["Kingdom Hearts", "PlayStation 2", "KH"],
  ["Kingdom Hearts II", "PlayStation 2", "KH2"],
  // Nintendo 64
  ["Super Mario 64", "Nintendo 64", "SM64"],
  ["The Legend of Zelda: Ocarina of Time", "Nintendo 64", "OoT, Ocarina"],
  ["The Legend of Zelda: Majora's Mask", "Nintendo 64", "MM"],
  ["Banjo-Kazooie", "Nintendo 64"],
  ["Banjo-Tooie", "Nintendo 64"],
  ["Donkey Kong 64", "Nintendo 64", "DK64"],
  ["Conker's Bad Fur Day", "Nintendo 64"],
  ["GoldenEye 007", "Nintendo 64"],
  ["Perfect Dark", "Nintendo 64"],
  ["Star Fox 64", "Nintendo 64"],
  ["Mario Kart 64", "Nintendo 64"],
  ["Paper Mario", "Nintendo 64"],
  ["Super Smash Bros.", "Nintendo 64", "SSB64"],
  ["Kirby 64: The Crystal Shards", "Nintendo 64"],
  ["Pokémon Snap", "Nintendo 64", "Pokemon Snap"],
  ["Pokémon Stadium", "Nintendo 64", "Pokemon Stadium"],
  // PlayStation
  ["Crash Bandicoot", "PlayStation"],
  ["Crash Bandicoot: Warped", "PlayStation", "Crash 3"],
  ["Crash Team Racing", "PlayStation", "CTR"],
  ["Spyro the Dragon", "PlayStation"],
  ["Spyro 2: Ripto's Rage!", "PlayStation"],
  ["Final Fantasy VII", "PlayStation", "FF7"],
  ["Final Fantasy VIII", "PlayStation", "FF8"],
  ["Final Fantasy IX", "PlayStation", "FF9"],
  ["Metal Gear Solid", "PlayStation", "MGS"],
  ["Tomb Raider", "PlayStation"],
  ["MediEvil", "PlayStation"],
  ["Ape Escape", "PlayStation"],
  ["Klonoa: Door to Phantomile", "PlayStation"],
  ["Silent Hill", "PlayStation"],
  // PlayStation 2
  ["Jak and Daxter: The Precursor Legacy", "PlayStation 2"],
  ["Ratchet & Clank", "PlayStation 2"],
  ["Sly Cooper and the Thievius Raccoonus", "PlayStation 2"],
  ["Shadow of the Colossus", "PlayStation 2", "SotC"],
  ["Ico", "PlayStation 2"],
  ["Okami", "PlayStation 2, Wii"],
  ["Final Fantasy X", "PlayStation 2", "FFX"],
  ["Dragon Quest VIII", "PlayStation 2", "DQ8"],
  ["Persona 4", "PlayStation 2", "P4"],
  ["Metal Gear Solid 3: Snake Eater", "PlayStation 2", "MGS3"],
  ["Devil May Cry", "PlayStation 2", "DMC"],
  ["Grand Theft Auto: San Andreas", "PlayStation 2, Xbox", "GTA SA"],
  ["Katamari Damacy", "PlayStation 2"],
  // Dreamcast
  ["Sonic Adventure", "Dreamcast", "SA1"],
  ["Sonic Adventure 2", "Dreamcast", "SA2"],
  ["Jet Set Radio", "Dreamcast", "JSR"],
  ["Shenmue", "Dreamcast"],
  ["Crazy Taxi", "Dreamcast, GameCube"],
  ["Phantasy Star Online", "Dreamcast, GameCube", "PSO"],
  ["Power Stone 2", "Dreamcast"],
  ["Space Channel 5", "Dreamcast"],
  // Xbox
  ["Halo: Combat Evolved", "Xbox", "Halo, Halo CE"],
  ["Halo 2", "Xbox"],
  ["Fable", "Xbox"],
  ["Star Wars: Knights of the Old Republic", "Xbox", "KOTOR"],
  ["Jet Set Radio Future", "Xbox", "JSRF"],
  ["Psychonauts", "Xbox, PlayStation 2"],
  // Wii
  ["Super Mario Galaxy", "Wii", "SMG"],
  ["Super Mario Galaxy 2", "Wii", "SMG2"],
  ["The Legend of Zelda: Skyward Sword", "Wii", "SS"],
  ["Super Smash Bros. Brawl", "Wii", "Brawl"],
  ["Mario Kart Wii", "Wii", "MKW"],
  ["Xenoblade Chronicles", "Wii"],
  ["Metroid Prime 3: Corruption", "Wii"],
  ["Sonic Colors", "Wii", "Sonic Colours"],
  ["Wii Sports", "Wii"],
];

// Lowercase, drop accents, turn punctuation into spaces. NFKD also unfolds full-width
// characters and Roman-numeral symbols ("Ⅲ" -> "iii"); letters in any script survive, so
// Japanese titles are searchable too.
export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/&/g, "and").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export const gameId = (title: string) => normalize(title).replace(/ /g, "-");

export function buildCatalog(extra: { title: string; platform: string }[], list?: GameList): Game[] {
  const byId = new Map<string, Game>();
  // Games with the same name (remakes, regional releases) merge into one entry.
  const add = (title: string, platforms: string[], aliases: string[], pop = 0, series: string[] = []) => {
    const id = gameId(title);
    const g = byId.get(id) ?? { id, title, platforms: [], aliases: [], pop: 0, series: [], keys: [], compact: [] };
    for (const p of platforms) if (!g.platforms.includes(p)) g.platforms.push(p);
    for (const a of aliases) if (!g.aliases.includes(a)) g.aliases.push(a);
    g.pop = Math.max(g.pop, pop);
    for (const s of series) if (!g.series.includes(s)) g.series.push(s);
    byId.set(id, g);
  };
  if (list) for (const [title, p, aliases, pop, series] of list.games) add(title, p.map((i) => list.platforms[i]), aliases, pop, series);
  for (const [title, platforms, aliases] of ENTRIES) {
    add(title, platforms.split(",").map((s) => s.trim()), aliases ? aliases.split(",").map((s) => s.trim()) : []);
  }
  const games = [...byId.values()];
  const setKeys = (g: Game) => {
    g.keys = [...new Set([g.title, ...g.aliases].map(normalize))];
    g.compact = g.keys.map((k) => k.replaceAll(" ", ""));
  };
  games.forEach(setKeys);
  // An answer named after one release of a listed game ("Super Smash Bros. for Nintendo 3DS")
  // joins that game, so it shares its other names and its series. Anything else gets its own
  // entry, with no popularity boost so answers never stand out in the suggestions.
  for (const e of extra) {
    const g = findGame(games, e.title);
    if (g) {
      if (!g.platforms.includes(e.platform)) g.platforms.push(e.platform);
      continue;
    }
    add(e.title, [e.platform], []);
    const added = byId.get(gameId(e.title))!;
    setKeys(added);
    games.push(added);
  }
  return games;
}

/** The catalog entry for a title: the game with that title, else the best-known game that
 *  has it as an alias. */
export function findGame(catalog: Game[], title: string): Game | undefined {
  const id = gameId(title);
  const key = normalize(title);
  return (
    catalog.find((g) => g.id === id) ??
    catalog.filter((g) => g.keys.includes(key)).sort((a, b) => b.pop - a.pop)[0]
  );
}

/** Loads the full game list; falls back to the built-in list if it can't be fetched. */
export async function loadCatalog(extra: { title: string; platform: string }[]): Promise<Game[]> {
  try {
    const res = await fetch("/games.json");
    if (res.ok) return buildCatalog(extra, (await res.json()) as GameList);
  } catch {
    // Offline or missing file: the smaller built-in list still works.
  }
  return buildCatalog(extra);
}

// Ranked match: exact, then title prefix, then word prefix, then substring (aliases count
// as titles). Ties go to better-known games, so "mario" suggests Super Mario 64 first.
export function search(catalog: Game[], query: string, limit = 8): Game[] {
  const q = normalize(query);
  if (!q) return [];
  const wordStart = " " + q;
  const qc = q.replaceAll(" ", "");
  const score = (t: string) => (t === q ? 0 : t.startsWith(q) ? 1 : t.includes(wordStart) ? 2 : t.includes(q) ? 3 : 9);
  // Spacing differences ("biohazard" vs "Bio Hazard") rank just behind a real match.
  const scoreCompact = (t: string) => (t === qc ? 1 : t.startsWith(qc) ? 2 : qc.length >= 4 && t.includes(qc) ? 3 : 9);
  const hits: { g: Game; s: number }[] = [];
  for (const g of catalog) {
    let s = 9;
    for (const k of g.keys) s = Math.min(s, score(k));
    if (s > 1) for (const k of g.compact) s = Math.min(s, scoreCompact(k));
    if (s < 9) hits.push({ g, s });
  }
  return hits
    .sort((a, b) => a.s - b.s || b.g.pop - a.g.pop || a.g.title.localeCompare(b.g.title))
    .slice(0, limit)
    .map((r) => r.g);
}

/** Rough series key from a title, used only when Wikidata doesn't say: the part before any
 *  colon, without numbers or Roman numerals ("Resident Evil 5" -> "resident evil"). */
function seriesKey(title: string) {
  const key = normalize(title.split(":")[0]).replace(/\b(?:[ivx]+|\d+d?)\b/g, "").replace(/\s+/g, " ").trim();
  return key.startsWith("pokemon") ? "pokemon" : key;
}

/** Whether two games are in the same series. Uses Wikidata's "part of the series" when both
 *  games have it; otherwise compares title prefixes (and only when that prefix is specific). */
export function sameSeries(a: Game, b: Game) {
  if (a.series.length && b.series.length) return a.series.some((s) => b.series.includes(s));
  const ka = seriesKey(a.title);
  return ka.length >= 4 && ka === seriesKey(b.title);
}
