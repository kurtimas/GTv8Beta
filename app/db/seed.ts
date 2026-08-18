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
} from "./schema";
import { eq } from "drizzle-orm";
import { computeBushels } from "../contracts/grain";

/** Insert a sheet and assign its T-##### ticket number from the new id. */
async function insertSheet(
  db: ReturnType<typeof getDb>,
  row: Omit<typeof weightSheets.$inferInsert, "ticketNo">,
) {
  const [{ id }] = await db
    .insert(weightSheets)
    .values({ ...row, ticketNo: "PENDING" })
    .$returningId();
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

// [truck, gross, tare, moisture, dockage, testWeight, protein|null, binName|null]
type LoadDef = [string, number, number, number, number, number, number | null, string | null];

type SheetDef = {
  daysAgo: number;
  lotIdx: number | null; // null → lot-less outbound sheet
  farmerIdx?: number; // required when lotIdx is null
  crop?: string; // required when lotIdx is null
  dir?: "INBOUND" | "OUTBOUND";
  status: "OPEN" | "FULL" | "CLOSED";
  /** completed loads, in order */
  done: LoadDef[];
  /** one load still on the scale (first weight only) */
  onScale?: [string, number]; // [truck, firstWeight]
};

/** Seed demo data only when the database is empty. Safe to call on every boot. */
export async function seedIfEmpty() {
  const db = getDb();
  const existing = await db.select({ id: farmers.id }).from(farmers).limit(1);
  if (existing.length > 0) return false;

  console.log("[seed] Empty database — loading demo dataset...");

  // ---------------------------------------------------------- site & bins
  const [{ id: siteId }] = await db
    .insert(sites)
    .values({ name: "Main Street Elevator", location: "Haven, KS" })
    .$returningId();

  const binDefs = [
    { name: "Bin 1", crop: "Corn", capacityLbs: 1_680_000, currentLbs: 412_000 },
    { name: "Bin 2", crop: "Corn", capacityLbs: 1_680_000, currentLbs: 96_500 },
    { name: "Bin 3", crop: "Wheat", capacityLbs: 1_200_000, currentLbs: 655_000 },
    { name: "Bin 4", crop: "Soybeans", capacityLbs: 1_200_000, currentLbs: 187_000 },
    { name: "Bin 5", crop: "Sorghum", capacityLbs: 900_000, currentLbs: 0 },
    { name: "Flat Storage", crop: "Wheat", capacityLbs: 2_400_000, currentLbs: 1_020_000 },
  ];
  const binIds: Record<string, number> = {};
  for (const b of binDefs) {
    const [{ id }] = await db
      .insert(bins)
      .values({ ...b, crop: b.crop === "Milo (Sorghum)" ? "Sorghum" : b.crop, siteId })
      .$returningId();
    binIds[b.name] = id;
  }

  // -------------------------------------------------------- farmers etc.
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

  // ---------------------------------------------------- sheets + loads
  const sheetDefs: SheetDef[] = [
    // Kurt Miller corn — several sheets over several days on one lot
    {
      daysAgo: 4, lotIdx: 0, status: "CLOSED",
      done: [
        ["KM-04 Peterbilt", 79980, 29540, 16.2, 0.5, 57.1, null, "Bin 1"],
        ["KM-11 Kenworth", 81500, 30110, 16.4, 0.5, 57.0, null, "Bin 1"],
        ["KM-04 Peterbilt", 80260, 29540, 16.3, 0.6, 57.0, null, "Bin 1"],
        ["KM-11 Kenworth", 82250, 30110, 16.8, 0.5, 56.9, null, "Bin 1"],
      ],
    },
    {
      daysAgo: 2, lotIdx: 0, status: "CLOSED",
      done: [
        ["KM-04 Peterbilt", 81800, 29540, 16.5, 0.5, 57.2, null, "Bin 1"],
        ["KM-11 Kenworth", 82400, 30110, 16.6, 0.5, 57.0, null, "Bin 1"],
        ["KM-04 Peterbilt", 80940, 29540, 16.4, 0.4, 57.1, null, "Bin 1"],
      ],
    },
    // today's corn sheet — still open, one truck on the scale right now
    {
      daysAgo: 0, lotIdx: 0, status: "OPEN",
      done: [
        ["KM-04 Peterbilt", 81240, 29540, 16.5, 0.5, 57.0, null, "Bin 1"],
        ["KM-11 Kenworth", 82010, 30110, 16.7, 0.5, 56.8, null, "Bin 1"],
        ["KM-04 Peterbilt", 81560, 29540, 16.6, 0.5, 57.0, null, "Bin 1"],
      ],
      onScale: ["KM-11 Kenworth", 82300],
    },
    // Kurt Miller wheat (crop-share) — a full 10-load sheet
    {
      daysAgo: 5, lotIdx: 1, status: "FULL",
      done: [
        ["KM-04 Peterbilt", 80100, 29540, 13.1, 0.7, 60.8, 11.4, "Bin 3"],
        ["KM-11 Kenworth", 80600, 30110, 13.0, 0.6, 61.0, 11.6, "Bin 3"],
        ["KM-04 Peterbilt", 80300, 29540, 13.2, 0.7, 60.7, 11.5, "Bin 3"],
        ["KM-11 Kenworth", 79850, 30110, 13.1, 0.6, 60.9, 11.7, "Bin 3"],
        ["KM-04 Peterbilt", 80720, 29540, 13.3, 0.7, 60.6, 11.5, "Flat Storage"],
        ["KM-11 Kenworth", 80410, 30110, 13.2, 0.6, 60.8, 11.6, "Flat Storage"],
        ["KM-04 Peterbilt", 79930, 29540, 13.0, 0.5, 61.1, 11.8, "Flat Storage"],
        ["KM-11 Kenworth", 80280, 30110, 13.1, 0.6, 60.9, 11.6, "Flat Storage"],
        ["KM-04 Peterbilt", 80540, 29540, 13.2, 0.6, 60.7, 11.5, "Flat Storage"],
        ["KM-11 Kenworth", 80090, 30110, 13.0, 0.5, 61.2, 11.9, "Flat Storage"],
      ],
    },
    // Dale Unruh corn
    {
      daysAgo: 1, lotIdx: 2, status: "CLOSED",
      done: [
        ["DU Silverado+trailer", 68400, 26150, 17.1, 1.0, 56.2, null, "Bin 2"],
        ["DU Silverado+trailer", 69100, 26150, 17.3, 1.1, 56.0, null, "Bin 2"],
        ["DU Silverado+trailer", 68750, 26150, 17.0, 1.0, 56.3, null, "Bin 2"],
        ["DU Silverado+trailer", 69220, 26150, 17.2, 1.0, 56.1, null, "Bin 2"],
      ],
    },
    // S&C Farms soybeans — sheet open today, plus one outbound ship-out
    {
      daysAgo: 0, lotIdx: 3, status: "OPEN",
      done: [["SCF Pete 379", 75600, 28900, 12.2, 0.8, 56.7, null, "Bin 4"]],
    },
    {
      daysAgo: 3, lotIdx: null, farmerIdx: 2, crop: "Soybeans", dir: "OUTBOUND", status: "CLOSED",
      done: [
        ["SCF Pete 379", 77400, 28900, 0, 0, 0, null, "Bin 4"],
        ["SCF Pete 379", 76850, 28900, 0, 0, 0, null, "Bin 4"],
      ],
    },
    // Marlene Klassen wheat
    {
      daysAgo: 2, lotIdx: 4, status: "CLOSED",
      done: [
        ["MK Freightliner", 78900, 29400, 12.8, 0.6, 61.2, 12.1, "Bin 3"],
        ["MK Freightliner", 79200, 29400, 12.6, 0.5, 61.5, 12.3, "Bin 3"],
        ["MK Freightliner", 78500, 29400, 12.9, 0.6, 61.1, 12.0, "Bin 3"],
        ["MK Freightliner", 79000, 29400, 12.7, 0.5, 61.3, 12.2, "Bin 3"],
        ["MK Freightliner", 78650, 29400, 12.8, 0.6, 61.0, 12.1, "Bin 3"],
      ],
    },
    {
      daysAgo: 0, lotIdx: 4, status: "OPEN",
      done: [
        ["MK Freightliner", 78830, 29400, 13.0, 0.6, 61.0, 12.0, "Bin 3"],
        ["MK Freightliner", 79120, 29400, 12.9, 0.5, 61.4, 12.2, "Bin 3"],
      ],
    },
    // Triple J sorghum — lot finished and closed by the grower
    {
      daysAgo: 7, lotIdx: 5, status: "CLOSED",
      done: [
        ["TJJ Mack", 72300, 27800, 13.6, 1.2, 58.4, null, "Bin 5"],
        ["TJJ Mack", 71900, 27800, 13.9, 1.0, 58.1, null, "Bin 5"],
        ["TJJ Mack", 72110, 27800, 13.7, 1.1, 58.3, null, "Bin 5"],
      ],
    },
  ];

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
      action: "CREATED",
      detail: `Weight sheet ${ticketNo} opened (${dir})`,
      createdAt: created,
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
          binId: binName ? binIds[binName] : null,
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
    }

    if (def.status !== "OPEN") {
      await db.insert(sheetEvents).values({
        sheetId,
        action: def.status === "FULL" ? "SHEET_FULL" : "CLOSED",
        detail:
          def.status === "FULL"
            ? "10/10 loads — sheet closed, start a new sheet for this lot"
            : "End-of-day close — sheet locked",
        createdAt: day(def.daysAgo, def.status === "FULL" ? 15 : 17, 30),
      });
    }
  }

  console.log("[seed] Demo dataset loaded.");
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
