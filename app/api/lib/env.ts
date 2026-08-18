// ---------------------------------------------------------------------------
// Environment — single typed accessor for process.env. Everything the server
// needs at boot is read once here so the rest of the codebase never touches
// process.env directly (boot.ts reads PORT itself to stay dependency-free).
// ---------------------------------------------------------------------------

export const env = {
  /** true when NODE_ENV=production (Docker image boots dist/boot.js with it). */
  isProduction: process.env.NODE_ENV === "production",

  /** MySQL connection string, e.g. mysql://grain:pw@mysql:3306/graintracker */
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "mysql://grain:password@localhost:3306/graintracker",

  /** Install identity + shared secret used for office sync authentication. */
  APP_ID: process.env.APP_ID ?? "grain-tracker-local",
  APP_SECRET: process.env.APP_SECRET ?? "",

  /** Set SEED_DEMO=false to skip the demo dataset on first boot. */
  SEED_DEMO: process.env.SEED_DEMO !== "false",

  /** HTTP port for the production server. */
  PORT: parseInt(process.env.PORT || "3000", 10),
} as const;
