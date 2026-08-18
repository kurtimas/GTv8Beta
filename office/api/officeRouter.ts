import { z } from "zod";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { bins, eodReports, loads, sites, syncLog, weightSheets } from "@db/schema";

// ---------------------------------------------------------------------------
// Office-only queries: per-site overview cards (bin fill, last upload,
// today's activity) and the end-of-day upload history.
// ---------------------------------------------------------------------------

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const officeRouter = createRouter({
  // Per-site overview for the office home page: bins, last EOD upload time,
  // and today's mirrored sheet/load activity.
  overview: publicQuery.query(async () => {
    const db = getDb();
    const siteRows = await db.select().from(sites).orderBy(asc(sites.name));
    const binRows = await db.select().from(bins).orderBy(asc(bins.name));
    const receiveRows = await db
      .select()
      .from(syncLog)
      .where(and(eq(syncLog.direction, "RECEIVE"), eq(syncLog.status, "OK")))
      .orderBy(desc(syncLog.createdAt))
      .limit(200);

    const from = startOfToday();
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);
    const todaySheetRows = await db
      .select()
      .from(weightSheets)
      .where(and(gte(weightSheets.createdAt, from), lte(weightSheets.createdAt, to)));

    return siteRows.map((site) => {
      const siteBins = binRows.filter((b) => b.siteId === site.id);
      const capacity = siteBins.reduce((a, b) => a + b.capacityLbs, 0);
      const current = siteBins.reduce((a, b) => a + b.currentLbs, 0);
      // sync_log rows carry the site name in their detail ("<site> <day>: …")
      const lastReceive =
        receiveRows.find((r) => r.detail?.startsWith(`${site.name} `))?.createdAt ?? null;
      const sheetsToday = todaySheetRows.filter((s) => s.siteId === site.id);
      return {
        site,
        bins: siteBins,
        fillPct: capacity > 0 ? Math.round((current / capacity) * 100) : 0,
        capacityLbs: capacity,
        currentLbs: current,
        lastReceiveAt: lastReceive,
        todaySheets: sheetsToday.length,
      };
    });
  }),

  // Today's mirrored loads (all sites) — used for the home-page totals.
  todayLoads: publicQuery.query(async () => {
    const db = getDb();
    const from = startOfToday();
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);
    const rows = await db
      .select({ load: loads, siteId: weightSheets.siteId })
      .from(loads)
      .leftJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
      .where(and(gte(loads.createdAt, from), lte(loads.createdAt, to)));
    const done = rows.filter((r) => r.load.netLbs != null);
    return {
      loadCount: rows.length,
      completedCount: done.length,
      netLbs: done.reduce((a, r) => a + (r.load.netLbs ?? 0), 0),
    };
  }),

  // End-of-day upload history, newest first, optionally per site.
  eodReports: publicQuery
    .input(z.object({ siteId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({ report: eodReports, siteName: sites.name })
        .from(eodReports)
        .leftJoin(sites, eq(eodReports.siteId, sites.id))
        .where(input?.siteId ? eq(eodReports.siteId, input.siteId) : undefined)
        .orderBy(desc(eodReports.day), asc(sites.name));
      return rows.map((r) => ({ ...r.report, siteName: r.siteName }));
    }),
});

export type OfficeRouter = typeof officeRouter;
