/**
 * UI-10 F4b. PostgREST returns at most 1,000 rows a request. Reads every
 * page of an ordered query (the order must be unique, so no row is skipped
 * or read twice), and refuses past `maxRows` rather than paint half a map.
 */
export const PAGE_ROWS = 1000;

export class TooManyRows extends Error {
  constructor() {
    super("too many rows");
  }
}

export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows = 50_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    if (from >= maxRows) throw new TooManyRows();
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_ROWS) return rows;
  }
}
