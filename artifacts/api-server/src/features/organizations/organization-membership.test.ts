import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { setOrganizationMembership } from "./organization-membership";

async function resetFixture() {
  await db.execute(sql.raw(`
    drop table if exists membership_history;
    drop table if exists event_family_members;
    drop table if exists organizations;
    create table organizations (
      id uuid primary key,
      name text not null,
      consolidated_into_id uuid,
      parent_organization_id uuid,
      updated_at timestamptz not null default now()
    );
    create table membership_history (
      id uuid primary key,
      organization_id uuid not null,
      note text not null
    );
    create table event_family_members (
      family_id uuid not null,
      organization_id uuid not null,
      primary key (family_id, organization_id)
    );
  `));
}

async function org(input: { id?: string; name: string; parentId?: string | null; retiredIntoId?: string | null }) {
  const id = input.id ?? randomUUID();
  await db.execute(sql`insert into organizations (id,name,parent_organization_id,consolidated_into_id) values (${id}::uuid,${input.name},${input.parentId ?? null}::uuid,${input.retiredIntoId ?? null}::uuid)`);
  return id;
}

beforeEach(resetFixture);
afterAll(async () => { await pool.end(); });

describe("setOrganizationMembership", () => {
  it("attaches a child without retiring it or moving its history", async () => {
    const parentId = await org({ name: "Water Lantern Festival" });
    const childId = await org({ name: "Water Lantern Festival - Denver" });
    const historyId = randomUUID();
    const familyId = randomUUID();
    await db.execute(sql`insert into membership_history (id,organization_id,note) values (${historyId}::uuid,${childId}::uuid,'Denver note')`);
    await db.execute(sql`insert into event_family_members (family_id,organization_id) values (${familyId}::uuid,${childId}::uuid)`);

    const result = await setOrganizationMembership(db, { childId, parentOrganizationId: parentId }, new Date("2026-08-15T12:00:00Z"));

    const child = await db.execute(sql`select parent_organization_id as "parentId", consolidated_into_id as "retiredId" from organizations where id=${childId}::uuid`);
    const history = await db.execute(sql`select organization_id as "organizationId" from membership_history where id=${historyId}::uuid`);
    const family = await db.execute(sql`select organization_id as "organizationId" from event_family_members where family_id=${familyId}::uuid`);
    expect(result).toEqual({ childId, parentOrganizationId: parentId, previousParentOrganizationId: null });
    expect(child.rows[0]).toMatchObject({ parentId, retiredId: null });
    expect(history.rows[0]).toMatchObject({ organizationId: childId });
    expect(family.rows[0]).toMatchObject({ organizationId: childId });
  });

  it("moves and removes membership by changing only the parent reference", async () => {
    const firstParentId = await org({ name: "First Organization" });
    const secondParentId = await org({ name: "Second Organization" });
    const childId = await org({ name: "City Event", parentId: firstParentId });

    const moved = await setOrganizationMembership(db, { childId, parentOrganizationId: secondParentId }, new Date());
    expect(moved.previousParentOrganizationId).toBe(firstParentId);
    expect(moved.parentOrganizationId).toBe(secondParentId);

    const removed = await setOrganizationMembership(db, { childId, parentOrganizationId: null }, new Date());
    expect(removed.previousParentOrganizationId).toBe(secondParentId);
    expect(removed.parentOrganizationId).toBeNull();

    const child = await db.execute(sql`select parent_organization_id as "parentId" from organizations where id=${childId}::uuid`);
    expect(child.rows[0]).toMatchObject({ parentId: null });
  });

  it("rejects self-parenting and deeper nesting", async () => {
    const parentId = await org({ name: "Parent" });
    const childId = await org({ name: "Child" });
    const grandchildId = await org({ name: "Grandchild", parentId: childId });

    await expect(setOrganizationMembership(db, { childId, parentOrganizationId: childId }, new Date())).rejects.toThrow("cannot belong to itself");
    await expect(setOrganizationMembership(db, { childId, parentOrganizationId: parentId }, new Date())).rejects.toThrow("has locations/events");

    const nestedParentId = await org({ name: "Nested parent", parentId });
    const standaloneId = await org({ name: "Standalone" });
    await expect(setOrganizationMembership(db, { childId: standaloneId, parentOrganizationId: nestedParentId }, new Date())).rejects.toThrow("already a location/event");
    expect(grandchildId).toBeTruthy();
  });

  it("rejects retired child or parent profiles", async () => {
    const canonicalId = await org({ name: "Canonical" });
    const retiredChildId = await org({ name: "Retired child", retiredIntoId: canonicalId });
    const activeChildId = await org({ name: "Active child" });
    const retiredParentId = await org({ name: "Retired parent", retiredIntoId: canonicalId });

    await expect(setOrganizationMembership(db, { childId: retiredChildId, parentOrganizationId: canonicalId }, new Date())).rejects.toThrow("retired");
    await expect(setOrganizationMembership(db, { childId: activeChildId, parentOrganizationId: retiredParentId }, new Date())).rejects.toThrow("retired");
  });
});
