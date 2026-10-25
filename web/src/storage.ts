import { MAX_GUESSES, type GameState } from "./game";

// Everything lives in one localStorage entry. Daily games are keyed by puzzle number;
// past puzzles played from the archive are keyed "archive:<number>", and practice games
// (dev picker) "practice:<id>". Only daily games count toward the streak and stats.
const KEY = "texturdle:v1";

interface Saved {
  games: Record<string, GameState>;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    // Storage blocked or corrupt: play without saving.
  }
  return { games: {} };
}

let saved = load();

export const getGame = (key: string) => saved.games[key] ?? null;

export function saveGame(key: string, state: GameState) {
  saved = { ...saved, games: { ...saved.games, [key]: state } };
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Ignore: progress just won't survive a reload.
  }
}

export interface DayRecord {
  n: number;
  /** The game for this day, if the player has started it. */
  state: GameState | null;
  /** True if it was finished from the archive rather than on the day. */
  late: boolean;
}

/** How the player did on puzzle `n`: on the day if they finished it then, otherwise from the archive. */
export function dayRecord(n: number): DayRecord {
  const onTime = saved.games[String(n)];
  if (onTime && onTime.status !== "playing") return { n, state: onTime, late: false };
  const later = saved.games[`archive:${n}`];
  if (later) return { n, state: later, late: true };
  return { n, state: onTime ?? null, late: false };
}

export interface Stats {
  played: number;
  wins: number;
  streak: number;
  best: number;
  /** wins by guess count; index 0 = won on guess 1 */
  dist: number[];
}

export function stats(today: number): Stats {
  const daily = Object.entries(saved.games)
    .filter(([k, g]) => /^\d+$/.test(k) && g.status !== "playing")
    .map(([k, g]) => ({ n: Number(k), g }))
    .sort((a, b) => a.n - b.n);

  const dist = Array(MAX_GUESSES).fill(0);
  let best = 0, run = 0, prev = -1;
  for (const { n, g } of daily) {
    if (g.status === "won") {
      dist[g.guesses.length - 1]++;
      run = n === prev + 1 ? run + 1 : 1;
      best = Math.max(best, run);
    } else run = 0;
    prev = n;
  }
  // A streak survives until today's puzzle is missed, so yesterday's win still counts.
  const last = daily.at(-1);
  const streak = last && last.g.status === "won" && last.n >= today - 1 ? run : 0;
  return { played: daily.length, wins: dist.reduce((a, b) => a + b, 0), streak, best, dist };
}
