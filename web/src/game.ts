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

/** Day 1 of Texturdle. Puzzles roll over at midnight UTC. */
const LAUNCH = Date.UTC(2026, 9, 22);
const DAY = 86_400_000;

export const puzzleNumber = (now = Date.now()) => Math.floor((now - LAUNCH) / DAY) + 1;
export const msUntilNext = (now = Date.now()) => DAY - ((now - LAUNCH) % DAY);
/** The UTC calendar day puzzle `n` was (or will be) the daily puzzle. */
export const puzzleDate = (n: number) => new Date(LAUNCH + (n - 1) * DAY);

/** A fixed shuffle of puzzle ids so the daily order isn't alphabetical. */
export function dailyPuzzle(puzzles: Puzzle[], n: number): Puzzle {
  const order = [...puzzles].sort((a, b) => hash(a.id) - hash(b.id));
  return order[(((n - 1) % order.length) + order.length) % order.length];
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
