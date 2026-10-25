import "./style.css";
import { buildCatalog, gameId, search, type Game } from "./catalog";
import {
  MAX_GUESSES, MODEL_STAGE, STAGES, dailyPuzzle, msUntilNext, newGame, puzzleNumber, shareText, submitGuess, unlockedStage,
  type GameState, type Puzzle,
} from "./game";
import { confetti, isMuted, setMuted, winSound } from "./celebrate";
import { getGame, saveGame, stats } from "./storage";
import type { Viewer } from "./viewer";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const puzzles: Puzzle[] = await fetch("/puzzles/index.json").then((r) => r.json());
const catalog = buildCatalog(puzzles.map((p) => ({ title: p.game, platform: p.platform })));
const today = puzzleNumber();

// ?practice=<puzzle id> plays any puzzle without touching the daily streak.
const practiceId = new URLSearchParams(location.search).get("practice");
const practice = practiceId ? puzzles.find((p) => p.id === practiceId) ?? null : null;
const puzzle = practice ?? dailyPuzzle(puzzles, today);
const answerId = gameId(puzzle.game);
const saveKey = practice ? `practice:${practice.id}` : String(today);
const label = practice ? "Practice" : `#${today}`;

let state: GameState = getGame(saveKey)?.puzzleId === puzzle.id ? getGame(saveKey)! : newGame(puzzle.id);
let viewing = unlockedStage(state);
let selected: Game | null = null;
let viewer: Viewer | null = null;

$("#puzzle-no").textContent = practice ? "" : label;
$("#practice-flag").hidden = !practice;

// ---- Stage tabs + hint frame -----------------------------------------------

function renderStage(animate = false) {
  const unlocked = unlockedStage(state);
  const tabs = $("#tabs");
  tabs.replaceChildren(
    ...STAGES.map((s, i) => {
      const n = i + 1;
      const b = h("button", "tab", s.label);
      b.type = "button";
      b.role = "tab";
      b.disabled = n > unlocked;
      b.setAttribute("aria-selected", String(n === viewing));
      b.setAttribute("aria-label", n > unlocked ? `${s.hint} (locked)` : s.hint);
      b.onclick = () => ((viewing = n), renderStage());
      return b;
    }),
  );

  $("#stage-caption").textContent = `Stage ${viewing} of ${MAX_GUESSES} · ${STAGES[viewing - 1].hint}`;
  showInFrame(viewing, animate);
}

// The frame shows hints and the model in the 3D viewer. Until it loads (or if WebGL is
// unavailable) texture hints fall back to a flat <img>.
const frameImg = $<HTMLImageElement>("#frame-img");
const frameStatus = $("#frame-status");
const frameTip = $("#frame-tip");
const viewerReady: Promise<Viewer | null> = import("./viewer")
  .then(({ createViewer }) => (viewer = createViewer($("#frame-3d"))))
  .catch(() => null);

/** `animate` spins the current hint into the next one (used after a guess, not for tab clicks). */
function showInFrame(n: number, animate = false) {
  const isModel = n === MODEL_STAGE;
  const url = isModel ? `/puzzles/${puzzle.id}/model.glb` : `/puzzles/${puzzle.id}/hint${n}.png`;
  $("#frame").setAttribute("aria-label", `${STAGES[n - 1].hint} from today's model`);
  frameTip.hidden = true;
  frameStatus.hidden = !isModel;
  frameStatus.textContent = "Loading model…";
  if (!viewer && !isModel) frameImg.src = url;
  frameImg.hidden = !!viewer || isModel;

  viewerReady.then(async (v) => {
    if (!v) {
      if (isModel) frameStatus.textContent = "This model couldn't be displayed. Your browser may not support WebGL.";
      return;
    }
    try {
      const opts = { animate, onLoaded: () => (frameStatus.hidden = true) };
      if (!(await (isModel ? v.showModel(url, opts) : v.showImage(url, opts))) || viewing !== n) return;
      frameImg.hidden = true;
      frameStatus.hidden = true;
      frameTip.hidden = false;
    } catch {
      frameStatus.hidden = false;
      frameStatus.textContent = isModel ? "This model couldn't be loaded." : "This hint couldn't be loaded.";
    }
  });
}

// ---- Guess board ------------------------------------------------------------

const RESULT_TEXT = { correct: "Correct", platform: "Right platform", wrong: "Wrong", skip: "Skipped" };

function renderBoard() {
  const board = $("#board");
  board.replaceChildren(
    ...Array.from({ length: MAX_GUESSES }, (_, i) => {
      const g = state.guesses[i];
      const row = h("li", `slot ${g ? g.result : i === state.guesses.length && state.status === "playing" ? "current" : "empty"}`);
      row.append(h("span", "slot-n", String(i + 1)));
      row.append(h("span", "slot-title", g ? g.title : i === state.guesses.length && state.status === "playing" ? "Your guess" : ""));
      if (g) row.append(h("span", "slot-tag", RESULT_TEXT[g.result]));
      return row;
    }),
  );
}

// ---- Search combobox ----------------------------------------------------------

const input = $<HTMLInputElement>("#guess-input");
const list = $("#guess-list");
const submit = $<HTMLButtonElement>("#guess-submit");
let matches: Game[] = [];
let active = -1;

function renderMatches() {
  const guessed = new Set(state.guesses.map((g) => g.gameId));
  matches = search(catalog, input.value).filter((g) => !guessed.has(g.id));
  list.replaceChildren(
    ...matches.map((g, i) => {
      const li = h("li", "option");
      li.id = `opt-${i}`;
      li.role = "option";
      li.setAttribute("aria-selected", String(i === active));
      li.append(h("span", "opt-title", g.title), h("span", "opt-platform", g.platforms.join(" · ")));
      li.onpointerdown = (e) => (e.preventDefault(), choose(g));
      return li;
    }),
  );
  const open = matches.length > 0 && document.activeElement === input && selected?.title !== input.value;
  list.hidden = !open;
  input.setAttribute("aria-expanded", String(open));
  input.setAttribute("aria-activedescendant", active >= 0 && open ? `opt-${active}` : "");
}

function choose(g: Game) {
  selected = g;
  input.value = g.title;
  active = -1;
  submit.disabled = false;
  renderMatches();
}

input.addEventListener("input", () => {
  selected = catalog.find((g) => g.title.toLowerCase() === input.value.trim().toLowerCase()) ?? null;
  submit.disabled = !selected;
  active = -1;
  renderMatches();
});
input.addEventListener("focus", renderMatches);
input.addEventListener("blur", () => (list.hidden = true));
input.addEventListener("keydown", (e) => {
  if (list.hidden || !matches.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    renderMatches();
  } else if (e.key === "Enter" && active >= 0) {
    e.preventDefault();
    choose(matches[active]);
  } else if (e.key === "Escape") {
    list.hidden = true;
  }
});

function play(game: Game | null) {
  state = submitGuess(state, puzzle, answerId, game);
  saveGame(saveKey, state);
  viewing = unlockedStage(state);
  selected = null;
  input.value = "";
  submit.disabled = true;
  render(true);
  if (state.status === "won") {
    winSound();
    confetti($("#frame").getBoundingClientRect());
  }
  if (state.status !== "playing") $("#result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$<HTMLFormElement>("#guess-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (selected) play(selected);
});
$("#guess-skip").onclick = () => play(null);

// ---- Result card ---------------------------------------------------------------

let countdown = 0;

function renderResult() {
  const done = state.status !== "playing";
  $("#guess-form").hidden = done;
  $("#result").hidden = !done;
  if (!done) return;

  $("#result-head").textContent = state.status === "won"
    ? `Got it in ${state.guesses.length} ${state.guesses.length === 1 ? "guess" : "guesses"}.`
    : "Out of guesses.";
  $("#answer-game").textContent = puzzle.game;
  $("#answer-meta").textContent = `${puzzle.name} · ${puzzle.category} · ${puzzle.platform} · ${puzzle.textureCount} textures`;
  const credit = $("#answer-credit");
  credit.replaceChildren(`Ripped by ${puzzle.credit ?? "an uncredited contributor"} for The Models Resource`);
  if (puzzle.sourceUrl) {
    const a = h("a", undefined, "View on The Models Resource");
    a.href = puzzle.sourceUrl;
    a.target = "_blank";
    a.rel = "noopener";
    credit.append(" · ", a);
  }
  $("#share-preview").textContent = shareText(state, label);

  clearInterval(countdown);
  const next = $("#next");
  if (practice) {
    next.textContent = "Practice puzzle. Your daily streak isn't affected.";
    return;
  }
  const tick = () => {
    const s = Math.floor(msUntilNext() / 1000);
    next.textContent = `Next puzzle in ${[s / 3600, (s % 3600) / 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, "0")).join(":")}`;
  };
  tick();
  countdown = window.setInterval(tick, 1000);
}

$("#share").onclick = async () => {
  const text = `${shareText(state, label)}\n${location.origin}`;
  const note = $("#share-note");
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = "Copied to clipboard";
  } catch {
    note.textContent = "Couldn't copy. Select the text above instead.";
  }
};

// ---- Dialogs -------------------------------------------------------------------

function renderStats() {
  const s = stats(today);
  const nums: [string, string | number][] = [
    ["Played", s.played],
    ["Win %", s.played ? Math.round((s.wins / s.played) * 100) : 0],
    ["Streak", s.streak],
    ["Best", s.best],
  ];
  $("#stat-nums").replaceChildren(
    ...nums.map(([k, v]) => {
      const d = h("div", "stat");
      d.append(h("b", undefined, String(v)), h("span", undefined, k));
      return d;
    }),
  );
  const max = Math.max(1, ...s.dist);
  $("#stat-dist").replaceChildren(
    ...s.dist.map((count, i) => {
      const row = h("div", "dist-row");
      const bar = h("span", "dist-bar", String(count));
      bar.style.width = `${Math.max(8, (count / max) * 100)}%`;
      if (state.status === "won" && !practice && state.guesses.length === i + 1) bar.classList.add("today");
      row.append(h("span", "dist-n", String(i + 1)), bar);
      return row;
    }),
  );
}

for (const [btn, dlg] of [["#open-help", "#help"], ["#open-stats", "#stats"]] as const) {
  $(btn).onclick = () => {
    if (dlg === "#stats") renderStats();
    $<HTMLDialogElement>(dlg).showModal();
  };
}
const soundBtn = $<HTMLButtonElement>("#toggle-sound");
const renderSound = () => {
  const muted = isMuted();
  soundBtn.setAttribute("aria-pressed", String(!muted));
  soundBtn.setAttribute("aria-label", muted ? "Turn sound on" : "Turn sound off");
  $("#icon-sound-on").toggleAttribute("hidden", muted);
  $("#icon-sound-off").toggleAttribute("hidden", !muted);
};
soundBtn.onclick = () => (setMuted(!isMuted()), renderSound());
renderSound();

document.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog")!.close()));

// ---- Dev tools: jump to any puzzle --------------------------------------------

if (import.meta.env.DEV) {
  const bar = $("#dev");
  bar.hidden = false;
  const select = $<HTMLSelectElement>("#dev-puzzle");
  select.append(new Option("Today's daily puzzle", ""));
  for (const p of puzzles) select.append(new Option(`${p.game} — ${p.name}`, p.id, false, p.id === practiceId));
  select.onchange = () => (location.search = select.value ? `?practice=${select.value}` : "");
  $("#dev-reset").onclick = () => {
    saveGame(saveKey, newGame(puzzle.id));
    location.reload();
  };
}

function render(animate = false) {
  renderStage(animate);
  renderBoard();
  renderResult();
}

render();
try {
  if (!localStorage.getItem("texturdle:seen-help")) {
    localStorage.setItem("texturdle:seen-help", "1");
    $<HTMLDialogElement>("#help").showModal();
  }
} catch {
  // Storage unavailable; skip the first-visit help.
}
