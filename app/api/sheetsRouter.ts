import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  weightSheets,
  loads,
  sheetEvents,
  farmers,
  landlords,
  lots,
  sites,
  bins,
} from "@db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or } from "drizzle-orm";
import { computeBushels, round2 } from "@contracts/grain";
import { pushEod, getSetting } from "./officeSync";

const STATUS = z.enum(["OPEN", "FULL", "CLOSED"]);

async function logEvent(sheetId: number, action: string, detail?: string, loadId?: number | null) {
  await getDb()
    .insert(sheetEvents)
    .values({ sheetId, loadId: loadId ?? null, action, detail: detail ?? null });
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

/** Find a bin at the site for this crop with room for `needLbs`. */
async function findBinFor(siteId: number, crop: string, needLbs: number) {
  const db = getDb();
  const candidates = await db
    .select()
    .from(bins)
    .where(and(eq(bins.siteId, siteId), eq(bins.crop, crop)))
    .orderBy(asc(bins.currentLbs));
  return (
    candidates.find((b) => b.capacityLbs - b.currentLbs >= needLbs) ?? candidates[0] ?? null
  );
}

async function applyToBin(binId: number, deltaLbs: number) {
  const db = getDb();
  const bin = await db.query.bins.findFirst({ where: eq(bins.id, binId) });
  if (!bin) return;
  const next = Math.max(0, bin.currentLbs + deltaLbs);
  await db.update(bins).set({ currentLbs: next }).where(eq(bins.id, binId));
}

// --------------------------------------------------------------- joins
const sheetSelect = {
  sheet: weightSheets,
  farmerName: farmers.name,
  lotCode: lots.code,
  lotSplitPct: lots.landlordSplitPct,
  lotStatus: lots.status,
  landlordName: landlords.name,
  siteName: sites.name,
};

function joinSheetTables(db: ReturnType<typeof getDb>) {
  return db
    .select(sheetSelect)
    .from(weightSheets)
    .leftJoin(farmers, eq(weightSheets.farmerId, farmers.id))
    .leftJoin(lots, eq(weightSheets.lotId, lots.id))
    .leftJoin(landlords, eq(weightSheets.landlordId, landlords.id))
    .leftJoin(sites, eq(weightSheets.siteId, sites.id));
}

type JoinedSheetRow = {
  sheet: typeof weightSheets.$inferSelect;
  farmerName: string | null;
  lotCode: string | null;
  lotSplitPct: number | null;
  lotStatus: "OPEN" | "CLOSED" | null;
  landlordName: string | null;
  siteName: string | null;
};

type LoadRowT = typeof loads.$inferSelect;

async function fetchLoads(db: ReturnType<typeof getDb>, sheetIds: number[]) {
  if (sheetIds.length === 0) return new Map<number, (LoadRowT & { binName: string | null })[]>();
  const rows = await db
    .select({ load: loads, binName: bins.name })
    .from(loads)
    .leftJoin(bins, eq(loads.binId, bins.id))
    .where(inArray(loads.sheetId, sheetIds))
    .orderBy(asc(loads.loadNo));
  const map = new Map<number, (LoadRowT & { binName: string | null })[]>();
  for (const r of rows) {
    const arr = map.get(r.load.sheetId) ?? [];
    arr.push({ ...r.load, binName: r.binName });
    map.set(r.load.sheetId, arr);
  }
  return map;
}

function toSheetRow(
  r: JoinedSheetRow,
  sheetLoads: (LoadRowT & { binName: string | null })[],
  includeLoads: boolean,
) {
  const completed = sheetLoads.filter((l) => l.netLbs != null);
  const activeLoad = sheetLoads.find((l) => l.netLbs == null) ?? null;
  const last = sheetLoads[sheetLoads.length - 1];
  return {
    ...r.sheet,
    farmerName: r.farmerName,
    lotCode: r.lotCode,
    lotSplitPct: r.lotSplitPct,
    lotStatus: r.lotStatus,
    landlordName: r.landlordName,
    siteName: r.siteName,
    loadCount: sheetLoads.length,
    completedLoads: completed.length,
    netLbs: completed.reduce((a, l) => a + (l.netLbs ?? 0), 0),
    netBushels: round2(completed.reduce((a, l) => a + (l.netBushels ?? 0), 0)),
    activeLoad,
    lastTruckId: last?.truckId ?? null,
    ...(includeLoads ? { loads: sheetLoads } : {}),
  };
}

/** Load the in-progress load (second weight still pending) for a sheet. */
async function activeLoadOf(db: ReturnType<typeof getDb>, sheetId: number) {
  const rows = await db.select().from(loads).where(eq(loads.sheetId, sheetId));
  return rows.find((l) => l.netLbs == null) ?? null;
}

export const sheetsRouter = createRouter({
  // ----------------------------------------------------- archive search
  list: publicQuery
    .input(
      z
        .object({
          search: z.string().optional(),
          farmerId: z.number().optional(),
          lotId: z.number().optional(),
          landlordId: z.number().optional(),
          crop: z.string().optional(),
          status: STATUS.optional(),
          dateFrom: z.string().optional(), // YYYY-MM-DD
          dateTo: z.string().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      const q = input?.search?.trim();
      if (q) {
        const p = `%${q}%`;
        // trucks/drivers live on loads now — find matching sheets there too
        const loadHits = await db
          .select({ sheetId: loads.sheetId })
          .from(loads)
          .where(or(like(loads.truckId, p), like(loads.driverName, p)));
        const hitIds = [...new Set(loadHits.map((h) => h.sheetId))];
        conds.push(
          or(
            like(farmers.name, p),
            like(lots.code, p),
            like(landlords.name, p),
            like(weightSheets.ticketNo, p),
            ...(hitIds.length ? [inArray(weightSheets.id, hitIds)] : []),
          ),
        );
      }
      if (input?.farmerId) conds.push(eq(weightSheets.farmerId, input.farmerId));
      if (input?.lotId) conds.push(eq(weightSheets.lotId, input.lotId));
      if (input?.landlordId) conds.push(eq(weightSheets.landlordId, input.landlordId));
      if (input?.crop) conds.push(eq(weightSheets.crop, input.crop));
      if (input?.status) conds.push(eq(weightSheets.status, input.status));
      if (input?.dateFrom) conds.push(gte(weightSheets.createdAt, startOfDay(new Date(input.dateFrom))));
      if (input?.dateTo) conds.push(lte(weightSheets.createdAt, endOfDay(new Date(input.dateTo))));

      const rows = await joinSheetTables(db)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(weightSheets.createdAt))
        .limit(input?.limit ?? 200);
      const typed = rows as JoinedSheetRow[];
      const loadMap = await fetchLoads(db, typed.map((r) => r.sheet.id));
      return typed.map((r) => toSheetRow(r, loadMap.get(r.sheet.id) ?? [], false));
    }),

  // --------------------------------------- dashboard: open sheet queue
  open: publicQuery.query(async () => {
    const db = getDb();
    const rows = await joinSheetTables(db)
      .where(eq(weightSheets.status, "OPEN"))
      .orderBy(asc(weightSheets.createdAt));
    const typed = rows as JoinedSheetRow[];
    const loadMap = await fetchLoads(db, typed.map((r) => r.sheet.id));
    return typed.map((r) => toSheetRow(r, loadMap.get(r.sheet.id) ?? [], true));
  }),

  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const rows = await joinSheetTables(db).where(eq(weightSheets.id, input.id));
    const typed = rows as JoinedSheetRow[];
    if (!typed[0]) throw new Error("Sheet not found");
    const loadMap = await fetchLoads(db, [input.id]);
    const events = await db
      .select()
      .from(sheetEvents)
      .where(eq(sheetEvents.sheetId, input.id))
      .orderBy(desc(sheetEvents.createdAt));
    return { sheet: toSheetRow(typed[0], loadMap.get(input.id) ?? [], true), events };
  }),

  // ------------------------------------------------------------- create
  // A weight sheet is always opened against a lot (inbound). Outbound sheets
  // may go lot-less with an explicit farmer + crop.
  create: publicQuery
    .input(
      z.object({
        siteId: z.number(),
        lotId: z.number().nullable().optional(),
        farmerId: z.number().optional(),
        crop: z.string().min(1).optional(),
        direction: z.enum(["INBOUND", "OUTBOUND"]).default("INBOUND"),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      let farmerId = input.farmerId ?? null;
      let landlordId: number | null = null;
      let crop = input.crop ?? null;

      if (input.lotId) {
        const lot = await db.query.lots.findFirst({ where: eq(lots.id, input.lotId) });
        if (!lot) throw new Error("Lot not found");
        if (lot.status === "CLOSED") {
          throw new Error(
            `Lot ${lot.code} is closed — the grower must open a new lot before more sheets can be started.`,
          );
        }
        farmerId = lot.farmerId;
        landlordId = lot.landlordId ?? null;
        crop = lot.crop;
      } else if (input.direction === "INBOUND") {
        throw new Error("Pick an open lot for this farmer first — inbound sheets tie to a lot.");
      }
      if (!farmerId || !crop) throw new Error("Farmer and crop are required");

      const [{ id }] = await db
        .insert(weightSheets)
        .values({
          ticketNo: "PENDING",
          siteId: input.siteId,
          farmerId,
          lotId: input.lotId ?? null,
          landlordId,
          crop,
          direction: input.direction,
          notes: input.notes || null,
        })
        .$returningId();
      const ticketNo = `T-${String(id).padStart(5, "0")}`;
      await db.update(weightSheets).set({ ticketNo }).where(eq(weightSheets.id, id));
      await logEvent(id, "CREATED", `Weight sheet ${ticketNo} opened (${input.direction})`);
      return { id, ticketNo };
    }),

  // ---------------------------------------------------- weigh in / out
  // First weight starts a new load row on the sheet (loaded truck for
  // INBOUND, empty truck for OUTBOUND).
  weighFirst: publicQuery
    .input(
      z.object({
        id: z.number(),
        weightLbs: z.number().int().positive(),
        truckId: z.string().optional(),
        driverName: z.string().optional(),
        binId: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, input.id) });
      if (!s) throw new Error("Sheet not found");
      if (s.status === "CLOSED") throw new Error("Sheet is closed for the day");
      if (s.status === "FULL")
        throw new Error(`Sheet is full (${s.maxLoads}/${s.maxLoads} loads) — open a new sheet for this lot`);

      const existing = await db.select().from(loads).where(eq(loads.sheetId, input.id));
      if (existing.some((l) => l.netLbs == null))
        throw new Error("A load is still on the scale — weigh it out first");
      if (existing.length >= s.maxLoads)
        throw new Error(`Sheet already has ${s.maxLoads} loads — open a new sheet for this lot`);

      const loadNo = Math.max(0, ...existing.map((l) => l.loadNo)) + 1;
      const isInbound = s.direction === "INBOUND";
      const [{ id: loadId }] = await db
        .insert(loads)
        .values({
          sheetId: input.id,
          loadNo,
          truckId: input.truckId || null,
          driverName: input.driverName || null,
          binId: input.binId ?? null,
          ...(isInbound
            ? { grossLbs: input.weightLbs, grossAt: new Date() }
            : { tareLbs: input.weightLbs, tareAt: new Date() }),
        })
        .$returningId();
      await logEvent(
        input.id,
        isInbound ? "WEIGH_IN" : "WEIGH_IN_EMPTY",
        `Load ${loadNo} · ${input.weightLbs.toLocaleString()} lbs captured` +
          (input.truckId ? ` · ${input.truckId}` : ""),
        loadId,
      );
      return { ok: true, loadId, loadNo };
    }),

  weighSecond: publicQuery
    .input(
      z.object({
        id: z.number(),
        weightLbs: z.number().int().positive(),
        binId: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, input.id) });
      if (!s) throw new Error("Sheet not found");
      if (s.status !== "OPEN") throw new Error("Sheet is not open for loads");
      const load = await activeLoadOf(db, input.id);
      if (!load) throw new Error("No load waiting on the scale — weigh in first");

      const isInbound = s.direction === "INBOUND";
      if (isInbound && load.grossLbs == null) throw new Error("Weigh in first");
      if (!isInbound && load.tareLbs == null) throw new Error("Weigh in (empty) first");

      const gross = isInbound ? (load.grossLbs as number) : input.weightLbs;
      const tare = isInbound ? input.weightLbs : (load.tareLbs as number);
      const netLbs = gross - tare;
      if (netLbs <= 0) throw new Error("Net weight must be positive — check scale readings");

      // bin: explicit pick now, else the pick made at weigh-in, else auto
      let binId = input.binId ?? load.binId;
      if (!binId) {
        const bin = await findBinFor(s.siteId, s.crop, netLbs);
        binId = bin?.id ?? null;
      }

      const { grossBushels, shrinkPct, netBushels } = computeBushels(
        s.crop,
        netLbs,
        load.moisturePct,
        load.dockagePct,
      );

      let sheetFull = false;
      await db.transaction(async (tx) => {
        await tx
          .update(loads)
          .set(
            isInbound
              ? { tareLbs: tare, tareAt: new Date(), netLbs, binId, grossBushels, shrinkPct, netBushels }
              : { grossLbs: gross, grossAt: new Date(), netLbs, binId, grossBushels, shrinkPct, netBushels },
          )
          .where(eq(loads.id, load.id));
        if (binId) {
          const bin = await tx.query.bins.findFirst({ where: eq(bins.id, binId) });
          if (bin) {
            const delta = isInbound ? netLbs : -netLbs;
            await tx
              .update(bins)
              .set({ currentLbs: Math.max(0, bin.currentLbs + delta) })
              .where(eq(bins.id, binId));
          }
        }
        // auto-close the sheet when the last slot fills
        const all = await tx.select().from(loads).where(eq(loads.sheetId, input.id));
        const done = all.filter((l) => l.netLbs != null || l.id === load.id).length;
        if (done >= s.maxLoads) {
          sheetFull = true;
          await tx
            .update(weightSheets)
            .set({ status: "FULL", closeReason: "FULL", closedAt: new Date() })
            .where(eq(weightSheets.id, input.id));
        }
      });
      await logEvent(
        input.id,
        isInbound ? "WEIGH_OUT" : "WEIGH_OUT_LOADED",
        `Load ${load.loadNo} · ${input.weightLbs.toLocaleString()} lbs → net ${netLbs.toLocaleString()} lbs` +
          (binId ? ` → bin #${binId}` : " (no bin assigned)"),
        load.id,
      );
      if (sheetFull) {
        await logEvent(
          input.id,
          "SHEET_FULL",
          `${s.maxLoads}/${s.maxLoads} loads — sheet closed, start a new sheet for this lot`,
        );
      }
      return { ok: true, netLbs, netBushels, sheetFull };
    }),

  // ----------------------------- edit load weights (change reason req.)
  updateLoadWeights: publicQuery
    .input(
      z.object({
        loadId: z.number(),
        grossLbs: z.number().int().positive(),
        tareLbs: z.number().int().positive(),
        changeReason: z.string().min(3, "A change reason is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
      if (!load) throw new Error("Load not found");
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) });
      if (!s) throw new Error("Sheet not found");
      if (s.status === "CLOSED") throw new Error("Sheet is closed for the day");
      const netLbs = input.grossLbs - input.tareLbs;
      if (netLbs <= 0) throw new Error("Net weight must be positive");
      const { grossBushels, shrinkPct, netBushels } = computeBushels(
        s.crop,
        netLbs,
        load.moisturePct,
        load.dockagePct,
      );

      // Rebalance bin inventory if this load was already completed
      if (load.netLbs != null && load.binId) {
        const delta = netLbs - load.netLbs;
        if (delta !== 0) await applyToBin(load.binId, s.direction === "INBOUND" ? delta : -delta);
      }

      await db
        .update(loads)
        .set({
          grossLbs: input.grossLbs,
          tareLbs: input.tareLbs,
          netLbs,
          grossBushels,
          shrinkPct,
          netBushels,
          changeReason: input.changeReason,
        })
        .where(eq(loads.id, input.loadId));
      await logEvent(
        load.sheetId,
        "WEIGHT_EDIT",
        `Load ${load.loadNo} · gross ${input.grossLbs.toLocaleString()} / tare ${input.tareLbs.toLocaleString()} — ${input.changeReason}`,
        load.id,
      );
      return { ok: true, netLbs };
    }),

  // ------------------------------------------------- grading (TEST)
  updateLoadGrades: publicQuery
    .input(
      z.object({
        loadId: z.number(),
        moisturePct: z.number().min(0).max(60).nullable(),
        dockagePct: z.number().min(0).max(50).nullable(),
        testWeightLbs: z.number().min(0).max(80).nullable(),
        proteinPct: z.number().min(0).max(30).nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
      if (!load) throw new Error("Load not found");
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) });
      if (!s) throw new Error("Sheet not found");
      if (s.status === "CLOSED") throw new Error("Sheet is closed for the day");
      const { loadId, ...grades } = input;
      const calc = load.netLbs
        ? computeBushels(s.crop, load.netLbs, grades.moisturePct, grades.dockagePct)
        : { grossBushels: null, shrinkPct: null, netBushels: null };
      await db
        .update(loads)
        .set({ ...grades, ...calc })
        .where(eq(loads.id, loadId));
      await logEvent(
        load.sheetId,
        "GRADES",
        `Load ${load.loadNo} · moisture ${grades.moisturePct ?? "—"}% · dockage ${grades.dockagePct ?? "—"}% · TW ${grades.testWeightLbs ?? "—"} · protein ${grades.proteinPct ?? "—"}%`,
        loadId,
      );
      return { ok: true, ...calc };
    }),

  assignLoadBin: publicQuery
    .input(z.object({ loadId: z.number(), binId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
      if (!load) throw new Error("Load not found");
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) });
      if (!s) throw new Error("Sheet not found");
      if (s.status === "CLOSED") throw new Error("Sheet is closed for the day");
      if (load.netLbs != null) {
        const delta = s.direction === "INBOUND" ? load.netLbs : -load.netLbs;
        if (load.binId) await applyToBin(load.binId, -delta);
        if (input.binId) await applyToBin(input.binId, delta);
      }
      await db.update(loads).set({ binId: input.binId }).where(eq(loads.id, input.loadId));
      await logEvent(load.sheetId, "BIN_ASSIGN", `Load ${load.loadNo} → bin ${input.binId ?? "none"}`, load.id);
      return { ok: true };
    }),

  // Delete a mistaken load (sheet not closed). Reverses bin movement and
  // re-opens a full sheet.
  voidLoad: publicQuery.input(z.object({ loadId: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
    if (!load) throw new Error("Load not found");
    const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) });
    if (!s) throw new Error("Sheet not found");
    if (s.status === "CLOSED") throw new Error("Closed sheets cannot be edited");
    if (load.netLbs != null && load.binId) {
      await applyToBin(load.binId, s.direction === "INBOUND" ? -load.netLbs : load.netLbs);
    }
    await db.delete(sheetEvents).where(eq(sheetEvents.loadId, input.loadId));
    await db.delete(loads).where(eq(loads.id, input.loadId));
    if (s.status === "FULL") {
      await db
        .update(weightSheets)
        .set({ status: "OPEN", closeReason: null, closedAt: null })
        .where(eq(weightSheets.id, s.id));
    }
    await logEvent(s.id, "LOAD_VOID", `Load ${load.loadNo} voided`);
    return { ok: true };
  }),

  // Close an open sheet early (operator decision, before 10 loads / EOD).
  // Refused while a truck is still mid-weigh on it. The sheet stays in the
  // archive with its loads — closing only stops further loads being added.
  close: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, input.id) });
    if (!s) throw new Error("Sheet not found");
    if (s.status !== "OPEN") throw new Error(`Sheet ${s.ticketNo} is already closed`);
    const inProgress = await db.query.loads.findFirst({
      where: and(eq(loads.sheetId, s.id), isNull(loads.netLbs)),
    });
    if (inProgress) {
      throw new Error(
        `Load ${inProgress.loadNo} is still on the scale — finish or void that load before closing the sheet`,
      );
    }
    await db
      .update(weightSheets)
      .set({ status: "CLOSED", closeReason: "MANUAL", closedAt: new Date() })
      .where(eq(weightSheets.id, s.id));
    await logEvent(s.id, "CLOSED", "Closed by operator");
    return { ok: true };
  }),

  // ------------------------------- truck tare memory (from history)
  truckTares: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({ truckId: loads.truckId, tareLbs: loads.tareLbs })
      .from(loads);
    // group in JS (avg + count + spread per truck)
    const byTruck = new Map<string, number[]>();
    for (const r of rows) {
      if (!r.truckId || r.tareLbs == null) continue;
      byTruck.set(r.truckId, [...(byTruck.get(r.truckId) ?? []), r.tareLbs]);
    }
    return [...byTruck.entries()].map(([truckId, tares]) => {
      const avg = Math.round(tares.reduce((a, b) => a + b, 0) / tares.length);
      return {
        truckId,
        avgTare: avg,
        loads: tares.length,
        minTare: Math.min(...tares),
        maxTare: Math.max(...tares),
      };
    });
  }),

  // -------------------------------------- global activity feed (audit)
  recentActivity: publicQuery
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({ event: sheetEvents, ticketNo: weightSheets.ticketNo })
        .from(sheetEvents)
        .leftJoin(weightSheets, eq(sheetEvents.sheetId, weightSheets.id))
        .orderBy(desc(sheetEvents.createdAt))
        .limit(input?.limit ?? 25);
      return rows.map((r) => ({ ...r.event, ticketNo: r.ticketNo }));
    }),

  // ------------------------------------------------------- end of day
  // Any sheet still open at close of day is closed (FULL sheets are already
  // closed). Lots stay open — a fresh sheet can be started tomorrow.
  closeDay: publicQuery.mutation(async () => {
    const db = getDb();
    const open = await db
      .select({ id: weightSheets.id })
      .from(weightSheets)
      .where(eq(weightSheets.status, "OPEN"));
    if (open.length === 0) return { closed: 0, office: null };
    const ids = open.map((r) => r.id);
    await db
      .update(weightSheets)
      .set({ status: "CLOSED", closeReason: "EOD", closedAt: new Date() })
      .where(inArray(weightSheets.id, ids));
    for (const id of ids) await logEvent(id, "CLOSED", "End-of-day close — sheet locked");
    // Upload the closed day to the main office portal, but only when one is
    // configured — and sync failures never block the close (logged in sync_log).
    const officeUrl = (await getSetting(db, "officeUrl")).trim();
    const office = officeUrl ? await pushEod(new Date()) : null;
    return { closed: ids.length, office };
  }),

  // ------------------------------------------------------ daily report
  dailyReport: publicQuery
    .input(z.object({ date: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const day = input?.date ? new Date(input.date) : new Date();
      const from = startOfDay(day);
      const to = endOfDay(day);

      // loads weighed that day (a load weighs in and out within minutes)
      const loadRows = await db
        .select({
          load: loads,
          binName: bins.name,
          sheet: weightSheets,
          farmerName: farmers.name,
          lotCode: lots.code,
          landlordName: landlords.name,
        })
        .from(loads)
        .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .leftJoin(bins, eq(loads.binId, bins.id))
        .leftJoin(farmers, eq(weightSheets.farmerId, farmers.id))
        .leftJoin(lots, eq(weightSheets.lotId, lots.id))
        .leftJoin(landlords, eq(weightSheets.landlordId, landlords.id))
        .where(and(gte(loads.createdAt, from), lte(loads.createdAt, to)))
        .orderBy(asc(loads.createdAt));

      // sheets opened that day (for the "opened today" count)
      const sheetsOpened = await db
        .select({ id: weightSheets.id })
        .from(weightSheets)
        .where(and(gte(weightSheets.createdAt, from), lte(weightSheets.createdAt, to)));

      const ledger = loadRows.map((r) => ({
        id: r.load.id,
        sheetId: r.sheet.id,
        ticketNo: `${r.sheet.ticketNo}-${String(r.load.loadNo).padStart(2, "0")}`,
        loadNo: r.load.loadNo,
        farmerName: r.farmerName,
        lotCode: r.lotCode,
        landlordName: r.landlordName,
        crop: r.sheet.crop,
        direction: r.sheet.direction,
        status: (r.load.netLbs != null ? "COMPLETED" : "OPEN") as "COMPLETED" | "OPEN",
        truckId: r.load.truckId,
        binName: r.binName,
        grossLbs: r.load.grossLbs,
        tareLbs: r.load.tareLbs,
        netLbs: r.load.netLbs,
        netBushels: r.load.netBushels,
        moisturePct: r.load.moisturePct,
        createdAt: (r.load.grossAt ?? r.load.tareAt ?? r.load.createdAt) as Date,
      }));

      const done = ledger.filter((l) => l.netLbs != null);
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      const inbound = done.filter((l) => l.direction === "INBOUND");
      const outbound = done.filter((l) => l.direction === "OUTBOUND");

      const byCrop = new Map<string, { lbs: number; bu: number; count: number }>();
      for (const l of done) {
        const e = byCrop.get(l.crop) ?? { lbs: 0, bu: 0, count: 0 };
        e.lbs += l.netLbs ?? 0;
        e.bu = round2(e.bu + (l.netBushels ?? 0));
        e.count += 1;
        byCrop.set(l.crop, e);
      }
      const byFarmer = new Map<string, { lbs: number; bu: number; count: number }>();
      for (const l of done) {
        const k = l.farmerName ?? "Unknown";
        const e = byFarmer.get(k) ?? { lbs: 0, bu: 0, count: 0 };
        e.lbs += l.netLbs ?? 0;
        e.bu = round2(e.bu + (l.netBushels ?? 0));
        e.count += 1;
        byFarmer.set(k, e);
      }

      const binRows = await db
        .select({ bin: bins, siteName: sites.name })
        .from(bins)
        .leftJoin(sites, eq(bins.siteId, sites.id))
        .orderBy(sites.name, bins.name);

      return {
        date: startOfDay(day),
        sheetCount: sheetsOpened.length,
        loadCount: ledger.length,
        completedCount: done.length,
        inboundLbs: sum(inbound.map((l) => l.netLbs ?? 0)),
        outboundLbs: sum(outbound.map((l) => l.netLbs ?? 0)),
        inboundBu: round2(sum(inbound.map((l) => l.netBushels ?? 0))),
        outboundBu: round2(sum(outbound.map((l) => l.netBushels ?? 0))),
        byCrop: [...byCrop.entries()].map(([crop, v]) => ({ crop, ...v })),
        byFarmer: [...byFarmer.entries()].map(([farmer, v]) => ({ farmer, ...v })),
        bins: binRows.map((r) => ({ ...r.bin, siteName: r.siteName })),
        loads: ledger,
      };
    }),
});

export type SheetsRouter = typeof sheetsRouter;
