import { sql } from "drizzle-orm";
import type { Queryable } from "./contracts";
// SQL text is internal source code. Only values become bound parameters.
export function transactionQueries(tx: any): Queryable {
  return {
    query: async (text, params = []) =>
      tx.execute(
        sql.join(
          text
            .split(/(\$\d+)/g)
            .filter(Boolean)
            .map((part) =>
              /^\$\d+$/.test(part)
                ? sql.param(params[Number(part.slice(1)) - 1])
                : sql.raw(part),
            ),
          sql.raw(""),
        ),
      ),
  };
}
