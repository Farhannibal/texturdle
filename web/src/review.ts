// Dev-only review page: approve or reject freshly built puzzles. Talks to the review
// endpoints in vite.config.ts, which write decisions into data/overrides.json.
import "./style.css";
import type { Viewer } from "./viewer";

interface Row {
  id: string;
  platform: string;
  game: string;
  category: string;
  name: string;
  zip: string;
  flags: string[];
  error?: string;
  stats?: { textures: number; triangles: number; kb: number; fill: number };
  built: boolean;
  status: "approved" | "rejected" | null;
  rotateX: number;
  hasPreview: boolean;
  builtAt: string;
}

type Filter = "todo" | "flagged" | "approved" | "rejected" | "failed" | "all";
const FILTERS: [Filter, string][] = [
  ["todo", "Needs review"],
  ["flagged", "Flagged"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["failed", "Failed"],
  ["all", "All"],
];
const ROTATIONS = [0, 90, 180, -90];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

let rows: Row[] = [];
let filter: Filter = "todo";
let focused = 0;

// ---- Live viewer for the selected model (the same viewer the game uses) ----
let viewer: Viewer | null = null;
let shownKey = "";
const stageStatus = document.getElementById("rv-stage-status")!;

async function showSelected() {
  const r = rows.filter((x) => matches(x, filter))[focused];
  const key = r ? `${r.id}@${r.builtAt}@${r.built}` : "";
  if (key === shownKey) return;
  shownKey = key;
  document.getElementById("rv-sel-title")!.textContent = r ? `${r.game}: ${r.name}` : "Nothing selected";
  document.getElementById("rv-sel-sub")!.textContent = r ? `${r.category} · ${r.platform}` : "";
  if (!r) return void (stageStatus.textContent = "Select a model to load it here.");
  if (!r.built) {
    stageStatus.hidden = false;
    stageStatus.textContent = r.error ? "This model failed to build." : "Not built. Rebuild it to view it here.";
    return;
  }
  stageStatus.hidden = false;
  stageStatus.textContent = "Loading model…";
  try {
    viewer ??= (await import("./viewer")).createViewer(document.getElementById("rv-3d")!);
    const shown = await viewer.showModel(`/puzzles/${r.id}/model.glb?t=${encodeURIComponent(r.builtAt)}`);
    if (shown && shownKey === key) stageStatus.hidden = true;
  } catch (err) {
    if (shownKey !== key) return;
    stageStatus.hidden = false;
    stageStatus.textContent = `The game's viewer couldn't load this model: ${(err as Error).message ?? err}`;
  }
}

const matches = (r: Row, f: Filter) =>
  f === "all" ||
  (f === "todo" && !r.status && !r.error) ||
  (f === "flagged" && !r.status && r.flags.length > 0) ||
  (f === "failed" && !!r.error) ||
  r.status === f;

async function load() {
  rows = await fetch("/__review/report").then((r) => r.json());
  // Flagged and failed first, then newest builds, so problems surface at the top.
  rows.sort((a, b) => Number(!!b.error) - Number(!!a.error) || b.flags.length - a.flags.length || b.builtAt.localeCompare(a.builtAt));
  render();
}

async function decide(row: Row, change: { status?: Row["status"]; rotateX?: number }) {
  const res = await fetch("/__review/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: row.id, status: change.status === undefined ? row.status : change.status, rotateX: change.rotateX }),
  });
  if (!res.ok) return alertCard(row, "Couldn't save that. Is the dev server running?");
  if (change.status !== undefined) row.status = change.status;
  if (change.rotateX !== undefined) row.rotateX = change.rotateX;
  if (change.status === "rejected") row.built = false;
  render();
}

function alertCard(row: Row, msg: string) {
  const card = document.querySelector(`[data-id="${row.id}"] .rv-note`);
  if (card) card.textContent = msg;
}

function render() {
  const counts = Object.fromEntries(FILTERS.map(([f]) => [f, rows.filter((r) => matches(r, f)).length])) as Record<Filter, number>;
  document.getElementById("rv-summary")!.textContent =
    `${rows.length} models · ${counts.approved} approved · ${counts.rejected} rejected · ${counts.todo} to review · ${counts.failed} failed`;

  document.getElementById("rv-filters")!.replaceChildren(
    ...FILTERS.map(([f, label]) => {
      const b = h("button", "chip", `${label} ${counts[f]}`);
      b.type = "button";
      b.setAttribute("aria-pressed", String(f === filter));
      b.onclick = () => ((filter = f), (focused = 0), render());
      return b;
    }),
  );

  const visible = rows.filter((r) => matches(r, filter));
  focused = Math.min(focused, Math.max(0, visible.length - 1));
  const grid = document.getElementById("rv-grid")!;
  if (!visible.length) {
    grid.replaceChildren(h("p", "rv-empty muted", rows.length ? "Nothing here. Pick another filter." : "No build report yet. Run npm run puzzles first."));
    return;
  }
  grid.replaceChildren(...visible.map((r, i) => card(r, i === focused)));
  showSelected();
}

function card(r: Row, isFocused: boolean) {
  const c = h("article", `rv-card${r.status ? " " + r.status : ""}${r.error ? " failed" : ""}${isFocused ? " focused" : ""}`);
  c.dataset.id = r.id;
  c.tabIndex = -1;
  c.onclick = (e) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    focused = rows.filter((x) => matches(x, filter)).indexOf(r);
    render();
  };

  const pics = h("div", "rv-pics");
  const shot = (src: string | null, alt: string, label: string) => {
    const f = h("figure", "rv-pic");
    if (src) {
      const img = h("img");
      img.src = src;
      img.alt = alt;
      img.loading = "lazy";
      f.append(img);
    } else f.append(h("span", "muted", "No image"));
    f.append(h("figcaption", undefined, label));
    return f;
  };
  pics.append(
    shot(r.hasPreview ? `/__review/preview/${r.id}?t=${encodeURIComponent(r.builtAt)}` : null, `${r.name} model`, "Model"),
    shot(r.built ? `/puzzles/${r.id}/hint4.png?t=${encodeURIComponent(r.builtAt)}` : null, `${r.name} textures`, "Textures"),
  );

  const title = h("div", "rv-title");
  title.append(h("h2", undefined, r.game), h("p", "muted", `${r.name} · ${r.category} · ${r.platform}`));

  const meta = h("p", "rv-stats muted");
  meta.textContent = r.stats
    ? `${r.stats.textures} texture${r.stats.textures === 1 ? "" : "s"} · ${r.stats.triangles.toLocaleString()} triangles · ${r.stats.kb.toLocaleString()} KB · sheet ${r.stats.fill}% filled${r.rotateX ? ` · rotated ${r.rotateX}°` : ""}`
    : r.zip;

  const flags = h("ul", "rv-flags");
  if (r.error) flags.append(h("li", "err", r.error));
  for (const f of r.flags) flags.append(h("li", undefined, f));

  const status = h("span", `rv-status ${r.status ?? "todo"}`, r.status === "approved" ? "Approved" : r.status === "rejected" ? "Rejected" : r.error ? "Failed" : "To review");

  const actions = h("div", "rv-actions");
  const btn = (label: string, cls: string, fn: () => void, disabled = false) => {
    const b = h("button", cls, label);
    b.type = "button";
    b.disabled = disabled;
    b.onclick = fn;
    return b;
  };
  actions.append(
    btn(r.status === "approved" ? "Undo approve" : "Approve", "rv-approve", () => decide(r, { status: r.status === "approved" ? null : "approved" }), !!r.error),
    btn(r.status === "rejected" ? "Undo reject" : "Reject", "rv-reject", () => decide(r, { status: r.status === "rejected" ? null : "rejected" })),
    btn("Rotate", "rv-rotate", () => decide(r, { rotateX: ROTATIONS[(ROTATIONS.indexOf(r.rotateX) + 1) % ROTATIONS.length] })),
  );
  if (r.built) {
    const play = h("a", "rv-play", "Play");
    play.href = `/?practice=${r.id}`;
    play.target = "_blank";
    actions.append(play);
  }

  c.append(pics, title, meta, flags, status, actions, h("p", "rv-note muted"));
  if (r.rotateX && r.status !== "rejected") c.querySelector(".rv-note")!.textContent = "Rebuild to apply the rotation.";
  return c;
}

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const visible = rows.filter((r) => matches(r, filter));
  const r = visible[focused];
  const key = e.key.toLowerCase();
  if (key === "j" || key === "arrowdown") focused = Math.min(focused + 1, visible.length - 1);
  else if (key === "k" || key === "arrowup") focused = Math.max(focused - 1, 0);
  else if (!r) return;
  else if (key === "a" && !r.error) return void decide(r, { status: "approved" });
  else if (key === "r") return void decide(r, { status: "rejected" });
  else if (key === "t") return void decide(r, { rotateX: ROTATIONS[(ROTATIONS.indexOf(r.rotateX) + 1) % ROTATIONS.length] });
  else if (key === "p" && r.built) return void window.open(`/?practice=${r.id}`, "_blank");
  else return;
  e.preventDefault();
  render();
  document.querySelector(".rv-card.focused")?.scrollIntoView({ block: "nearest" });
});

load();
