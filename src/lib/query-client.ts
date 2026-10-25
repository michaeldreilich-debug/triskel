import { QueryClient } from "@tanstack/react-query";

/**
 * TanStack Query (E1, E11): Daten-Cache im Browser, keine Realtime –
 * Neuladen beim Fensterfokus. Optimistische Updates laufen über die Speicher-Warteschlange.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 2,
      },
      mutations: { retry: 0 },
    },
  });
}
