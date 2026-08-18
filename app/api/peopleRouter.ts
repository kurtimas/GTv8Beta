import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { farmers, landlords, lots } from "@db/schema";
import { eq } from "drizzle-orm";
import { CROPS } from "@contracts/grain";
import { nextLotCode } from "@contracts/lotCode";

export const peopleRouter = createRouter({
  // ----------------------------------------------------------- farmers
  farmers: createRouter({
    list: publicQuery.query(() => getDb().select().from(farmers).orderBy(farmers.name)),
    create: publicQuery
      .input(
        z.object({
          name: z.string().min(1),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
        }),
      )
      .mutation(async ({ input }) => {
        const [{ id }] = await getDb()
          .insert(farmers)
          .values({ name: input.name, phone: input.phone || null, email: input.email || null })
          .$returningId();
        return getDb().query.farmers.findFirst({ where: eq(farmers.id, id) });
      }),
    update: publicQuery
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await getDb().update(farmers).set(data).where(eq(farmers.id, id));
        return getDb().query.farmers.findFirst({ where: eq(farmers.id, id) });
      }),
  }),

  // ---------------------------------------------------------- landlords
  landlords: createRouter({
    list: publicQuery.query(() => getDb().select().from(landlords).orderBy(landlords.name)),
    create: publicQuery
      .input(z.object({ name: z.string().min(1), phone: z.string().optional() }))
      .mutation(async ({ input }) => {
        const [{ id }] = await getDb()
          .insert(landlords)
          .values({ name: input.name, phone: input.phone || null })
          .$returningId();
        return getDb().query.landlords.findFirst({ where: eq(landlords.id, id) });
      }),
  }),

  // --------------------------------------------------------------- lots
  lots: createRouter({
    list: publicQuery.query(async () => {
      const db = getDb();
      const rows = await db
        .select({
          lot: lots,
          farmerName: farmers.name,
          landlordName: landlords.name,
        })
        .from(lots)
        .leftJoin(farmers, eq(lots.farmerId, farmers.id))
        .leftJoin(landlords, eq(lots.landlordId, landlords.id))
        .orderBy(lots.code);
      return rows.map((r) => ({ ...r.lot, farmerName: r.farmerName, landlordName: r.landlordName }));
    }),
    // suggested next lot code for a farmer: 706C-<INITIALS>-<YY><NN>
    nextCode: publicQuery
      .input(z.object({ farmerId: z.number() }))
      .query(async ({ input }) => {
        const db = getDb();
        const farmer = await db.query.farmers.findFirst({
          where: eq(farmers.id, input.farmerId),
        });
        if (!farmer) throw new Error("Farmer not found");
        const rows = await db.select({ code: lots.code }).from(lots);
        return { code: nextLotCode(rows.map((r) => r.code), farmer.name) };
      }),
    create: publicQuery
      .input(
        z.object({
          farmerId: z.number(),
          landlordId: z.number().nullable().optional(),
          code: z.string().min(1),
          crop: z.enum(CROPS),
          landlordSplitPct: z.number().min(0).max(100).default(0),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const [{ id }] = await getDb()
          .insert(lots)
          .values({ ...input, landlordId: input.landlordId ?? null })
          .$returningId();
        return getDb().query.lots.findFirst({ where: eq(lots.id, id) });
      }),
    update: publicQuery
      .input(
        z.object({
          id: z.number(),
          landlordId: z.number().nullable().optional(),
          landlordSplitPct: z.number().min(0).max(100).optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await getDb().update(lots).set(data).where(eq(lots.id, id));
        return getDb().query.lots.findFirst({ where: eq(lots.id, id) });
      }),
    // Lots stay open until the grower says the lot is done. While CLOSED no
    // new weight sheets can be opened against the lot; reopening is allowed.
    setStatus: publicQuery
      .input(z.object({ id: z.number(), status: z.enum(["OPEN", "CLOSED"]) }))
      .mutation(async ({ input }) => {
        const lot = await getDb().query.lots.findFirst({ where: eq(lots.id, input.id) });
        if (!lot) throw new Error("Lot not found");
        await getDb()
          .update(lots)
          .set({
            status: input.status,
            closedAt: input.status === "CLOSED" ? new Date() : null,
          })
          .where(eq(lots.id, input.id));
        return getDb().query.lots.findFirst({ where: eq(lots.id, input.id) });
      }),
  }),
});

export type PeopleRouter = typeof peopleRouter;
