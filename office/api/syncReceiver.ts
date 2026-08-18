import { Hono } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./queries/connection";
import {
  bins,
  eodReports,
  farmers,
  landlords,
  loads,
  lots,
  sheetEvents,
  sites,
  syncLog,
  weightSheets,
} from "@db/schema";

// ---------------------------------------------------------------------------
// Main-office sync RECEIVER — plain Hono endpoints (not tRPC) that the scale
// houses push their end-of-day packages to, and pull office-mastered people
// data from. All writes are idempotent: re-receiving the same package
// upserts headers and rebuilds loads instead of duplicating rows.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;

// --------------------------------------------------------------- sync auth
let warnedNoKey = false;
function checkSyncKey(header: string | undefined): { ok: boolean } {
  const expected = process.env.SYNC_KEY;
  if (!expected) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn("[sync] SYNC_KEY is not set — accepting unauthenticated sync requests (dev mode)");
    }
    return { ok: true };
  }
  return { ok: header === expected };
}

// ------------------------------------------------------------- payload types
type PersonPayload = { name: string; phone: string | null; email?: string | null };
type LotPayload = {
  code: string;
  farmerName: string | null;
  landlordName: string | null;
  crop: string;
  landlordSplitPct: number;
  status: "OPEN" | "CLOSED";
  notes: string | null;
};
type BinPayload = { name: string; crop: string; capacityLbs: number; currentLbs: number };
type LoadPayload = {
  loadNo: number;
  truckId: string | null;
  driverName: string | null;
  binName: string | null;
  grossLbs: number | null;
  tareLbs: number | null;
  netLbs: number | null;
  grossAt: string | null;
  tareAt: string | null;
  moisturePct: number | null;
  dockagePct: number | null;
  testWeightLbs: number | null;
  proteinPct: number | null;
  shrinkPct: number | null;
  grossBushels: number | null;
  netBushels: number | null;
};
type SheetPayload = {
  ticketNo: string;
  farmerName: string | null;
  lotCode: string | null;
  landlordName: string | null;
  crop: string;
  direction: "INBOUND" | "OUTBOUND";
  status: "OPEN" | "FULL" | "CLOSED";
  closeReason: string | null;
  maxLoads: number;
  createdAt: string;
  closedAt: string | null;
  loads: LoadPayload[];
};
type EodPackage = {
  site: { name: string; location: string | null };
  day: string;
  farmers: PersonPayload[];
  landlords: PersonPayload[];
  lots: LotPayload[];
  bins: BinPayload[];
  sheets: SheetPayload[];
  totals: {
    sheetsOpened: number;
    loadCount: number;
    completedCount: number;
    inboundLbs: number;
    outboundLbs: number;
    inboundBu: number;
    outboundBu: number;
  };
};

const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

async function logReceive(db: Db, status: "OK" | "ERROR", detail: string) {
  try {
    await db.insert(syncLog).values({ direction: "RECEIVE", status, detail });
  } catch (err) {
    console.error("[sync] failed to write sync_log:", err);
  }
}

// ----------------------------------------------------------- upsert helpers
async function upsertSite(db: Db, name: string, location: string | null) {
  const existing = await db.query.sites.findFirst({ where: eq(sites.name, name) });
  if (existing) {
    await db.update(sites).set({ location }).where(eq(sites.id, existing.id));
    return existing.id;
  }
  const [{ id }] = await db.insert(sites).values({ name, location }).$returningId();
  return id;
}

async function upsertFarmer(db: Db, p: PersonPayload) {
  const existing = await db.query.farmers.findFirst({ where: eq(farmers.name, p.name) });
  if (existing) {
    await db
      .update(farmers)
      .set({ phone: p.phone ?? null, email: p.email ?? null })
      .where(eq(farmers.id, existing.id));
    return existing.id;
  }
  const [{ id }] = await db
    .insert(farmers)
    .values({ name: p.name, phone: p.phone ?? null, email: p.email ?? null })
    .$returningId();
  return id;
}

async function upsertLandlord(db: Db, p: PersonPayload) {
  const existing = await db.query.landlords.findFirst({ where: eq(landlords.name, p.name) });
  if (existing) {
    await db.update(landlords).set({ phone: p.phone ?? null }).where(eq(landlords.id, existing.id));
    return existing.id;
  }
  const [{ id }] = await db
    .insert(landlords)
    .values({ name: p.name, phone: p.phone ?? null })
    .$returningId();
  return id;
}

// ------------------------------------------------------------- receive EOD
async function receiveEod(pkg: EodPackage) {
  const db = getDb();
  if (!pkg?.site?.name) throw new Error("Invalid package: site.name is required");
  if (!pkg?.day) throw new Error("Invalid package: day is required");

  // 1. site
  const siteId = await upsertSite(db, pkg.site.name, pkg.site.location ?? null);

  // 2. people + lots (name-keyed masters)
  const farmerIdByName = new Map<string, number>();
  for (const f of pkg.farmers ?? []) farmerIdByName.set(f.name, await upsertFarmer(db, f));
  const landlordIdByName = new Map<string, number>();
  for (const l of pkg.landlords ?? []) landlordIdByName.set(l.name, await upsertLandlord(db, l));

  const lotIdByCode = new Map<string, number>();
  for (const lot of pkg.lots ?? []) {
    const farmerId = lot.farmerName ? farmerIdByName.get(lot.farmerName) : undefined;
    if (!farmerId) continue; // lot references a farmer not in the package — skip
    const landlordId =
      lot.landlordName != null ? (landlordIdByName.get(lot.landlordName) ?? null) : null;
    const existing = await db.query.lots.findFirst({ where: eq(lots.code, lot.code) });
    const patch = {
      farmerId,
      landlordId,
      crop: lot.crop,
      landlordSplitPct: lot.landlordSplitPct,
      status: lot.status,
      notes: lot.notes ?? null,
      ...(lot.status === "CLOSED" ? {} : { closedAt: null as Date | null }),
    };
    if (existing) {
      await db.update(lots).set(patch).where(eq(lots.id, existing.id));
      lotIdByCode.set(lot.code, existing.id);
    } else {
      const [{ id }] = await db
        .insert(lots)
        .values({ code: lot.code, closedAt: lot.status === "CLOSED" ? new Date() : null, ...patch })
        .$returningId();
      lotIdByCode.set(lot.code, id);
    }
  }

  // 3. bins (per site)
  const binIdByName = new Map<string, number>();
  for (const b of pkg.bins ?? []) {
    const existing = await db.query.bins.findFirst({
      where: and(eq(bins.siteId, siteId), eq(bins.name, b.name)),
    });
    const patch = { crop: b.crop, capacityLbs: b.capacityLbs, currentLbs: b.currentLbs };
    if (existing) {
      await db.update(bins).set(patch).where(eq(bins.id, existing.id));
      binIdByName.set(b.name, existing.id);
    } else {
      const [{ id }] = await db.insert(bins).values({ siteId, name: b.name, ...patch }).$returningId();
      binIdByName.set(b.name, id);
    }
  }

  // 4. sheets — upsert header by (siteId, ticketNo), then rebuild loads
  let sheetCount = 0;
  let loadCount = 0;
  for (const s of pkg.sheets ?? []) {
    if (!s.ticketNo) continue;
    let farmerId = s.farmerName ? farmerIdByName.get(s.farmerName) : undefined;
    if (!farmerId) {
      // farmer wasn't in the package — mirror with a stub so the sheet still
      // lands instead of erroring the whole upload
      const stubName = s.farmerName ?? `Unknown (${s.ticketNo})`;
      farmerId = await upsertFarmer(db, { name: stubName, phone: null });
      farmerIdByName.set(stubName, farmerId);
    }
    const resolvedFarmerId = farmerId;
    const lotId = s.lotCode ? (lotIdByCode.get(s.lotCode) ?? null) : null;
    const landlordId =
      s.landlordName != null ? (landlordIdByName.get(s.landlordName) ?? null) : null;

    // A previous upload may have stored this ticket under its disambiguated
    // `@S<siteId>` key (ticketNo is globally unique and can clash across site
    // instances) — match BOTH keys so re-uploads update instead of colliding.
    const suffixed = `${s.ticketNo}@S${siteId}`.slice(0, 32);
    const existing = await db.query.weightSheets.findFirst({
      where: and(
        eq(weightSheets.siteId, siteId),
        inArray(weightSheets.ticketNo, [s.ticketNo, suffixed]),
      ),
    });
    const header = {
      farmerId: resolvedFarmerId,
      lotId,
      landlordId,
      crop: s.crop,
      direction: s.direction,
      status: s.status,
      closeReason: s.closeReason ?? null,
      maxLoads: s.maxLoads ?? 10,
      createdAt: toDate(s.createdAt) ?? new Date(),
      closedAt: toDate(s.closedAt),
    };

    let sheetId: number;
    if (existing) {
      await db.update(weightSheets).set(header).where(eq(weightSheets.id, existing.id));
      sheetId = existing.id;
      // replace mirrored rows wholesale — keeps re-uploads clean
      await db.delete(loads).where(eq(loads.sheetId, sheetId));
      await db.delete(sheetEvents).where(eq(sheetEvents.sheetId, sheetId));
    } else {
      // ticketNo is globally unique in the shared schema; a collision with a
      // DIFFERENT site means two site instances reuse the same ticket series —
      // disambiguate deterministically instead of failing the upload.
      let ticketNo = s.ticketNo;
      const clash = await db.query.weightSheets.findFirst({
        where: eq(weightSheets.ticketNo, ticketNo),
      });
      if (clash) {
        ticketNo = suffixed;
        console.warn(
          `[sync] ticket ${s.ticketNo} already exists at another site — stored as ${ticketNo}`,
        );
      }
      const [{ id }] = await db
        .insert(weightSheets)
        .values({ ticketNo, siteId, notes: null, ...header })
        .$returningId();
      sheetId = id;
    }

    for (const l of s.loads ?? []) {
      await db.insert(loads).values({
        sheetId,
        loadNo: l.loadNo,
        truckId: l.truckId ?? null,
        driverName: l.driverName ?? null,
        binId: l.binName ? (binIdByName.get(l.binName) ?? null) : null,
        grossLbs: l.grossLbs ?? null,
        tareLbs: l.tareLbs ?? null,
        netLbs: l.netLbs ?? null,
        grossAt: toDate(l.grossAt),
        tareAt: toDate(l.tareAt),
        moisturePct: l.moisturePct ?? null,
        dockagePct: l.dockagePct ?? null,
        testWeightLbs: l.testWeightLbs ?? null,
        proteinPct: l.proteinPct ?? null,
        shrinkPct: l.shrinkPct ?? null,
        grossBushels: l.grossBushels ?? null,
        netBushels: l.netBushels ?? null,
        createdAt: toDate(l.grossAt) ?? toDate(l.tareAt) ?? toDate(s.createdAt) ?? new Date(),
      });
      loadCount += 1;
    }
    await db.insert(sheetEvents).values({
      sheetId,
      action: "SYNC_RECEIVED",
      detail: `Mirrored from ${pkg.site.name} (${pkg.day})`,
      createdAt: new Date(),
    });
    sheetCount += 1;
  }

  // 5. end-of-day totals per site/day
  const t = pkg.totals;
  const existingReport = await db.query.eodReports.findFirst({
    where: and(eq(eodReports.siteId, siteId), eq(eodReports.day, pkg.day)),
  });
  const totalsRow = {
    sheetsOpened: t?.sheetsOpened ?? sheetCount,
    loadCount: t?.loadCount ?? loadCount,
    completedCount: t?.completedCount ?? 0,
    inboundLbs: t?.inboundLbs ?? 0,
    outboundLbs: t?.outboundLbs ?? 0,
    inboundBu: t?.inboundBu ?? 0,
    outboundBu: t?.outboundBu ?? 0,
  };
  if (existingReport) {
    await db.update(eodReports).set(totalsRow).where(eq(eodReports.id, existingReport.id));
  } else {
    await db.insert(eodReports).values({ siteId, day: pkg.day, ...totalsRow });
  }

  // 6. log
  await logReceive(db, "OK", `${pkg.site.name} ${pkg.day}: ${sheetCount} sheets / ${loadCount} loads`);
  return { sheets: sheetCount, loads: loadCount };
}

// ------------------------------------------------------------------ routes
export const syncReceiver = new Hono();

syncReceiver.use("*", async (c, next) => {
  if (!checkSyncKey(c.req.header("x-gt-sync-key")).ok) {
    return c.json({ error: "bad sync key" }, 401);
  }
  return next();
});

syncReceiver.post("/eod", async (c) => {
  let pkg: EodPackage;
  try {
    pkg = (await c.req.json()) as EodPackage;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  try {
    const result = await receiveEod(pkg);
    return c.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] EOD receive failed:", err);
    const label = pkg?.site?.name ? `${pkg.site.name} ${pkg?.day ?? ""}` : "unknown site";
    await logReceive(getDb(), "ERROR", `${label}: ${message}`);
    return c.json({ error: message }, 500);
  }
});

syncReceiver.get("/people", async (c) => {
  const db = getDb();
  const farmerRows = await db.select().from(farmers).orderBy(asc(farmers.name));
  const landlordRows = await db.select().from(landlords).orderBy(asc(landlords.name));
  const lotRows = await db
    .select({ lot: lots, farmerName: farmers.name, landlordName: landlords.name })
    .from(lots)
    .leftJoin(farmers, eq(lots.farmerId, farmers.id))
    .leftJoin(landlords, eq(lots.landlordId, landlords.id))
    .orderBy(asc(lots.code));
  return c.json({
    farmers: farmerRows.map((f) => ({ name: f.name, phone: f.phone, email: f.email })),
    landlords: landlordRows.map((l) => ({ name: l.name, phone: l.phone })),
    lots: lotRows.map((r) => ({
      code: r.lot.code,
      farmerName: r.farmerName,
      landlordName: r.landlordName,
      crop: r.lot.crop,
      landlordSplitPct: r.lot.landlordSplitPct,
      status: r.lot.status,
      notes: r.lot.notes,
    })),
  });
});
