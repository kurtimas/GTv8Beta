import {
  mysqlTable,
  mysqlEnum,
  serial,
  bigint,
  int,
  double,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/mysql-core";

// ---------------------------------------------------------------------------
// Sites (grain elevator locations)
// ---------------------------------------------------------------------------
export const sites = mysqlTable("sites", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  location: varchar("location", { length: 255 }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Bins (storage per site)
// ---------------------------------------------------------------------------
export const bins = mysqlTable(
  "bins",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    crop: varchar("crop", { length: 64 }).notNull(),
    capacityLbs: int("capacityLbs").notNull(),
    currentLbs: int("currentLbs").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({ siteIdx: index("bins_site_idx").on(t.siteId) }),
);

// ---------------------------------------------------------------------------
// Farmers & landlords
// ---------------------------------------------------------------------------
export const farmers = mysqlTable("farmers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 64 }),
  email: varchar("email", { length: 320 }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const landlords = mysqlTable("landlords", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 64 }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Lots — a farmer's unique lot/field identity, optionally crop-shared with a
// landlord (landlordSplitPct = landlord's share of each load, 0-100).
// A lot stays OPEN until the grower says it's done; while CLOSED no new
// weight sheets can be opened against it.
// ---------------------------------------------------------------------------
export const lots = mysqlTable(
  "lots",
  {
    id: serial("id").primaryKey(),
    farmerId: bigint("farmerId", { mode: "number", unsigned: true }).notNull(),
    landlordId: bigint("landlordId", { mode: "number", unsigned: true }),
    code: varchar("code", { length: 64 }).notNull().unique(),
    crop: varchar("crop", { length: 64 }).notNull(),
    landlordSplitPct: double("landlordSplitPct").notNull().default(0),
    status: mysqlEnum("status", ["OPEN", "CLOSED"]).notNull().default("OPEN"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    closedAt: timestamp("closedAt"),
  },
  (t) => ({
    farmerIdx: index("lots_farmer_idx").on(t.farmerId),
    codeIdx: index("lots_code_idx").on(t.code),
  }),
);

// ---------------------------------------------------------------------------
// Weight sheets — the multi-load document tied to one lot (like the paper
// Grain Weight Certificate): header carries farmer/lot/landlord/crop and the
// sheet holds up to `maxLoads` individual truck loads (see `loads`).
//   OPEN   — accepting loads (fewer than maxLoads recorded)
//   FULL   — maxLoads reached; sheet closed automatically, start a new sheet
//   CLOSED — locked by end-of-day close (no further edits)
// closeReason: FULL | EOD | MANUAL
// ---------------------------------------------------------------------------
export const weightSheets = mysqlTable(
  "weight_sheets",
  {
    id: serial("id").primaryKey(),
    ticketNo: varchar("ticketNo", { length: 32 }).notNull().unique(),
    siteId: bigint("siteId", { mode: "number", unsigned: true }).notNull(),
    farmerId: bigint("farmerId", { mode: "number", unsigned: true }).notNull(),
    lotId: bigint("lotId", { mode: "number", unsigned: true }),
    landlordId: bigint("landlordId", { mode: "number", unsigned: true }),
    crop: varchar("crop", { length: 64 }).notNull(),
    direction: mysqlEnum("direction", ["INBOUND", "OUTBOUND"]).notNull().default("INBOUND"),
    status: mysqlEnum("status", ["OPEN", "FULL", "CLOSED"]).notNull().default("OPEN"),
    closeReason: varchar("closeReason", { length: 16 }),
    maxLoads: int("maxLoads").notNull().default(10),
    notes: text("notes"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
    closedAt: timestamp("closedAt"),
  },
  (t) => ({
    farmerIdx: index("sheets_farmer_idx").on(t.farmerId),
    lotIdx: index("sheets_lot_idx").on(t.lotId),
    landlordIdx: index("sheets_landlord_idx").on(t.landlordId),
    statusIdx: index("sheets_status_idx").on(t.status),
    createdIdx: index("sheets_created_idx").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Loads — one truck visit on a weight sheet (one row of the paper sheet).
// Inbound: gross captured first, tare second. Outbound reverses. Grades
// (moisture, dockage, test weight, protein) are per load.
// ---------------------------------------------------------------------------
export const loads = mysqlTable(
  "loads",
  {
    id: serial("id").primaryKey(),
    sheetId: bigint("sheetId", { mode: "number", unsigned: true }).notNull(),
    loadNo: int("loadNo").notNull(),
    truckId: varchar("truckId", { length: 64 }),
    driverName: varchar("driverName", { length: 255 }),
    binId: bigint("binId", { mode: "number", unsigned: true }),
    grossLbs: int("grossLbs"),
    tareLbs: int("tareLbs"),
    netLbs: int("netLbs"),
    grossAt: timestamp("grossAt"),
    tareAt: timestamp("tareAt"),
    // grading (TEST utilities)
    moisturePct: double("moisturePct"),
    dockagePct: double("dockagePct"),
    testWeightLbs: double("testWeightLbs"),
    proteinPct: double("proteinPct"),
    shrinkPct: double("shrinkPct"),
    grossBushels: double("grossBushels"),
    netBushels: double("netBushels"),
    changeReason: text("changeReason"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    sheetIdx: index("loads_sheet_idx").on(t.sheetId),
    truckIdx: index("loads_truck_idx").on(t.truckId),
    createdIdx: index("loads_created_idx").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Audit trail — every weight capture / edit / status change
// ---------------------------------------------------------------------------
export const sheetEvents = mysqlTable(
  "sheet_events",
  {
    id: serial("id").primaryKey(),
    sheetId: bigint("sheetId", { mode: "number", unsigned: true }).notNull(),
    loadId: bigint("loadId", { mode: "number", unsigned: true }),
    action: varchar("action", { length: 64 }).notNull(),
    detail: text("detail"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({ sheetIdx: index("events_sheet_idx").on(t.sheetId) }),
);

// ---------------------------------------------------------------------------
// Main-office sync — key/value settings (office URL + shared key) and a log
// of every push/pull attempt. eod_reports is used by the OFFICE portal to
// store one end-of-day summary per site per day; it exists in both schemas so
// the two deployments share one migration set.
// ---------------------------------------------------------------------------
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value"),
});

export const syncLog = mysqlTable("sync_log", {
  id: serial("id").primaryKey(),
  direction: mysqlEnum("direction", ["PUSH", "PULL", "RECEIVE"]).notNull(),
  status: mysqlEnum("status", ["OK", "ERROR"]).notNull(),
  detail: text("detail"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const eodReports = mysqlTable(
  "eod_reports",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true }).notNull(),
    day: varchar("day", { length: 10 }).notNull(), // YYYY-MM-DD
    sheetsOpened: int("sheetsOpened").notNull().default(0),
    loadCount: int("loadCount").notNull().default(0),
    completedCount: int("completedCount").notNull().default(0),
    inboundLbs: int("inboundLbs").notNull().default(0),
    outboundLbs: int("outboundLbs").notNull().default(0),
    inboundBu: double("inboundBu").notNull().default(0),
    outboundBu: double("outboundBu").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteIdx: index("eod_site_idx").on(t.siteId),
    dayIdx: index("eod_day_idx").on(t.day),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Site = typeof sites.$inferSelect;
export type Bin = typeof bins.$inferSelect;
export type Farmer = typeof farmers.$inferSelect;
export type Landlord = typeof landlords.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type WeightSheet = typeof weightSheets.$inferSelect;
export type Load = typeof loads.$inferSelect;
export type SheetEvent = typeof sheetEvents.$inferSelect;
