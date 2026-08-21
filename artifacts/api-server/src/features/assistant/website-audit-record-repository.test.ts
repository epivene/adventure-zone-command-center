import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { PostgresWebsiteAuditRecordRepository } from "./website-audit-record-repository";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      name text not null,
      phone text,
      city text,
      region text,
      website text,
      consolidated_into_id uuid
    );
    create table contacts (
      id uuid primary key,
      email text
    );
    create table organization_contacts (
      organization_id uuid not null,
      contact_id uuid not null,
      is_primary boolean not null default false,
      active boolean not null default true
    );
  `);
  return { client, repository: new PostgresWebsiteAuditRecordRepository(client as never) };
}

describe("PostgresWebsiteAuditRecordRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("returns only live profiles with nonblank websites in stable id order", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    await client.exec(`
      insert into organizations values
        ('10000000-0000-4000-8000-000000000001','A Fair','701-111-1111','Mandan','ND','https://a.example',null),
        ('10000000-0000-4000-8000-000000000002','Blank Site',null,null,null,'   ',null),
        ('10000000-0000-4000-8000-000000000003','Retired Fair',null,null,null,'https://retired.example','10000000-0000-4000-8000-000000000001'),
        ('10000000-0000-4000-8000-000000000004','B Fair',null,'Bismarck','ND','b.example',null);
      insert into contacts values ('20000000-0000-4000-8000-000000000001','person@a.example');
      insert into organization_contacts values
        ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',true,true);
    `);

    expect(await repository.countApplicable()).toBe(2);
    const first = await repository.listBatch({ afterId: null, limit: 1 });
    const second = await repository.listBatch({ afterId: first[0]!.recordId, limit: 10 });

    expect(first[0]).toMatchObject({
      recordId: "10000000-0000-4000-8000-000000000001",
      label: "A Fair",
      website: "https://a.example",
      city: "Mandan",
      region: "ND",
      primaryEmailDomain: "a.example",
    });
    expect(second.map((record) => record.label)).toEqual(["B Fair"]);
  });

  it("reads the current website for optimistic stale-write protection", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    await client.exec(`insert into organizations values ('10000000-0000-4000-8000-000000000001','Fair',null,null,null,'https://current.example',null);`);
    expect(await repository.readCurrentWebsite("10000000-0000-4000-8000-000000000001"))
      .toBe("https://current.example");
  });
});
