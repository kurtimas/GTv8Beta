import { getDb } from "../api/queries/connection";
import {
  sites,
  bins,
  farmers,
  landlords,
  lots,
  weightSheets,
  loads,
  sheetEvents,
  eodReports,
  syncLog,
} from "./schema";
import { eq } from "drizzle-orm";
import { computeBushels } from "../contracts/grain";

// ---------------------------------------------------------------------------
// Office-portal demo dataset: two scale houses, their bins, the office-master
// farmer/landlord/lot list, and mirrored weight sheets + end-of-day uploads
// covering the last three days — as if both sites had been pushing EOD data.
// ---------------------------------------------------------------------------

/** Insert a sheet and assign its T-##### ticket number from the new id. */
async function insertSheet(
  db: ReturnType<typeof getDb>,
  row: Omit<typeof weightSheets.$inferInsert, "ticketNo">,
) {
  const [{ id }] = await db
    .insert(weightSheets)
    .values({ ...row, ticketNo: "PENDING" })
    .$returningId();
  // ticketNo is globally unique in the shared schema, so office tickets come
  // from the (cross-site) row id rather than restarting per site
  const ticketNo = `T-${String(id).padStart(5, "0")}`;
  await db.update(weightSheets).set({ ticketNo }).where(eq(weightSheets.id, id));
  return { id, ticketNo };
}

function day(daysAgo: number, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// [truck, gross, tare, moisture, dockage, testWeight, protein|null, binName|null]
type LoadDef = [string, number, number, number, number, number, number | null, string | null];

type SheetDef = {
  daysAgo: number;
  lotIdx: number | null; // null → lot-less outbound sheet
  farmerIdx?: number; // required when lotIdx is null
  crop?: string; // required when lotIdx is null
  dir?: "INBOUND" | "OUTBOUND";
  status: "OPEN" | "FULL" | "CLOSED";
  done: LoadDef[];
  /** one load still on the scale (first weight only) */
  onScale?: [string, number];
};

// End-of-day accumulator — one eod_reports row per site per day.
type DayTotals = {
  sheetsOpened: number;
  loadCount: number;
  completedCount: number;
  inboundLbs: number;
  outboundLbs: number;
  inboundBu: number;
  outboundBu: number;
};
const eodTotals = new Map<string, DayTotals>(); // key: `${siteId}|${dayKey}`

function eodAccumulate(siteId: number, date: Date, fn: (t: DayTotals) => void) {
  const key = `${siteId}|${dayKey(date)}`;
  const t = eodTotals.get(key) ?? {
    sheetsOpened: 0,
    loadCount: 0,
    completedCount: 0,
    inboundLbs: 0,
    outboundLbs: 0,
    inboundBu: 0,
    outboundBu: 0,
  };
  fn(t);
  eodTotals.set(key, t);
}

/** Seed demo data only when the database is empty. Safe to call on every boot. */
export async function seedIfEmpty() {
  const db = getDb();
  const existing = await db.select({ id: farmers.id }).from(farmers).limit(1);
  if (existing.length > 0) return false;

  console.log("[seed] Empty database — loading office demo dataset...");

  // ---------------------------------------------------------- sites & bins
  const [{ id: mainId }] = await db
    .insert(sites)
    .values({ name: "Main Street Elevator", location: "Haven, KS" })
    .$returningId();
  const [{ id: westId }] = await db
    .insert(sites)
    .values({ name: "West Depot", location: "Turon, KS" })
    .$returningId();

  const binDefsBySite: Record<number, { name: string; crop: string; capacityLbs: number; currentLbs: number }[]> = {
    [mainId]: [
      { name: "Bin 1", crop: "Corn", capacityLbs: 1_680_000, currentLbs: 403_200 }, // 24%
      { name: "Bin 2", crop: "Corn", capacityLbs: 1_680_000, currentLbs: 924_000 }, // 55%
      { name: "Bin 3", crop: "Wheat", capacityLbs: 1_200_000, currentLbs: 936_000 }, // 78%
      { name: "Bin 4", crop: "Soybeans", capacityLbs: 1_200_000, currentLbs: 1_104_000 }, // 92%
      { name: "Flat Storage", crop: "Wheat", capacityLbs: 2_400_000, currentLbs: 960_000 }, // 40%
    ],
    [westId]: [
      { name: "Bin 1", crop: "Corn", capacityLbs: 1_500_000, currentLbs: 360_000 }, // 24%
      { name: "Bin 2", crop: "Wheat", capacityLbs: 1_000_000, currentLbs: 550_000 }, // 55%
      { name: "Bin 3", crop: "Sorghum", capacityLbs: 900_000, currentLbs: 702_000 }, // 78%
      { name: "Bin 4", crop: "Soybeans", capacityLbs: 1_000_000, currentLbs: 920_000 }, // 92%
    ],
  };
  const binIds: Record<string, number> = {}; // key: `${siteId}|${name}`
  for (const [siteIdStr, defs] of Object.entries(binDefsBySite)) {
    for (const b of defs) {
      const [{ id }] = await db
        .insert(bins)
        .values({ ...b, siteId: Number(siteIdStr) })
        .$returningId();
      binIds[`${siteIdStr}|${b.name}`] = id;
    }
  }

  // ------------------------------------------- master farmers/landlords/lots
  const farmerDefs = [
    { name: "Kurt Miller", phone: "620-555-0142", email: "kurt@millercreekfarm.com" },
    { name: "Dale Unruh", phone: "620-555-0177", email: "" },
    { name: "S&C Farms (Sam Cole)", phone: "316-555-0119", email: "sam@scfarms.com" },
    { name: "Marlene Klassen", phone: "620-555-0128", email: "" },
    { name: "Triple J Ag", phone: "620-555-0163", email: "office@triplejag.com" },
  ];
  const farmerIds: number[] = [];
  for (const f of farmerDefs) {
    const [{ id }] = await db
      .insert(farmers)
      .values({ name: f.name, phone: f.phone, email: f.email || null })
      .$returningId();
    farmerIds.push(id);
  }

  const landlordDefs = [
    { name: "Estate of H. Penner", phone: "620-555-0101" },
    { name: "Ruth Wedel", phone: "620-555-0133" },
    { name: "Schmidt Land Co.", phone: "316-555-0188" },
  ];
  const landlordIds: number[] = [];
  for (const l of landlordDefs) {
    const [{ id }] = await db
      .insert(landlords)
      .values({ name: l.name, phone: l.phone })
      .$returningId();
    landlordIds.push(id);
  }

  // code, farmerIdx, landlordIdx|null, splitPct, crop, status
  const lotDefs: [string, number, number | null, number, string, "OPEN" | "CLOSED"][] = [
    ["KMF-26-C1", 0, null, 0, "Corn", "OPEN"],
    ["KMF-26-W2", 0, 0, 33, "Wheat", "OPEN"],
    ["DU-26-C1", 1, 2, 25, "Corn", "OPEN"],
    ["SCF-26-S1", 2, null, 0, "Soybeans", "OPEN"],
    ["MK-26-W1", 3, 1, 40, "Wheat", "OPEN"],
    ["TJJ-26-M1", 4, null, 0, "Sorghum", "CLOSED"], // grower finished this lot
  ];
  const lotIds: number[] = [];
  for (const [code, fi, li, split, crop, status] of lotDefs) {
    const [{ id }] = await db
      .insert(lots)
      .values({
        code,
        farmerId: farmerIds[fi],
        landlordId: li == null ? null : landlordIds[li],
        landlordSplitPct: split,
        crop,
        status,
        closedAt: status === "CLOSED" ? day(6, 16, 0) : null,
      })
      .$returningId();
    lotIds.push(id);
  }

  // ------------------------------------ mirrored sheets + loads, per site
  const sheetsBySite: Record<number, SheetDef[]> = {
    [mainId]: [
      // Kurt Miller corn — closed two days ago
      {
        daysAgo: 2, lotIdx: 0, status: "CLOSED",
        done: [
          ["KM-04 Peterbilt", 79980, 29540, 16.2, 0.5, 57.1, null, "Bin 1"],
          ["KM-11 Kenworth", 81500, 30110, 16.4, 0.5, 57.0, null, "Bin 1"],
          ["KM-04 Peterbilt", 80260, 29540, 16.3, 0.6, 57.0, null, "Bin 1"],
          ["KM-11 Kenworth", 82250, 30110, 16.8, 0.5, 56.9, null, "Bin 2"],
        ],
      },
      // Marlene Klassen wheat (crop-share) — closed yesterday
      {
        daysAgo: 1, lotIdx: 4, status: "CLOSED",
        done: [
          ["MK Freightliner", 78900, 29400, 12.8, 0.6, 61.2, 12.1, "Bin 3"],
          ["MK Freightliner", 79200, 29400, 12.6, 0.5, 61.5, 12.3, "Bin 3"],
          ["MK Freightliner", 78500, 29400, 12.9, 0.6, 61.1, 12.0, "Flat Storage"],
          ["MK Freightliner", 79000, 29400, 12.7, 0.5, 61.3, 12.2, "Flat Storage"],
          ["MK Freightliner", 78650, 29400, 12.8, 0.6, 61.0, 12.1, "Flat Storage"],
        ],
      },
      // Dale Unruh corn — sheet still open today, one truck on the scale
      {
        daysAgo: 0, lotIdx: 2, status: "OPEN",
        done: [
          ["DU Silverado+trailer", 68400, 26150, 17.1, 1.0, 56.2, null, "Bin 2"],
          ["DU Silverado+trailer", 69100, 26150, 17.3, 1.1, 56.0, null, "Bin 2"],
        ],
        onScale: ["DU Silverado+trailer", 68750],
      },
    ],
    [westId]: [
      // S&C Farms soybeans — closed two days ago
      {
        daysAgo: 2, lotIdx: 3, status: "CLOSED",
        done: [
          ["SCF Pete 379", 75600, 28900, 12.2, 0.8, 56.7, null, "Bin 4"],
          ["SCF Pete 379", 76100, 28900, 12.4, 0.8, 56.6, null, "Bin 4"],
          ["SCF Pete 379", 75250, 28900, 12.1, 0.7, 56.8, null, "Bin 4"],
        ],
      },
      // Kurt Miller wheat (crop-share) — closed yesterday
      {
        daysAgo: 1, lotIdx: 1, status: "CLOSED",
        done: [
          ["KM-04 Peterbilt", 80100, 29540, 13.1, 0.7, 60.8, 11.4, "Bin 2"],
          ["KM-11 Kenworth", 80600, 30110, 13.0, 0.6, 61.0, 11.6, "Bin 2"],
          ["KM-04 Peterbilt", 80300, 29540, 13.2, 0.7, 60.7, 11.5, "Bin 2"],
          ["KM-11 Kenworth", 79850, 30110, 13.1, 0.6, 60.9, 11.7, "Bin 2"],
        ],
      },
      // Soybean ship-out today (lot-less outbound)
      {
        daysAgo: 0, lotIdx: null, farmerIdx: 2, crop: "Soybeans", dir: "OUTBOUND", status: "CLOSED",
        done: [
          ["SCF Pete 379", 77400, 28900, 0, 0, 0, null, "Bin 4"],
          ["SCF Pete 379", 76850, 28900, 0, 0, 0, null, "Bin 4"],
        ],
      },
    ],
  };

  for (const [siteIdStr, sheetDefs] of Object.entries(sheetsBySite)) {
    const siteId = Number(siteIdStr);
    for (const def of sheetDefs) {
      const li = def.lotIdx;
      const farmerId = li == null ? farmerIds[def.farmerIdx ?? 0] : farmerIds[lotDefs[li][1]];
      const landlordId =
        li == null ? null : lotDefs[li][2] == null ? null : landlordIds[lotDefs[li][2] as number];
      const crop = li == null ? (def.crop as string) : lotDefs[li][4];
      const dir = def.dir ?? "INBOUND";
      const created = day(def.daysAgo, 7, 5);

      const closed =
        def.status !== "OPEN"
          ? {
              status: def.status,
              closeReason: def.status === "FULL" ? "FULL" : "EOD",
              closedAt: day(def.daysAgo, def.status === "FULL" ? 15 : 17, 30),
            }
          : { status: "OPEN" as const };

      const { id: sheetId, ticketNo } = await insertSheet(db, {
        siteId,
        farmerId,
        lotId: li == null ? null : lotIds[li],
        landlordId,
        crop,
        direction: dir,
        notes: null,
        createdAt: created,
        ...closed,
      });
      await db.insert(sheetEvents).values({
        sheetId,
        action: "SYNC_RECEIVED",
        detail: `Mirrored from site upload (${ticketNo})`,
        createdAt: day(def.daysAgo, 17, 35),
      });
      eodAccumulate(siteId, created, (t) => {
        t.sheetsOpened += 1;
      });

      let n = 0;
      for (const [truck, gross, tare, moist, dock, tw, protein, binName] of def.done) {
        n += 1;
        const grossAt = day(def.daysAgo, 7 + n, 10);
        const tareAt = day(def.daysAgo, 7 + n, 48);
        const net = gross - tare;
        const calc = computeBushels(crop, net, moist || null, dock || null);
        const [{ id: loadId }] = await db
          .insert(loads)
          .values({
            sheetId,
            loadNo: n,
            truckId: truck,
            binId: binName ? (binIds[`${siteId}|${binName}`] ?? null) : null,
            grossLbs: gross,
            tareLbs: tare,
            netLbs: net,
            grossAt,
            tareAt,
            moisturePct: moist || null,
            dockagePct: dock || null,
            testWeightLbs: tw || null,
            proteinPct: protein,
            shrinkPct: calc.shrinkPct,
            grossBushels: calc.grossBushels,
            netBushels: calc.netBushels,
            createdAt: grossAt,
          })
          .$returningId();
        await db.insert(sheetEvents).values({
          sheetId,
          loadId,
          action: "COMPLETED",
          detail: `Load ${n} · ${truck} · net ${net.toLocaleString()} lbs${binName ? ` → ${binName}` : ""}`,
          createdAt: tareAt,
        });
        eodAccumulate(siteId, created, (t) => {
          t.loadCount += 1;
          t.completedCount += 1;
          if (dir === "INBOUND") {
            t.inboundLbs += net;
            t.inboundBu += calc.netBushels;
          } else {
            t.outboundLbs += net;
            t.outboundBu += calc.netBushels;
          }
        });
      }

      if (def.onScale) {
        n += 1;
        const [truck, first] = def.onScale;
        const at = day(0, 10, 42);
        const [{ id: loadId }] = await db
          .insert(loads)
          .values({
            sheetId,
            loadNo: n,
            truckId: truck,
            ...(dir === "INBOUND" ? { grossLbs: first, grossAt: at } : { tareLbs: first, tareAt: at }),
            createdAt: at,
          })
          .$returningId();
        await db.insert(sheetEvents).values({
          sheetId,
          loadId,
          action: "WEIGH_IN",
          detail: `Load ${n} · ${first.toLocaleString()} lbs captured · ${truck}`,
          createdAt: at,
        });
        eodAccumulate(siteId, created, (t) => {
          t.loadCount += 1;
        });
      }

      if (def.status !== "OPEN") {
        await db.insert(sheetEvents).values({
          sheetId,
          action: "CLOSED",
          detail: "End-of-day close at site — sheet locked",
          createdAt: day(def.daysAgo, 17, 30),
        });
      }
    }
  }

  // ------------------------------------------- eod_reports + sync_log rows
  const siteNameById: Record<number, string> = {
    [mainId]: "Main Street Elevator",
    [westId]: "West Depot",
  };
  for (const [key, t] of eodTotals) {
    const [siteIdStr, dayStr] = key.split("|");
    const siteId = Number(siteIdStr);
    await db.insert(eodReports).values({
      siteId,
      day: dayStr,
      sheetsOpened: t.sheetsOpened,
      loadCount: t.loadCount,
      completedCount: t.completedCount,
      inboundLbs: t.inboundLbs,
      outboundLbs: t.outboundLbs,
      inboundBu: Math.round(t.inboundBu * 100) / 100,
      outboundBu: Math.round(t.outboundBu * 100) / 100,
      createdAt: new Date(`${dayStr}T17:35:00`),
    });
    await db.insert(syncLog).values({
      direction: "RECEIVE",
      status: "OK",
      detail: `${siteNameById[siteId]} ${dayStr}: ${t.sheetsOpened} sheets / ${t.loadCount} loads`,
      createdAt: new Date(`${dayStr}T17:35:00`),
    });
  }

  console.log("[seed] Office demo dataset loaded.");
  return true;
}

// Standalone: `npx tsx db/seed.ts`
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seedIfEmpty()
    .then((seeded) => {
      console.log(seeded ? "Seeded." : "Already had data — skipped.");
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
