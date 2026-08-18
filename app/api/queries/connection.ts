import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import mysql from "mysql2/promise";
import { drizzle as drizzleMysql, type MySql2Database } from "drizzle-orm/mysql2";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";
import * as sqliteSchema from "../../db/sqliteSchema";
import { env } from "../lib/env";

// ---------------------------------------------------------------------------
// Database connection.
//
// Production (docker-compose): MySQL via DATABASE_URL. The mysql container
// takes a while to become healthy, so the connect probe retries for ~30s at
// 1s intervals. Table creation on MySQL is owned by drizzle migrations
// (db/migrations, applied by migrateOnBoot on every boot).
//
// Dev fallback: if MySQL is missing/unreachable after the retries we open an
// embedded better-sqlite3 database at data/grain-tracker-offline.db using the
// sqlite mirror schema (db/sqliteSchema.ts). Offline mode is a dev-only
// convenience — routers use MySQL-only .$returningId(), so some write paths
// diverge offline by design. The offline handle is cast to the MySQL db type
// so every router call-site typechecks against one type.
// ---------------------------------------------------------------------------

/** Active drizzle instance, always typed as the MySQL database. */
export type Db = MySql2Database<typeof schema>;

let db: Db | null = null;
let offline = false;

const CONNECT_ATTEMPTS = 30;
const CONNECT_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// SQLite DDL — equivalent schema for the offline fallback (db/sqliteSchema.ts)
// ---------------------------------------------------------------------------
const SQLITE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "sites" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS "bins" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "siteId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "crop" TEXT NOT NULL,
    "capacityLbs" INTEGER NOT NULL,
    "currentLbs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "bins_site_idx" ON "bins" ("siteId")`,
  `CREATE TABLE IF NOT EXISTS "farmers" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS "landlords" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS "lots" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "farmerId" INTEGER NOT NULL,
    "landlordId" INTEGER,
    "code" TEXT NOT NULL UNIQUE,
    "crop" TEXT NOT NULL,
    "landlordSplitPct" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    "closedAt" INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS "lots_farmer_idx" ON "lots" ("farmerId")`,
  `CREATE INDEX IF NOT EXISTS "lots_code_idx" ON "lots" ("code")`,
  `CREATE TABLE IF NOT EXISTS "weight_sheets" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "ticketNo" TEXT NOT NULL UNIQUE,
    "siteId" INTEGER NOT NULL,
    "farmerId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "landlordId" INTEGER,
    "crop" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closeReason" TEXT,
    "maxLoads" INTEGER NOT NULL DEFAULT 10,
    "notes" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    "closedAt" INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS "sheets_farmer_idx" ON "weight_sheets" ("farmerId")`,
  `CREATE INDEX IF NOT EXISTS "sheets_lot_idx" ON "weight_sheets" ("lotId")`,
  `CREATE INDEX IF NOT EXISTS "sheets_landlord_idx" ON "weight_sheets" ("landlordId")`,
  `CREATE INDEX IF NOT EXISTS "sheets_status_idx" ON "weight_sheets" ("status")`,
  `CREATE INDEX IF NOT EXISTS "sheets_created_idx" ON "weight_sheets" ("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "loads" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "sheetId" INTEGER NOT NULL,
    "loadNo" INTEGER NOT NULL,
    "truckId" TEXT,
    "driverName" TEXT,
    "binId" INTEGER,
    "grossLbs" INTEGER,
    "tareLbs" INTEGER,
    "netLbs" INTEGER,
    "grossAt" INTEGER,
    "tareAt" INTEGER,
    "moisturePct" REAL,
    "dockagePct" REAL,
    "testWeightLbs" REAL,
    "proteinPct" REAL,
    "shrinkPct" REAL,
    "grossBushels" REAL,
    "netBushels" REAL,
    "changeReason" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "loads_sheet_idx" ON "loads" ("sheetId")`,
  `CREATE INDEX IF NOT EXISTS "loads_truck_idx" ON "loads" ("truckId")`,
  `CREATE INDEX IF NOT EXISTS "loads_created_idx" ON "loads" ("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "sheet_events" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "sheetId" INTEGER NOT NULL,
    "loadId" INTEGER,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "events_sheet_idx" ON "sheet_events" ("sheetId")`,
  `CREATE TABLE IF NOT EXISTS "settings" (
    "key" TEXT PRIMARY KEY,
    "value" TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS "sync_log" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS "eod_reports" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "siteId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "sheetsOpened" INTEGER NOT NULL DEFAULT 0,
    "loadCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "inboundLbs" INTEGER NOT NULL DEFAULT 0,
    "outboundLbs" INTEGER NOT NULL DEFAULT 0,
    "inboundBu" REAL NOT NULL DEFAULT 0,
    "outboundBu" REAL NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "eod_site_idx" ON "eod_reports" ("siteId")`,
  `CREATE INDEX IF NOT EXISTS "eod_day_idx" ON "eod_reports" ("day")`,
];

// ---------------------------------------------------------------------------
// MySQL init — probe with retries, then ensure the schema exists
// ---------------------------------------------------------------------------
async function tryInitMysql(): Promise<Db | null> {
  const pool = mysql.createPool({
    uri: env.DATABASE_URL,
    connectionLimit: 10,
    waitForConnections: true,
  });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    try {
      // Probe only — table creation on MySQL is owned by drizzle migrations
      // (db/migrations, applied by migrateOnBoot). Running our own DDL here
      // too makes migrate() collide with the already-existing tables and its
      // failure would skip the demo seed.
      await pool.query("SELECT 1");
      console.log("[db] connected to MySQL");
      return drizzleMysql(pool, { schema, mode: "default" });
    } catch (err) {
      lastErr = err;
      if (attempt < CONNECT_ATTEMPTS) await sleep(CONNECT_DELAY_MS);
    }
  }
  console.error(
    `[db] MySQL unreachable after ${CONNECT_ATTEMPTS}s — falling back to offline mode:`,
    lastErr instanceof Error ? lastErr.message : lastErr,
  );
  await pool.end().catch(() => {});
  return null;
}

// ---------------------------------------------------------------------------
// Offline init — embedded better-sqlite3 database (dev-only fallback)
// ---------------------------------------------------------------------------
function initSqlite(): Db {
  const dir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "grain-tracker-offline.db");
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  for (const ddl of SQLITE_DDL) {
    sqlite.exec(ddl);
  }
  const sqliteDb = drizzleSqlite(sqlite, { schema: sqliteSchema });
  // Cast so all router call-sites typecheck against the MySQL db type.
  return sqliteDb as unknown as Db;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Establish the database connection (MySQL, or the embedded offline database
 * when MySQL is missing/unreachable). Idempotent — safe to call on every boot.
 */
export async function initDb(): Promise<Db> {
  if (db) return db;
  const mysqlDb = await tryInitMysql();
  if (mysqlDb) {
    db = mysqlDb;
    offline = false;
  } else {
    db = initSqlite();
    offline = true;
    console.warn("[db] OFFLINE MODE — using embedded database (data/grain-tracker-offline.db)");
  }
  return db;
}

/** The active drizzle instance. Throws if initDb() has not run yet. */
export function getDb(): Db {
  if (!db) {
    throw new Error("Database not initialized — call initDb() first");
  }
  return db;
}

/** true when initDb() fell back to the embedded offline database. */
export function isOffline(): boolean {
  return offline;
}
