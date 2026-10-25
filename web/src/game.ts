import type { Game } from "./catalog";

export interface Puzzle {
  id: string;
  platform: string;
  game: string;
  category: string;
  name: string;
  credit: string | null;
  sourceUrl: string | null;
  /** Other titles that also count as correct, e.g. a regional release listed separately. */
  accept?: string[];
  textureCount: number;
}

export type Result = "correct" | "platform" | "wrong" | "skip";

export interface Guess {
  gameId: string | null;
  title: string;
  result: Result;
}

export interface GameState {
  puzzleId: string;
  guesses: Guess[];
  status: "playing" | "won" | "lost";
}

// Stages 1-4 show textures (10%, 30%, 50%, 100%); the last stage shows the model.
export const STAGES = [
  { label: "10%", hint: "A tenth of the textures" },
  { label: "30%", hint: "Almost a third of the textures" },
  { label: "50%", hint: "Half of the textures" },
  { label: "100%", hint: "Every texture on the model" },
  { label: "Model", hint: "The full 3D model" },
];

export const MAX_GUESSES = STAGES.length;
export const MODEL_STAGE = STAGES.length;

export const newGame = (puzzleId: string): GameState => ({ puzzleId, guesses: [], status: "playing" });

/** The furthest stage the player has unlocked (1 to MAX_GUESSES). Finished games unlock everything. */
export const unlockedStage = (s: GameState) => (s.status === "playing" ? Math.min(s.guesses.length + 1, MAX_GUESSES) : MAX_GUESSES);

export function submitGuess(state: GameState, puzzle: Puzzle, answerIds: string[], game: Game | null): GameState {
  if (state.status !== "playing") return state;
  const result: Result = !game
    ? "skip"
    : answerIds.includes(game.id)
      ? "correct"
      : game.platforms.includes(puzzle.platform)
        ? "platform"
        : "wrong";
  const guesses = [...state.guesses, { gameId: game?.id ?? null, title: game?.title ?? "Skipped", result }];
  const status = result === "correct" ? "won" : guesses.length >= MAX_GUESSES ? "lost" : "playing";
  return { ...state, guesses, status };
}

// ---- Daily schedule -------------------------------------------------------

/** The day-by-day puzzle list, from public/schedule.json (maintained by `npm run schedule`). */
export interface Schedule {
  /** Day 1, as a UTC date (YYYY-MM-DD). Puzzles roll over at midnight UTC. */
  launch: string;
  /** Puzzle id for each day; day n is days[n - 1]. Loops when it runs out. */
  days: string[];
}

const DAY = 86_400_000;
let launch = Date.UTC(2026, 8, 17);
let days: string[] = [];

/** Use the published schedule. Call before anything below. */
export function useSchedule(s: Schedule | null) {
  if (!s) return;
  const t = Date.parse(`${s.launch}T00:00:00Z`);
  if (Number.isFinite(t)) launch = t;
  days = s.days ?? [];
}

export const puzzleNumber = (now = Date.now()) => Math.floor((now - launch) / DAY) + 1;
export const msUntilNext = (now = Date.now()) => DAY - ((now - launch) % DAY);
/** The UTC calendar day puzzle `n` was (or will be) the daily puzzle. */
export const puzzleDate = (n: number) => new Date(launch + (n - 1) * DAY);

const wrap = (n: number, len: number) => (((n - 1) % len) + len) % len;

/** Day n's puzzle from the schedule, looping when it runs out. If the scheduled puzzle isn't
 *  available (or there's no schedule), falls back to a fixed shuffle of all puzzles. */
export function dailyPuzzle(puzzles: Puzzle[], n: number): Puzzle {
  if (days.length) {
    const p = puzzles.find((x) => x.id === days[wrap(n, days.length)]);
    if (p) return p;
  }
  const order = [...puzzles].sort((a, b) => hash(a.id) - hash(b.id));
  return order[wrap(n, order.length)];
}

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---- Share text -----------------------------------------------------------

const SQUARE: Record<Result, string> = { correct: "🟩", platform: "🟨", wrong: "🟥", skip: "⬛" };

export function shareText(state: GameState, label: string) {
  const score = state.status === "won" ? `${state.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const squares = state.guesses.map((g) => SQUARE[g.result]).join("") + "⬜".repeat(MAX_GUESSES - state.guesses.length);
  return `Texturdle ${label} ${score}\n${squares}`;
}
