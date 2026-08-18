import { createRouter, publicQuery } from "./middleware";
import { coreRouter } from "./coreRouter";
import { peopleRouter } from "./peopleRouter";
import { sheetsRouter } from "./sheetsRouter";
import { officeRouter } from "./officeRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  core: coreRouter,
  people: peopleRouter,
  sheets: sheetsRouter,
  office: officeRouter,
});

export type AppRouter = typeof appRouter;
