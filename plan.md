# Plan — Rebuild Grain Tracker v2 Frontend (GTv8Beta)

Goal: reconstruct the missing frontend (`app/src/**`: pages, components, providers, hooks, lib)
so `npm run build` passes and the app runs against the existing Hono/tRPC/MySQL backend.
Deliverable: files pushed to github.com/kurtimas/GTv8Beta (branch main), plus VPS rebuild commands.

## Stage 1 — Backend recon (Orchestrator, local)
- Clone github.com/kurtimas/GTv8Beta to a local workspace.
- Read the full backend surface: api/router.ts, coreRouter.ts, sheetsRouter.ts, peopleRouter.ts,
  syncRouter.ts, context.ts, migrateOnBoot.ts, officeSync.ts; contracts/*.ts; db/schema.ts, seed.ts.
- Extract the API contract spec: every tRPC procedure (name, input, output), types, enums,
  business rules (bushel weights, moisture shrink, lot codes) -> `recon/api-surface.md`.

## Stage 2 — Frontend architecture (Orchestrator)
- Load skill: vibecoding-webapp-swarm (React+TS+Tailwind+shadcn guidance).
- Define file tree matching existing imports:
  - src/providers/trpc.tsx (exports TRPCProvider; required by main.tsx)
  - src/components/Layout.tsx, src/components/ui/* (shadcn, per info.md 40+ components)
  - src/pages/{Dashboard,Sheets,Bins,People,Reports,NotFound}.tsx (required by App.tsx)
  - src/hooks/useScale.ts (Web Serial API; 9600 8N1 continuous ASCII, per repo Startup Guide)
  - src/lib/* (trpc client, utils, formatting)
- Design tokens: low-saturation, warm, ample whitespace (no blue-purple gradients).

## Stage 3 — Swarm build (coder subagents, sequential batches)
- Batch A: foundation — lib/utils, trpc client + provider, shadcn ui set, types re-exports.
- Batch B: Layout + Dashboard (scale readout via useScale, open sheets queue) + Bins page.
- Batch C: Sheets (new weight sheet, weigh in/out, corrections) + People (farmers/landlords/lots).
- Batch D: Reports (daily report, close day) + NotFound + polish.
- Each batch must typecheck against backend contracts; no backend changes.

## Stage 4 — Local build gate (Orchestrator + verifier)
- npm ci && npm run build in app/ must pass clean (vite build + esbuild boot bundle).
- Fix-forward loop on any error until green.

## Stage 5 — Ship (Orchestrator)
- Push all new/changed files to GitHub (push_files, batched commits).
- Hand user the VPS commands: git pull && docker compose up -d --build; verify
  "[boot] database schema up to date" + http://<ip>:3000 Scale Dashboard.
