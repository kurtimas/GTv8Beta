import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb, initDb, isOffline } from "./queries/connection";
import { seedIfEmpty } from "../db/seed";

/**
 * Runs once at server start: establishes the database (MySQL, or the embedded
 * offline database when MySQL is missing/unreachable), applies migrations for
 * MySQL, then loads the demo dataset if the database is empty. Failures are
 * logged but never crash the server.
 */
export async function migrateAndSeedOnBoot() {
  try {
    await initDb();
    const db = getDb();
    if (isOffline()) {
      console.log("[boot] running in OFFLINE MODE (embedded local database)");
    } else {
      await migrate(db, {
        migrationsFolder: path.resolve(process.cwd(), "db/migrations"),
      });
      console.log("[boot] database schema up to date");
    }
    if (process.env.SEED_DEMO === "false") {
      console.log("[boot] SEED_DEMO=false — skipping demo dataset");
    } else {
      const seeded = await seedIfEmpty();
      if (seeded) console.log("[boot] demo dataset loaded");
    }
  } catch (err) {
    console.error("[boot] migration/seed failed:", err);
  }
}
