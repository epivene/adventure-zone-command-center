export type QueryRow = Record<string, unknown>;

function isQueryRow(value: unknown): value is QueryRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function queryRows<T extends QueryRow>(
  result: unknown,
  isRow: (row: QueryRow) => row is T,
): T[] {
  if (!isQueryRow(result)) return [];
  const rows = result.rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is T => isQueryRow(row) && isRow(row));
}

export function firstQueryRow<T extends QueryRow>(
  result: unknown,
  isRow: (row: QueryRow) => row is T,
): T | null {
  return queryRows(result, isRow)[0] ?? null;
}
