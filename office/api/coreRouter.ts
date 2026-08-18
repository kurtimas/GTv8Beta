import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { sites, bins, loads } from "@db/schema";
import { eq } from "drizzle-orm";
import { CROPS } from "@contracts/grain";

export const coreRouter = createRouter({
  // ------------------------------------------------------------- sites
  sites: createRouter({
    list: publicQuery.query(() => getDb().select().from(sites).orderBy(sites.name)),
    create: publicQuery
      .input(z.object({ name: z.string().min(1), location: z.string().optional() }))
      .mutation(async ({ input }) => {
        const [{ id }] = await getDb().insert(sites).values(input).$returningId();
        return getDb().query.sites.findFirst({ where: eq(sites.id, id) });
      }),
  }),

  // -------------------------------------------------------------- bins
  bins: createRouter({
    list: publicQuery.query(async () => {
      const db = getDb();
      const rows = await db
        .select({ bin: bins, siteName: sites.name })
        .from(bins)
        .leftJoin(sites, eq(bins.siteId, sites.id))
        .orderBy(sites.name, bins.name);
      return rows.map((r) => ({ ...r.bin, siteName: r.siteName }));
    }),
    create: publicQuery
      .input(
        z.object({
          siteId: z.number(),
          name: z.string().min(1),
          crop: z.enum(CROPS),
          capacityLbs: z.number().int().positive(),
        }),
      )
      .mutation(async ({ input }) => {
        const [{ id }] = await getDb().insert(bins).values(input).$returningId();
        return getDb().query.bins.findFirst({ where: eq(bins.id, id) });
      }),
    update: publicQuery
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).optional(),
          crop: z.enum(CROPS).optional(),
          capacityLbs: z.number().int().positive().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await getDb().update(bins).set(data).where(eq(bins.id, id));
        return getDb().query.bins.findFirst({ where: eq(bins.id, id) });
      }),
    // Delete an empty bin with no ticket history
    delete: publicQuery
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = getDb();
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.id) });
        if (!bin) throw new Error("Bin not found");
        if (bin.currentLbs > 0)
          throw new Error("Bin is not empty — adjust the level to 0 before deleting");
        const refs = await db
          .select({ id: loads.id })
          .from(loads)
          .where(eq(loads.binId, input.id))
          .limit(1);
        if (refs.length) throw new Error("Bin has load history and cannot be deleted");
        await db.delete(bins).where(eq(bins.id, input.id));
        return { ok: true };
      }),
    // Manual level correction (e.g. after physical measurement)
    adjust: publicQuery
      .input(z.object({ id: z.number(), currentLbs: z.number().int().min(0) }))
      .mutation(async ({ input }) => {
        await getDb()
          .update(bins)
          .set({ currentLbs: input.currentLbs })
          .where(eq(bins.id, input.id));
        return getDb().query.bins.findFirst({ where: eq(bins.id, input.id) });
      }),
  }),
});

export type CoreRouter = typeof coreRouter;
