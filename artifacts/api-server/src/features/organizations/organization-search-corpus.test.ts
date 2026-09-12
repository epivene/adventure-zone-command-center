import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { loadOrganizationSearchCorpus } from "./organization-search-corpus";

const clients: PGlite[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("organization search corpus", () => {
  it("loads every searchable field only for eligible profiles", async () => {
    const client = new PGlite();
    clients.push(client);
    await client.exec(`
      create table organizations (
        id uuid primary key, name text, city text, region text, postal_code text,
        address_1 text, website text, phone text
      );
      create table organization_locations (
        id uuid primary key, organization_id uuid, label text, venue_name text,
        city text, region text, postal_code text, address_1 text, website text,
        phone text, email text
      );
      create table contacts (
        id uuid primary key, organization_location_id uuid, first_name text,
        last_name text, phone text, email text
      );
      create table organization_contacts (
        organization_id uuid, contact_id uuid, active boolean
      );
      create table contact_phones (contact_id uuid, number text);
    `);

    const eligibleId = "10000000-0000-4000-8000-000000000001";
    const excludedId = "10000000-0000-4000-8000-000000000002";
    await client.exec(`
      insert into organizations values
        ('${eligibleId}', 'Blanding Fair', 'Blanding', 'UT', '84511', '1 Main', 'blanding.example', '435-555-1000'),
        ('${excludedId}', 'Excluded Fair', 'Denver', 'CO', null, null, null, null);
      insert into contacts values
        ('20000000-0000-4000-8000-000000000001', null, 'Active', 'Organizer', null, 'active@example.com'),
        ('20000000-0000-4000-8000-000000000002', null, 'Inactive', 'Organizer', null, 'inactive@example.com'),
        ('20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'Venue', 'Contact', null, 'venue@example.com');
      insert into organization_contacts values
        ('${eligibleId}', '20000000-0000-4000-8000-000000000001', true),
        ('${eligibleId}', '20000000-0000-4000-8000-000000000002', false);
      insert into contact_phones values
        ('20000000-0000-4000-8000-000000000001', '435-555-2000'),
        ('20000000-0000-4000-8000-000000000003', '435-555-3000');
      insert into organization_locations values
        ('30000000-0000-4000-8000-000000000001', '${eligibleId}', 'Fairgrounds', 'San Juan Arena', 'Blanding', 'UT', '84511', '2 Arena Way', 'arena.example', '435-555-4000', 'arena@example.com');
    `);

    const rows = await loadOrganizationSearchCorpus(
      drizzle(client) as never,
      [eligibleId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(eligibleId);
    expect(rows[0].searchText).toContain("Blanding Fair");
    expect(rows[0].searchText).toContain("active@example.com");
    expect(rows[0].searchText).toContain("435-555-2000");
    expect(rows[0].searchText).toContain("San Juan Arena");
    expect(rows[0].searchText).toContain("venue@example.com");
    expect(rows[0].searchText).toContain("435-555-3000");
    expect(rows[0].searchText).not.toContain("inactive@example.com");
    expect(rows[0].searchText).not.toContain("Excluded Fair");
  });
});
