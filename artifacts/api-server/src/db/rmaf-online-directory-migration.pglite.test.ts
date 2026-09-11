import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

describe("20260910 RMAF online directory migration", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("starts with an executable database transaction", async () => {
    const sql = await readFile(
      new URL("../../../../lib/db/migrations/20260910_rmaf_online_directory.sql", import.meta.url),
      "utf8",
    );
    const transactionEnd = sql.indexOf(";");
    expect(transactionEnd).toBeGreaterThan(-1);

    const client = new PGlite();
    clients.push(client);
    await client.exec(sql.slice(0, transactionEnd + 1));

    expect((await client.query<{ active: boolean }>(
      "select transaction_timestamp() is not null as active",
    )).rows[0]?.active).toBe(true);
  });
});
