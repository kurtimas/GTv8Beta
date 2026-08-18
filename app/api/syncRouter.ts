import { z } from "zod";
import { desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { syncLog } from "@db/schema";
import { getSetting, setSetting, syncNow } from "./officeSync";

// ---------------------------------------------------------------------------
// Main-office sync — settings (portal URL + shared key), status log, and the
// manual "Sync now" action (pull people/lots from office, push today's data).
// ---------------------------------------------------------------------------
export const syncRouter = createRouter({
  getSettings: publicQuery.query(async () => {
    const db = getDb();
    return {
      officeUrl: await getSetting(db, "officeUrl"),
      officeKey: await getSetting(db, "officeKey"),
    };
  }),

  setSettings: publicQuery
    .input(z.object({ officeUrl: z.string(), officeKey: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await setSetting(db, "officeUrl", input.officeUrl.trim());
      await setSetting(db, "officeKey", input.officeKey.trim());
      return { ok: true };
    }),

  status: publicQuery.query(async () => {
    const rows = await getDb()
      .select()
      .from(syncLog)
      .orderBy(desc(syncLog.createdAt))
      .limit(12);
    return rows;
  }),

  syncNow: publicQuery
    .input(z.object({ date: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      const day = input?.date ? new Date(input.date) : new Date();
      return syncNow(day);
    }),
});

export type SyncRouter = typeof syncRouter;
