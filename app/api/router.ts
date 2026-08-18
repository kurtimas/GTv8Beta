import { createRouter, publicQuery } from "./middleware";
import { coreRouter } from "./coreRouter";
import { peopleRouter } from "./peopleRouter";
import { sheetsRouter } from "./sheetsRouter";
import { syncRouter } from "./syncRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  core: coreRouter,
  people: peopleRouter,
  sheets: sheetsRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
