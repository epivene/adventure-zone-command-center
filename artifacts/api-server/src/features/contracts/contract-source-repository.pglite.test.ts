import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { DrizzleContractSourceRepository } from "./contract-source-repository";

const databases: PGlite[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.close())); });

describe("DrizzleContractSourceRepository", () => {
  it("loads the booking primary signer, selected packages, leg, and defaults", async () => {
    const client = new PGlite();
    databases.push(client);
    await client.exec(`
      create table organizations (id uuid primary key, name text not null);
      create table contacts (
        id uuid primary key, organization_id uuid, first_name text not null, last_name text not null,
        email text, phone text, job_title text
      );
      create table contact_phones (
        id uuid primary key default gen_random_uuid(), contact_id uuid not null,
        number text not null, "primary" boolean not null default false, do_not_call_at timestamptz
      );
      create table organization_contacts (
        id uuid primary key default gen_random_uuid(), organization_id uuid not null, contact_id uuid not null,
        role text, is_primary boolean not null default false, active boolean not null default true
      );
      create table travel_legs (id uuid primary key, name text not null);
      create table bookings (
        id uuid primary key, organization_id uuid, primary_contact_id uuid, name text not null,
        venue_name text, address_1 text, city text not null, region text not null, postal_code text,
        starts_at timestamptz, ends_at timestamptz, physical_attraction_total integer, travel_leg_id uuid
      );
      create table package_templates (id uuid primary key, name text not null);
      create table booking_package_selections (
        id uuid primary key default gen_random_uuid(), booking_id uuid not null, package_template_id uuid not null
      );
      create table contract_settings (
        key text primary key, internal_signer_name text not null, internal_signer_email text,
        internal_signer_order integer not null, insurance_recipient_name text not null,
        insurance_recipient_email text not null
      );
      insert into organizations values ('11111111-1111-4111-8111-111111111111', 'Dinosaur Chamber');
      insert into contacts values (
        '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
        'Pat', 'Organizer', 'pat@example.com', '307-555-0000', 'Event Director'
      );
      insert into contact_phones (contact_id, number, "primary") values
        ('22222222-2222-4222-8222-222222222222', '307-555-0100', true);
      insert into organization_contacts (organization_id, contact_id, role, is_primary) values
        ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Director', true);
      insert into travel_legs values ('33333333-3333-4333-8333-333333333333', 'Colorado');
      insert into bookings values (
        '44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 'Stone Age Stampede', 'Town Park', '100 Main St',
        'Dinosaur', 'CO', '81610', '2026-06-12T18:00:00Z', '2026-06-14T22:00:00Z', 10,
        '33333333-3333-4333-8333-333333333333'
      );
      insert into package_templates values ('55555555-5555-4555-8555-555555555555', 'Adventure Zone');
      insert into booking_package_selections (booking_id, package_template_id) values
        ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555');
      insert into contract_settings values (
        'default', 'Dave Gordon', 'dave@example.com', 2, 'Sara Toone', 'sara@protectiveins.net'
      );
    `);

    const repository = new DrizzleContractSourceRepository(drizzle(client) as never);
    const result = await repository.load("44444444-4444-4444-8444-444444444444");

    expect(result?.bookingPrimaryContact).toMatchObject({
      firstName: "Pat", lastName: "Organizer", phone: "307-555-0100", jobTitle: "Event Director",
    });
    expect(result?.packages).toEqual([{ id: "55555555-5555-4555-8555-555555555555", name: "Adventure Zone" }]);
    expect(result?.travelLeg).toEqual({ name: "Colorado" });
    expect(result?.settings).toMatchObject({ internalSignerName: "Dave Gordon", insuranceRecipientEmail: "sara@protectiveins.net" });
  });

  it("returns null for an unknown booking", async () => {
    const client = new PGlite();
    databases.push(client);
    await client.exec(`
      create table organizations (id uuid primary key, name text not null);
      create table contacts (id uuid primary key, organization_id uuid, first_name text, last_name text, email text, phone text, job_title text);
      create table contact_phones (id uuid primary key, contact_id uuid, number text, "primary" boolean, do_not_call_at timestamptz);
      create table organization_contacts (id uuid primary key, organization_id uuid, contact_id uuid, role text, is_primary boolean, active boolean);
      create table travel_legs (id uuid primary key, name text);
      create table bookings (id uuid primary key, organization_id uuid, primary_contact_id uuid, name text, venue_name text, address_1 text, city text, region text, postal_code text, starts_at timestamptz, ends_at timestamptz, physical_attraction_total integer, travel_leg_id uuid);
      create table package_templates (id uuid primary key, name text);
      create table booking_package_selections (id uuid primary key, booking_id uuid, package_template_id uuid);
      create table contract_settings (key text primary key, internal_signer_name text, internal_signer_email text, internal_signer_order integer, insurance_recipient_name text, insurance_recipient_email text);
    `);
    const repository = new DrizzleContractSourceRepository(drizzle(client) as never);
    await expect(repository.load("99999999-9999-4999-8999-999999999999")).resolves.toBeNull();
  });

  it("keeps absent organization and travel-leg joins nullable", async () => {
    const client = new PGlite();
    databases.push(client);
    await client.exec(`
      create table organizations (id uuid primary key, name text not null);
      create table contacts (id uuid primary key, organization_id uuid, first_name text, last_name text, email text, phone text, job_title text);
      create table contact_phones (id uuid primary key, contact_id uuid, number text, "primary" boolean, do_not_call_at timestamptz);
      create table organization_contacts (id uuid primary key, organization_id uuid, contact_id uuid, role text, is_primary boolean, active boolean);
      create table travel_legs (id uuid primary key, name text);
      create table bookings (id uuid primary key, organization_id uuid, primary_contact_id uuid, name text, venue_name text, address_1 text, city text, region text, postal_code text, starts_at timestamptz, ends_at timestamptz, physical_attraction_total integer, travel_leg_id uuid);
      create table package_templates (id uuid primary key, name text);
      create table booking_package_selections (id uuid primary key, booking_id uuid, package_template_id uuid);
      create table contract_settings (key text primary key, internal_signer_name text, internal_signer_email text, internal_signer_order integer, insurance_recipient_name text, insurance_recipient_email text);
      insert into bookings values (
        '88888888-8888-4888-8888-888888888888', null, null, 'Unlinked Event', null, null,
        'Dinosaur', 'CO', null, null, null, null, null
      );
      insert into contract_settings values ('default', 'Dave Gordon', null, 2, 'Sara Toone', 'sara@protectiveins.net');
    `);
    const repository = new DrizzleContractSourceRepository(drizzle(client) as never);
    const result = await repository.load("88888888-8888-4888-8888-888888888888");
    expect(result?.organization).toBeNull();
    expect(result?.travelLeg).toBeNull();
  });
});
