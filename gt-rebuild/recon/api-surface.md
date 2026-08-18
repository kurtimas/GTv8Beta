# Grain Tracker v2 — Backend API Surface (authoritative, from repo code)

Repo: github.com/kurtimas/GTv8Beta, app dir = `app/`. tRPC v11 + superjson at `/api/trpc`.
Router root: `appRouter` = { ping, core, people, sheets, sync }.
Shared view types live in `contracts/types.ts` (alias `@contracts`). Grain math in
`contracts/grain.ts` (CROPS, BUSHEL_WEIGHT_LBS, BASE_MOISTURE_PCT, computeBushels, fmtLbs, fmtBu).
Lot codes: `contracts/lotCode.ts` (LOT_CODE_PREFIX "706C", farmInitials, nextLotCode).

## ping
- `ping.query()` -> { ok: boolean, ts: number }

## core
- `core.sites.list.query()` -> Site[] (id, name, location, createdAt)
- `core.sites.create.mutate({ name, location? })` -> Site
- `core.bins.list.query()` -> BinRow[] (id, siteId, name, crop, capacityLbs, currentLbs, createdAt, siteName)
- `core.bins.create.mutate({ siteId, name, crop: CROPS enum, capacityLbs: int>0 })` -> Bin
- `core.bins.update.mutate({ id, name?, crop?, capacityLbs? })` -> Bin
- `core.bins.delete.mutate({ id })` -> { ok } (refuses if currentLbs>0 or load history; throws Error with message)
- `core.bins.adjust.mutate({ id, currentLbs: int>=0 })` -> Bin (manual level correction)

## people
- `people.farmers.list.query()` -> Farmer[] (id, name, phone, email, createdAt)
- `people.farmers.create.mutate({ name, phone?, email? })` -> Farmer
- `people.farmers.update.mutate({ id, name?, phone?, email? })` -> Farmer
- `people.landlords.list.query()` -> Landlord[] (id, name, phone, createdAt)
- `people.landlords.create.mutate({ name, phone? })` -> Landlord
- `people.lots.list.query()` -> LotRow[] (id, farmerId, landlordId, code, crop, landlordSplitPct,
  status OPEN|CLOSED, notes, createdAt, closedAt, farmerName, landlordName)
- `people.lots.nextCode.query({ farmerId })` -> { code }  (suggested code 706C-INITIALS-YY NN)
- `people.lots.create.mutate({ farmerId, landlordId?, code, crop, landlordSplitPct=0, notes? })` -> Lot
- `people.lots.update.mutate({ id, landlordId?, landlordSplitPct?, notes? })` -> Lot
- `people.lots.setStatus.mutate({ id, status: OPEN|CLOSED })` -> Lot

## sheets  (SheetRow/LoadRow shapes: see contracts/types.ts)
- `sheets.list.query({ search?, farmerId?, lotId?, landlordId?, crop?, status?, dateFrom?, dateTo?, limit? }?)`
  -> SheetRow[] (archive search; loads NOT included)
- `sheets.open.query()` -> SheetRow[] WITH loads[] (open queue, oldest first)
- `sheets.get.query({ id })` -> { sheet: SheetRow WITH loads[], events: SheetEventRow[] }
- `sheets.create.mutate({ siteId, lotId?, farmerId?, crop?, direction=INBOUND, notes? })`
  -> { id, ticketNo }. INBOUND requires lotId (lot must be OPEN). OUTBOUND may omit lot
  but then farmerId + crop required. Throws with helpful messages.
- `sheets.weighFirst.mutate({ id, weightLbs: int>0, truckId?, driverName?, binId? })`
  -> { ok, loadId, loadNo }. INBOUND: records gross; OUTBOUND: records tare (empty).
  Errors: sheet closed/full, a load still mid-weigh, maxLoads (10) reached.
- `sheets.weighSecond.mutate({ id, weightLbs: int>0, binId? })`
  -> { ok, netLbs, netBushels, sheetFull }. Completes the active load, updates bin inventory
  (auto-picks bin at site for crop with room if none chosen), auto-closes sheet when FULL.
- `sheets.updateLoadWeights.mutate({ loadId, grossLbs, tareLbs, changeReason: min 3 chars })`
  -> { ok, netLbs } (rebalances bin inventory; audited)
- `sheets.updateLoadGrades.mutate({ loadId, moisturePct: 0-60|null, dockagePct: 0-50|null,
  testWeightLbs: 0-80|null, proteinPct: 0-30|null })` -> { ok, grossBushels?, shrinkPct?, netBushels? }
  (recomputes bushels if load completed)
- `sheets.assignLoadBin.mutate({ loadId, binId: number|null })` -> { ok } (rebalances inventory)
- `sheets.voidLoad.mutate({ loadId })` -> { ok } (reverses bin movement; re-opens FULL sheet)
- `sheets.close.mutate({ id })` -> { ok } (manual early close; refused while load mid-weigh)
- `sheets.truckTares.query()` -> [{ truckId, avgTare, loads, minTare, maxTare }]
- `sheets.recentActivity.query({ limit=25 }?)` -> [SheetEventRow & { ticketNo }]
- `sheets.closeDay.mutate()` -> { closed: number, office: SyncResult|null }
  (closes all OPEN sheets w/ reason EOD; pushes EOD to office if configured; never blocked by sync)
- `sheets.dailyReport.query({ date?: "YYYY-MM-DD" }?)` -> {
    date: Date, sheetCount, loadCount, completedCount,
    inboundLbs, outboundLbs, inboundBu, outboundBu,
    byCrop: [{ crop, lbs, bu, count }], byFarmer: [{ farmer, lbs, bu, count }],
    bins: BinRow[], loads: ReportLoadRow[] }

## sync
- `sync.getSettings.query()` -> { officeUrl: string, officeKey: string }
- `sync.setSettings.mutate({ officeUrl, officeKey })` -> { ok }
- `sync.status.query()` -> sync_log rows (id, direction PUSH|PULL|RECEIVE, status OK|ERROR, detail, createdAt), last 12
- `sync.syncNow.mutate()` -> { pull: SyncResult, push: SyncResult }  (SyncResult = { ok, detail, ... })

## Behavior rules the UI must honor (from Startup Guide + router logic)
- Scale: Web Serial API (Chrome/Edge only), HTTPS or localhost required. 9600 8N1 continuous
  ASCII like `NT 12500 lb`. Simulator slider when no scale. Manual entry box.
- Sheet lifecycle: OPEN -> (10 loads) FULL (auto) | CLOSED (manual / EOD). Closed = locked.
- Weigh flow: big WEIGH IN then WEIGH OUT buttons; truck/driver prefill from lastTruckId;
  truckTares offers known tare weights.
- Grades (moisture/dockage/TW/protein) entered per load after weighing; net bushels recalc
  live using computeBushels for preview (backend recomputes authoritatively).
- Corrections need a change reason (audit-logged). Events feed = audit trail.
- Daily report + "Close day" in Reports. First-run: create site, bins, farmers, lots.

## Existing files (DO NOT rewrite): main.tsx (imports `@/providers/trpc` -> named export
TRPCProvider), App.tsx (imports ./components/Layout default, ./pages/{Dashboard,Sheets,Bins,
People,Reports,NotFound} defaults), index.css (dark console theme + .day mode + tokens
--live/--go/--crit/--readout), tailwind.config.js, vite.config.ts (outDir dist/public,
aliases @ @contracts @db), index.html (title Grain Tracker v2, Inter + JetBrains Mono fonts).

## Missing backend glue to reconstruct
- `api/lib/env.ts` — used by boot.ts: `env.isProduction`. Read process.env: NODE_ENV,
  DATABASE_URL, APP_ID, APP_SECRET, SEED_DEMO, PORT. Export const env.
- `api/lib/vite.ts` — `serveStaticFiles(app: Hono)` serves dist/public with SPA fallback
  (use @hono/node-server/serve-static; root ./dist/public; index.html fallback for non-/api GETs).
- `api/queries/connection.ts` — exports initDb(), getDb(), isOffline().
  MySQL: mysql2/promise pool from DATABASE_URL, drizzle-orm/mysql2 w/ schema, retry connect
  ~30s (Docker mysql healthcheck), CREATE TABLE IF NOT EXISTS for all 11 tables (MySQL DDL).
  Offline fallback: better-sqlite3 at data/grain-tracker-offline.db + drizzle-orm/better-sqlite3
  + sqlite mirror schema (new file db/sqliteSchema.ts, same table/column names, sqlite-core types),
  same CREATE TABLE IF NOT EXISTS (SQLite DDL). isOffline() true when fell back.
  Routers use db.query.<table>.findFirst / select/insert/update/delete + .$returningId() —
  NOTE: $returningId is MySQL-only; offline path must shim or accept divergence (original did;
  offline is dev-only fallback — cast to the MySQL db type; runtime offline only needs
  select/insert basic ops used by seed + routers' query paths).
- Generate `db/migrations/**` via `npx drizzle-kit generate` (drizzle.config.ts present) so
  migrateOnBoot's migrate() works; initDb DDL is the belt-and-suspenders for first boot.

## Frontend to rebuild under app/src/
- lib/utils.ts (cn), lib/trpc.ts (createTRPCReact<AppRouter>, import type from ../../api/router),
  lib/format.ts optional helpers re-exporting fmtLbs/fmtBu from @contracts/grain.
- providers/trpc.tsx — named export TRPCProvider (QueryClientProvider + trpc.Provider,
  httpBatchLink /api/trpc + superjson; QueryClient with sensible defaults: retry 1, refetchOnWindowFocus false).
- hooks/useScale.ts — Web Serial wrapper + simulator + manual entry; constants: BAUD_RATE=9600.
- components/Layout.tsx — default export; dark console ops layout: left nav (Dashboard, Sheets,
  Bins, Farmers & Lots=/people, Reports), header w/ app name + day/console theme toggle
  (.day class on <html>) + connection banner when ping fails ("cannot reach the server").
- components/ui/* — shadcn new-york subset actually used: button, card, input, label, select,
  table, tabs, badge, dialog, textarea, skeleton, slider, separator, sonner(Toaster+toast), alert.
- pages/Dashboard.tsx — live scale readout (JetBrains Mono, huge), Connect USB scale /
  Simulator toggle / manual entry; open sheet queue cards (sheets.open) w/ farmer, lotCode,
  crop, loads x/10, activeLoad state; per-sheet WEIGH IN / WEIGH OUT capturing current scale
  weight; New Sheet dialog (site select, lot select filtered OPEN, or outbound farmer+crop);
  Recent activity feed (sheets.recentActivity).
- pages/Sheets.tsx — archive: filters (search, farmer, lot, crop, status, date from/to),
  result table; expandable/detail dialog per sheet: loads table w/ per-load grades editor,
  weight correction (reason required), bin assign, void load, close sheet; events audit list.
- pages/Bins.tsx — sites & bins: add site; add bin (crop select, capacity bushels -> lbs via
  BUSHEL_WEIGHT_LBS helper); bin cards w/ fill % progress; edit, adjust level, delete (empty only).
- pages/People.tsx — tabs Farmers | Landlords | Lots. Farmers add/edit (name phone email);
  Landlords add; Lots create (farmer select -> nextCode suggestion editable, crop, optional
  landlord + split %, notes), list w/ status badge + open/close toggle.
- pages/Reports.tsx — date input; dailyReport cards (sheets, loads, in/out lbs+bu), byCrop &
  byFarmer tables, bins snapshot, loads ledger table; Close day button (confirm dialog ->
  sheets.closeDay); Sync section (get/set settings, sync now, status log).
- pages/NotFound.tsx — simple 404 w/ link home.
- Styling: dark console default (tokens already in index.css); amber primary, cyan live,
  green go; JetBrains Mono for weights/ticket numbers; Inter elsewhere. Extend
  tailwind.config.js colors with live/go/crit/readout mapped to the CSS vars.
