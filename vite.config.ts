import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const ROOT = import.meta.dirname;
const REVIEW = path.join(ROOT, "data/review");
const OVERRIDES = path.join(ROOT, "data/overrides.json");
const PUZZLES = path.join(ROOT, "web/public/puzzles");

const readJson = (file: string, fallback: unknown) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);

/**
 * Dev-server endpoints for the review page (web/review.html). Not part of the production build.
 *   GET  /__review/report         build report + current review status per model
 *   GET  /__review/preview/<id>   Blender preview render
 *   POST /__review/decide         { id, status: "approved" | "rejected" | null, rotateX? }
 */
function reviewApi(): Plugin {
  return {
    name: "texturdle-review",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__review", (req, res) => {
        const send = (code: number, body: unknown, type = "application/json") => {
          res.statusCode = code;
          res.setHeader("Content-Type", type);
          res.setHeader("Cache-Control", "no-store");
          res.end(type === "application/json" ? JSON.stringify(body) : (body as Buffer));
        };
        const url = (req.url ?? "/").split("?")[0];

        if (req.method === "GET" && url.startsWith("/report")) {
          const report = readJson(path.join(REVIEW, "report.json"), {}) as Record<string, object>;
          const overrides = readJson(OVERRIDES, {}) as Record<string, Record<string, unknown>>;
          const built = new Set((readJson(path.join(PUZZLES, "index.json"), []) as { id: string }[]).map((p) => p.id));
          const rows = Object.entries(report).map(([id, r]) => ({
            id,
            ...r,
            built: built.has(id),
            status: overrides[id]?.status ?? null,
            rotateX: overrides[id]?.rotateX ?? 0,
            hasPreview: fs.existsSync(path.join(REVIEW, `${id}.png`)),
          }));
          return send(200, rows);
        }

        if (req.method === "GET" && url.startsWith("/preview/")) {
          const id = decodeURIComponent(url.slice("/preview/".length)).replace(/[^a-z0-9-]/g, "");
          const file = path.join(REVIEW, `${id}.png`);
          return fs.existsSync(file) ? send(200, fs.readFileSync(file), "image/png") : send(404, { error: "No preview" });
        }

        if (req.method === "POST" && url.startsWith("/decide")) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => {
            const { id, status, rotateX } = JSON.parse(body || "{}");
            if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) return send(400, { error: "Bad id" });
            const overrides = readJson(OVERRIDES, {}) as Record<string, Record<string, unknown>>;
            const entry = { ...(overrides[id] ?? {}) };
            if (status === null) delete entry.status;
            else if (status === "approved" || status === "rejected") entry.status = status;
            if (typeof rotateX === "number") {
              if (rotateX) entry.rotateX = rotateX;
              else delete entry.rotateX;
            }
            if (Object.keys(entry).length) overrides[id] = entry;
            else delete overrides[id];
            fs.writeFileSync(OVERRIDES, JSON.stringify(overrides, null, 2) + "\n");

            // A rejection takes the puzzle out of the game straight away.
            if (status === "rejected") {
              const indexFile = path.join(PUZZLES, "index.json");
              const index = readJson(indexFile, []) as { id: string }[];
              fs.writeFileSync(indexFile, JSON.stringify(index.filter((p) => p.id !== id), null, 2));
              fs.rmSync(path.join(PUZZLES, id), { recursive: true, force: true });
            }
            send(200, { ok: true, entry });
          });
          return;
        }
        send(404, { error: "Unknown review endpoint" });
      });
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [reviewApi()],
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 700 },
});
