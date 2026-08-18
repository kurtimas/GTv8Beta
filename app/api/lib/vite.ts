import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

// ---------------------------------------------------------------------------
// Production static hosting for the Vite build (vite.config.ts sets
// build.outDir = dist/public). Real files — hashed assets, favicon, etc. —
// are served directly; every other GET that is not under /api falls back to
// index.html so the React router can resolve the path client-side.
// (boot.ts registers all /api routes BEFORE calling this, so API requests
// never reach the fallback.)
// ---------------------------------------------------------------------------

export function serveStaticFiles(app: Hono<{ Bindings: HttpBindings }>) {
  const root = path.resolve(process.cwd(), "dist/public");

  // 1. serve any real file from the build output
  app.use("*", serveStatic({ root: "./dist/public" }));

  // 2. SPA fallback for client-side routes
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json({ error: "Not Found" }, 404);
    }
    return c.html(fs.readFileSync(path.join(root, "index.html"), "utf-8"));
  });
}
