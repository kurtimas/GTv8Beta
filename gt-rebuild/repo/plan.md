# Plan — Main Office / Admin Portal + Site Sync

## Goal
Separate "main office" portal instance (no scale UI) that:
1. Masters farmer / landlord / lot data → sites pull it down (lots entered at office become available at each scale house).
2. Receives end-of-day uploads from each site → admin views sheets, loads, bin %, EOD totals across sites.

## Architecture (chosen defaults)
- Two independent deployments of the same stack (React+Vite+tRPC+Drizzle, MySQL or embedded SQLite offline):
  - `/mnt/agents/output/app` — scale-house instance (existing).
  - `/mnt/agents/output/office` — new office portal (copy, scale UI removed).
- Sync over plain HTTP JSON with shared-secret header `x-gt-sync-key` (office env `SYNC_KEY`; if unset, dev-open).
- **Site → Office**: `POST /api/sync/eod` — full-day package (site, bins snapshot, people snapshot, sheets+loads, totals). Idempotent upsert: sheets keyed by (siteName, ticketNo); loads replaced per sheet; bins by (site,name); eod_reports by (site, day).
- **Office → Site**: `GET /api/sync/people` — office-mastered farmers/landlords/lots. Site upserts by name / lot code (local IDs preserved; office farmer+landlord names mapped to local rows).
- Triggers on site: automatic push after Close Day (fire-and-forget, logged) + manual "Sync now" (push today + pull people) from a Reports-page card. Office URL/key stored server-side in a `settings` table.

## Stage 1 — Site app changes (orchestrator)
- schema.ts: add `settings` (key/value), `syncLog`; keep DDL + MySQL migration 0002 in both projects.
- api/officeSync.ts: `pushEod()`, `pullPeople()`, status helpers.
- api/syncRouter.ts: getSettings/setSettings/status/syncNow.
- sheetsRouter.closeDay: after closing, auto-push (catch+log).
- Reports.tsx: "Main office sync" card (URL, key, last status, Sync now).
- db/migrations/0002_sync_tables.sql + offline DDL update.

## Stage 2 — Office portal (coder subagent, parallel)
- Copy app → /mnt/agents/output/office (hardlink node_modules).
- Remove scale home; new OfficeHome: site cards (last upload, today sheets/loads, per-site bin % bars + overall), recent sheets feed.
- Add api/syncReceiveRouter.ts (eod + people endpoints) + schema: eodReports, syncLog (same settings/syncLog/eodReports tables as site for aligned migrations).
- Reports page = EOD history per site/day. Sheets/Bins/People pages stay (People is the master-data input section). Remove Web Serial/scale components from nav/routes only.
- Office seed: 2 sites with bins + master people/lots + a couple of mirrored sheets so the demo is browsable; SEED_DEMO=false escape hatch preserved.
- Dockerfile + build green.

## Stage 3 — Integration test (orchestrator)
- Office on :3200 (offline SQLite), site on :3100.
- curl: set site settings → syncNow → assert office has site sheets/bins/eod; create lot on office → syncNow → assert lot on site.
- Edge cases: second sync (idempotent), wrong key rejected, office down → logged error, app still works.

## Stage 4 — Deliver
- npm run build in both projects; versions saved for both project dirs; concise summary for non-technical user (what runs where, what to enter: office URL + key).
