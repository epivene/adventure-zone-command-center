import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { CommunicationBlockRepository } from "./communication-block-repository";

const databases: PGlite[] = [];

async function createHarness() {
  const client = new PGlite();
  databases.push(client);
  await client.exec(`
    create table organizations (id uuid primary key);
    create table contacts (id uuid primary key);
    create table lead_import_rows (id uuid primary key);
    insert into organizations values ('10000000-0000-4000-8000-000000000001');
    insert into contacts values ('20000000-0000-4000-8000-000000000001');
    insert into lead_import_rows values ('30000000-0000-4000-8000-000000000001');
  `);
  const migration = await readFile(
    new URL("../../../../../lib/db/migrations/20260826_lead_safe_email.sql", import.meta.url),
    "utf8",
  );
  await client.exec(migration);
  return { client, repository: new CommunicationBlockRepository(drizzle(client, { schema }) as never) };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((client) => client.close()));
});

describe("CommunicationBlockRepository with PostgreSQL constraints", () => {
  it("creates one active block and one creation audit under concurrent duplicate requests", async () => {
    const { client, repository } = await createHarness();
    const input = {
      targetType: "recipient_email" as const,
      normalizedEmail: " Person@Example.com ",
      reason: "requested no contact",
      actorId: "owner:1",
    };

    const [first, second] = await Promise.all([repository.create(input), repository.create(input)]);

    expect(first.id).toBe(second.id);
    expect((await client.query("select normalized_email, count(*)::int as count from communication_blocks group by normalized_email")).rows)
      .toEqual([{ normalized_email: "person@example.com", count: 1 }]);
    expect((await client.query("select action, count(*)::int as count from communication_block_events group by action")).rows)
      .toEqual([{ action: "created", count: 1 }]);
  }, 20_000);

  it("retains remove history, makes removal idempotent, and permits a later active replacement", async () => {
    const { client, repository } = await createHarness();
    const created = await repository.create({
      targetType: "lead_import_row",
      rowId: "30000000-0000-4000-8000-000000000001",
      reason: "source says do not send",
      actorId: "owner:1",
    });

    await repository.remove(created.id, { actorId: "owner:2", reason: "reviewed removal" });
    await repository.remove(created.id, { actorId: "owner:3", reason: "duplicate removal" });
    const replacement = await repository.create({
      targetType: "lead_import_row",
      rowId: "30000000-0000-4000-8000-000000000001",
      reason: "blocked again",
      actorId: "owner:4",
    });

    expect(replacement.id).not.toBe(created.id);
    expect((await repository.history(created.id)).map((event) => event.action)).toEqual(["created", "removed"]);
    expect((await client.query("select count(*)::int as count from communication_blocks")).rows).toEqual([{ count: 2 }]);
    await expect(client.exec(`delete from communication_blocks where id = '${created.id}'`)).rejects.toThrow();
  }, 20_000);

  it("enforces exact stable targets and referenced target existence at the repository boundary", async () => {
    const { repository } = await createHarness();
    await expect(repository.create({
      targetType: "recipient_email",
      rowId: "30000000-0000-4000-8000-000000000001",
      reason: "wrong field",
      actorId: "owner:1",
    })).rejects.toThrow();
    await expect(repository.create({
      targetType: "organization",
      organizationId: "10000000-0000-4000-8000-000000000099",
      reason: "missing profile",
      actorId: "owner:1",
    })).rejects.toThrow();
    await expect(repository.create({
      targetType: "recipient_email",
      normalizedEmail: "not-an-email",
      reason: "malformed",
      actorId: "owner:1",
    })).rejects.toThrow();
  }, 20_000);
});
