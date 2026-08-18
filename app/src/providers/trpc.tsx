import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";

/**
 * Provides the React Query client + tRPC client to the app tree.
 * Mounted once in main.tsx.
 */
export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 5_000,
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

/**
 * Polls `ping` every 10s. Returns true while the server answers.
 * Optimistic (true) until the first failure so the offline banner
 * doesn't flash during initial load.
 */
export function useServerOnline(): boolean {
  const query = trpc.ping.useQuery(undefined, {
    refetchInterval: 10_000,
    retry: 0,
  });
  if (query.isError) return false;
  return query.data?.ok ?? true;
}
