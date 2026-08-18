import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { getDb } from "./queries/connection";
import {
  bins,
  farmers,
  landlords,
  loads,
  lots,
  settings,
  sites,
  syncLog,
  weightSheets,
} from "@db/schema";
import { round2 } from "@contracts/grain";

// ---------------------------------------------------------------------------
// Main-office sync — this site pushes an end-of-day package (sheets, loads,
// bins, totals) to the office portal, and pulls office-mastered people/lots
// down. Sync NEVER blocks weighing: every failure is caught, written to
// sync_log, and reported to the caller as a summary.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;

export async function getSetting(db: Db, key: string): Promise<string> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  return row?.value ?? "";
}

export async function setSetting(db: Db, key: string, value: string) {
  const existing = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  if (existing) {
    await db.update(settings).set({ value }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value });
  }
}

export async function logSync(
  db: Db,
  direction: "PUSH" | "PULL" | "RECEIVE",
  status: "OK" | "ERROR",
  detail: string,
) {
  await db.insert(syncLog).values({ direction, status, detail });
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function dayKey(d: Date) {
  const x = startOfDay(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Build the end-of-day package for one local site for one day. */
async function buildEodPackage(db: Db, siteId: number, day: Date) {
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) return null;
  const from = startOfDay(day);
  const to = endOfDay(day);

  // people snapshot (office keeps its master copy current from these)
  const farmerRows = await db.select().from(farmers).orderBy(asc(farmers.name));
  const landlordRows = await db.select().from(landlords).orderBy(asc(landlords.name));
  const lotRows = await db
    .select({ lot: lots, farmerName: farmers.name, landlordName: landlords.name })
    .from(lots)
    .leftJoin(farmers, eq(lots.farmerId, farmers.id))
    .leftJoin(landlords, eq(lots.landlordId, landlords.id));

  const binRows = await db
    .select()
    .from(bins)
    .where(eq(bins.siteId, siteId))
    .orderBy(asc(bins.name));

  // sheets opened that day, plus any still open (carry-over context)
  const sheetRows = await db
    .select({
      sheet: weightSheets,
      farmerName: farmers.name,
      lotCode: lots.code,
      landlordName: landlords.name,
    })
    .from(weightSheets)
    .leftJoin(farmers, eq(weightSheets.farmerId, farmers.id))
    .leftJoin(lots, eq(weightSheets.lotId, lots.id))
    .leftJoin(landlords, eq(weightSheets.landlordId, landlords.id))
    .where(
      and(
        eq(weightSheets.siteId, siteId),
        or(
          and(gte(weightSheets.createdAt, from), lte(weightSheets.createdAt, to)),
          eq(weightSheets.status, "OPEN"),
        ),
      ),
    )
    .orderBy(asc(weightSheets.createdAt));

  const sheetIds = sheetRows.map((r) => r.sheet.id);
  const loadRows = sheetIds.length
    ? await db
        .select({ load: loads, binName: bins.name })
        .from(loads)
        .leftJoin(bins, eq(loads.binId, bins.id))
        .where(inArray(loads.sheetId, sheetIds))
        .orderBy(asc(loads.loadNo))
    : [];

  const loadsBySheet = new Map<number, typeof loadRows>();
  for (const r of loadRows) {
    const arr = loadsBySheet.get(r.load.sheetId) ?? [];
    arr.push(r);
    loadsBySheet.set(r.load.sheetId, arr);
  }

  // totals mirror the daily report: loads weighed that day at this site
  const dayLoads = loadRows.filter(
    (r) => r.load.createdAt >= from && r.load.createdAt <= to,
  );
  const sheetsOpened = sheetRows.filter(
    (r) => r.sheet.createdAt >= from && r.sheet.createdAt <= to,
  );
  const done = dayLoads.filter((r) => r.load.netLbs != null);
  const dirOf = (sheetId: number) =>
    sheetRows.find((s) => s.sheet.id === sheetId)?.sheet.direction ?? "INBOUND";
  const inbound = done.filter((r) => dirOf(r.load.sheetId) === "INBOUND");
  const outbound = done.filter((r) => dirOf(r.load.sheetId) === "OUTBOUND");
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return {
    site: { name: site.name, location: site.location },
    day: dayKey(day),
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
    bins: binRows.map((b) => ({
      name: b.name,
      crop: b.crop,
      capacityLbs: b.capacityLbs,
      currentLbs: b.currentLbs,
    })),
    sheets: sheetRows.map((r) => ({
      ticketNo: r.sheet.ticketNo,
      farmerName: r.farmerName,
      lotCode: r.lotCode,
      landlordName: r.landlordName,
      crop: r.sheet.crop,
      direction: r.sheet.direction,
      status: r.sheet.status,
      closeReason: r.sheet.closeReason,
      maxLoads: r.sheet.maxLoads,
      createdAt: r.sheet.createdAt,
      closedAt: r.sheet.closedAt,
      loads: (loadsBySheet.get(r.sheet.id) ?? []).map((l) => ({
        loadNo: l.load.loadNo,
        truckId: l.load.truckId,
        driverName: l.load.driverName,
        binName: l.binName,
        grossLbs: l.load.grossLbs,
        tareLbs: l.load.tareLbs,
        netLbs: l.load.netLbs,
        grossAt: l.load.grossAt,
        tareAt: l.load.tareAt,
        moisturePct: l.load.moisturePct,
        dockagePct: l.load.dockagePct,
        testWeightLbs: l.load.testWeightLbs,
        proteinPct: l.load.proteinPct,
        shrinkPct: l.load.shrinkPct,
        grossBushels: l.load.grossBushels,
        netBushels: l.load.netBushels,
      })),
    })),
    totals: {
      sheetsOpened: sheetsOpened.length,
      loadCount: dayLoads.length,
      completedCount: done.length,
      inboundLbs: sum(inbound.map((r) => r.load.netLbs ?? 0)),
      outboundLbs: sum(outbound.map((r) => r.load.netLbs ?? 0)),
      inboundBu: round2(sum(inbound.map((r) => r.load.netBushels ?? 0))),
      outboundBu: round2(sum(outbound.map((r) => r.load.netBushels ?? 0))),
    },
  };
}

export type SyncResult = {
  ok: boolean;
  pushed: number;
  pulled: { farmers: number; landlords: number; lots: number } | null;
  error: string | null;
};

/** Push one day's package per local site to the office portal. */
export async function pushEod(day?: Date): Promise<SyncResult> {
  const db = getDb();
  const result: SyncResult = { ok: true, pushed: 0, pulled: null, error: null };
  const officeUrl = (await getSetting(db, "officeUrl")).trim().replace(/\/+$/, "");
  if (!officeUrl) {
    result.error = "Office portal URL not set — configure main-office sync first.";
    return result;
  }
  const key = await getSetting(db, "officeKey");
  const targetDay = day ?? new Date();

  const siteRows = await db.select().from(sites).orderBy(asc(sites.name));
  for (const site of siteRows) {
    try {
      const pkg = await buildEodPackage(db, site.id, targetDay);
      if (!pkg) continue;
      const res = await fetchWithTimeout(`${officeUrl}/api/sync/eod`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-gt-sync-key": key },
        body: JSON.stringify(pkg),
      });
      if (!res.ok) throw new Error(`office responded ${res.status}`);
      const body = (await res.json()) as { sheets?: number; loads?: number };
      result.pushed += 1;
      await logSync(
        db,
        "PUSH",
        "OK",
        `${site.name} ${pkg.day}: ${body.sheets ?? 0} sheets / ${body.loads ?? 0} loads uploaded`,
      );
    } catch (err) {
      result.ok = false;
      result.error = err instanceof Error ? err.message : String(err);
      await logSync(db, "PUSH", "ERROR", `${site.name}: ${result.error}`);
    }
  }
  return result;
}

/** Pull office-mastered farmers/landlords/lots down to this site. */
export async function pullPeople(): Promise<SyncResult> {
  const db = getDb();
  const result: SyncResult = { ok: true, pushed: 0, pulled: null, error: null };
  const officeUrl = (await getSetting(db, "officeUrl")).trim().replace(/\/+$/, "");
  if (!officeUrl) {
    result.error = "Office portal URL not set — configure main-office sync first.";
    return result;
  }
  const key = await getSetting(db, "officeKey");

  try {
    const res = await fetchWithTimeout(`${officeUrl}/api/sync/people`, {
      headers: { "x-gt-sync-key": key },
    });
    if (!res.ok) throw new Error(`office responded ${res.status}`);
    const data = (await res.json()) as {
      farmers: { name: string; phone: string | null; email: string | null }[];
      landlords: { name: string; phone: string | null }[];
      lots: {
        code: string;
        farmerName: string | null;
        landlordName: string | null;
        crop: string;
        landlordSplitPct: number;
        status: "OPEN" | "CLOSED";
        notes: string | null;
      }[];
    };

    // upsert people by name
    const farmerIdByName = new Map<string, number>();
    for (const f of data.farmers ?? []) {
      const existing = await db.query.farmers.findFirst({ where: eq(farmers.name, f.name) });
      if (existing) {
        farmerIdByName.set(f.name, existing.id);
      } else {
        const [{ id }] = await db
          .insert(farmers)
          .values({ name: f.name, phone: f.phone, email: f.email })
          .$returningId();
        farmerIdByName.set(f.name, id);
      }
    }
    const landlordIdByName = new Map<string, number>();
    for (const l of data.landlords ?? []) {
      const existing = await db.query.landlords.findFirst({
        where: eq(landlords.name, l.name),
      });
      if (existing) {
        landlordIdByName.set(l.name, existing.id);
      } else {
        const [{ id }] = await db
          .insert(landlords)
          .values({ name: l.name, phone: l.phone })
          .$returningId();
        landlordIdByName.set(l.name, id);
      }
    }

    // upsert lots by code — office is the master
    for (const lot of data.lots ?? []) {
      const farmerId = lot.farmerName ? farmerIdByName.get(lot.farmerName) : undefined;
      if (!farmerId) continue; // lot references a farmer we don't have — skip
      const landlordId =
        lot.landlordName != null ? (landlordIdByName.get(lot.landlordName) ?? null) : null;
      const existing = await db.query.lots.findFirst({ where: eq(lots.code, lot.code) });
      const patch = {
        farmerId,
        landlordId,
        crop: lot.crop,
        landlordSplitPct: lot.landlordSplitPct,
        status: lot.status,
        closedAt: lot.status === "CLOSED" ? new Date() : null,
        notes: lot.notes,
      };
      if (existing) {
        await db.update(lots).set(patch).where(eq(lots.id, existing.id));
      } else {
        await db.insert(lots).values({ code: lot.code, ...patch });
      }
    }

    result.pulled = {
      farmers: (data.farmers ?? []).length,
      landlords: (data.landlords ?? []).length,
      lots: (data.lots ?? []).length,
    };
    await logSync(
      db,
      "PULL",
      "OK",
      `people: ${result.pulled.farmers} farmers / ${result.pulled.landlords} landlords / ${result.pulled.lots} lots`,
    );
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
    await logSync(db, "PULL", "ERROR", result.error);
  }
  return result;
}

/** Full round-trip: pull office-mastered people/lots, then push today's data. */
export async function syncNow(day?: Date): Promise<{ pull: SyncResult; push: SyncResult }> {
  const pull = await pullPeople();
  const push = await pushEod(day);
  return { pull, push };
}
