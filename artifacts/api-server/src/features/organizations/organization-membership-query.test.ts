import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db/client";
import {
  getOrganizationMembershipContext,
  listOrganizationChildren,
  searchEligibleOrganizationChildren,
  searchEligibleOrganizationParents,
} from "./organization-membership-query";

async function resetFixture() {
  await db.execute(sql.raw(`
    drop table if exists organizations;
    create table organizations (
      id uuid primary key,
      name text not null,
      city text,
      region text,
      consolidated_into_id uuid,
      parent_organization_id uuid,
      updated_at timestamptz not null default now()
    );
  `));
}

async function org(input: { name: string; city?: string | null; region?: string | null; parentId?: string | null; retiredIntoId?: string | null }) {
  const id = randomUUID();
  await db.execute(sql`insert into organizations (id,name,city,region,parent_organization_id,consolidated_into_id) values (${id}::uuid,${input.name},${input.city ?? null},${input.region ?? null},${input.parentId ?? null}::uuid,${input.retiredIntoId ?? null}::uuid)`);
  return id;
}

beforeEach(resetFixture);
afterAll(async () => { await pool.end(); });

describe("organization membership queries", () => {
  it("lists direct children and returns parent/children context", async () => {
    const parentId = await org({ name: "Water Lantern Festival" });
    const denverId = await org({ name: "Water Lantern Festival Denver", city: "Denver", region: "CO", parentId });
    const boiseId = await org({ name: "Water Lantern Festival Boise", city: "Boise", region: "ID", parentId });
    await org({ name: "Unrelated Fair" });

    const children = await listOrganizationChildren(db, parentId);
    expect(children.map((child) => child.id).sort()).toEqual([boiseId, denverId].sort());

    const childContext = await getOrganizationMembershipContext(db, denverId);
    expect(childContext.parent).toMatchObject({ id: parentId, name: "Water Lantern Festival" });
    expect(childContext.children).toEqual([]);

    const parentContext = await getOrganizationMembershipContext(db, parentId);
    expect(parentContext.parent).toBeNull();
    expect(parentContext.children).toHaveLength(2);
  });

  it("searches add-existing candidates by name, city, or region and reports current parent", async () => {
    const targetParentId = await org({ name: "Water Lantern Festival" });
    const otherParentId = await org({ name: "Festival Group" });
    const alreadyId = await org({ name: "Denver Lantern", city: "Denver", region: "CO", parentId: targetParentId });
    const movableId = await org({ name: "Lantern Celebration", city: "Denver", region: "CO", parentId: otherParentId });
    const standaloneId = await org({ name: "Denver Lights", city: "Denver", region: "CO" });

    const results = await searchEligibleOrganizationChildren(db, "Denver", targetParentId);
    expect(results.map((item) => item.id)).not.toContain(alreadyId);
    expect(results.map((item) => item.id)).toEqual(expect.arrayContaining([movableId, standaloneId]));
    expect(results.find((item) => item.id === movableId)?.currentParent).toMatchObject({ id: otherParentId, name: "Festival Group" });
    expect(results.find((item) => item.id === standaloneId)?.currentParent).toBeNull();
  });

  it("searches only live top-level organizations for the child-side picker", async () => {
    const childId = await org({ name: "Denver Event" });
    const topLevelId = await org({ name: "Water Lantern Festival", city: "Salt Lake City", region: "UT" });
    const parentOfNested = await org({ name: "Other Group" });
    await org({ name: "Water Lantern Local", parentId: parentOfNested });
    const retiredId = await org({ name: "Water Lantern Retired", retiredIntoId: topLevelId });

    const results = await searchEligibleOrganizationParents(db, "Water Lantern", childId);
    expect(results.map((item) => item.id)).toContain(topLevelId);
    expect(results.map((item) => item.id)).not.toContain(childId);
    expect(results.map((item) => item.id)).not.toContain(retiredId);
    expect(results.every((item) => item.name !== "Water Lantern Local")).toBe(true);
  });
});
