/**
 * Alle Zeilen einer Abfrage laden – PostgREST liefert je Anfrage höchstens 1000 Zeilen
 * (Supabase-Standard „Max rows“). Seitenweise per range(), bis eine Seite kürzer ist.
 */
export const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) return rows;
  }
}
