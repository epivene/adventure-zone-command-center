/**
 * Integration tests for organization-consolidation.ts
 *
 * These tests run against the real database (same pattern as organisation-repository.test.ts).
 * Each test creates its own isolated data and cleans up afterwards.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activities,
  bookings,
  contacts,
  followUps,
  organizationContacts,
  organizationLocations,
  organizations,
} from "@/db/schema";
import {
  applyConsolidation,
  buildConsolidationPreview,
  getConsolidationRedirect,
} from "./organization-consolidation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createOrg(name: string, city?: string, region?: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name, city: city ?? null, region: region ?? null })
    .returning({ id: organizations.id });
  if (!org) throw new Error(`Could not create org: ${name}`);
  return org.id;
}

async function createContact(organizationId: string, firstName = "Test", lastName = "Contact") {
  // contacts_primary_organization_contact_fk: (contacts.organization_id, contacts.id) must reference
  // (organization_contacts.organization_id, organization_contacts.contact_id). So we must:
  //   1. Insert contact with organizationId = null (satisfies FK since null = no reference)
  //   2. Insert the organization_contacts row
  //   3. Update contacts.organization_id to the real org
  const [contact] = await db
    .insert(contacts)
    .values({ firstName, lastName, organizationId: null })
    .returning({ id: contacts.id });
  if (!contact) throw new Error("Could not create contact");
  await db.insert(organizationContacts).values({
    organizationId,
    contactId: contact.id,
    isPrimary: false,
    active: true,
    source: "local",
  });
  await db
    .update(contacts)
    .set({ organizationId })
    .where(eq(contacts.id, contact.id));
  return contact.id;
}

async function cleanupOrgs(ids: string[]) {
  if (!ids.length) return;
  // Null out FKs before deleting.
  await db.update(contacts).set({ organizationId: null }).where(inArray(contacts.organizationId, ids));
  await db.update(bookings).set({ organizationId: null }).where(inArray(bookings.organizationId, ids));
  await db.update(activities).set({ organizationId: null }).where(inArray(activities.organizationId, ids));
  await db.update(followUps).set({ organizationId: null }).where(inArray(followUps.organizationId, ids));
  await db.delete(organizationContacts).where(inArray(organizationContacts.organizationId, ids));
  // Remove locations before deleting orgs.
  await db.delete(organizationLocations).where(inArray(organizationLocations.organizationId, ids));
  // Also remove locations whose source is one of these orgs.
  await db.delete(organizationLocations).where(
    inArray(organizationLocations.consolidationSourceOrgId, ids),
  );
  await db.delete(organizations).where(inArray(organizations.id, ids));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildConsolidationPreview", () => {
  const created: string[] = [];

  beforeEach(async () => {
    created.length = 0;
  });

  it("returns accurate record counts for each source org", async () => {
    const sourceA = await createOrg("Fair A", "Springfield", "IL");
    const sourceB = await createOrg("Fair B", "Shelbyville", "IL");
    created.push(sourceA, sourceB);

    const _contactA = await createContact(sourceA, "Alice", "Smith");

    const preview = await buildConsolidationPreview(db, {
      canonicalOrgId: null,
      proposedCanonicalName: "Illinois State Fairs",
      sourceOrgIds: [sourceA, sourceB],
    });

    const proposalA = preview.locationProposals.find((p) => p.sourceOrgId === sourceA)!;
    const proposalB = preview.locationProposals.find((p) => p.sourceOrgId === sourceB)!;

    expect(proposalA.recordCounts.contacts).toBe(1);
    expect(proposalB.recordCounts.contacts).toBe(0);
    expect(proposalA.proposedLabel).toBe("Springfield, IL");
    expect(proposalB.proposedLabel).toBe("Shelbyville, IL");

    await cleanupOrgs(created);
  });

  it("rejects fewer than 2 source orgs", async () => {
    const sourceA = await createOrg("Solo Fair");
    created.push(sourceA);
    await expect(
      buildConsolidationPreview(db, { canonicalOrgId: null, sourceOrgIds: [sourceA] }),
    ).rejects.toThrow("at least 2");
    await cleanupOrgs(created);
  });
});

describe("applyConsolidation", () => {
  const created: string[] = [];

  beforeEach(async () => {
    created.length = 0;
  });

  it("moves contacts, sets organizationLocationId, stamps consolidatedIntoId on source", async () => {
    const canonical = await createOrg("Midwest Fairs Inc");
    const sourceA = await createOrg("Fair Alpha", "Peoria", "IL");
    const sourceB = await createOrg("Fair Beta", "Decatur", "IL");
    created.push(canonical, sourceA, sourceB);

    const contactId = await createContact(sourceA, "Bob", "Jones");

    const now = new Date();
    const result = await applyConsolidation(
      db,
      {
        canonicalOrgId: canonical,
        locationAssignments: [
          { sourceOrgId: sourceA, label: "Peoria, IL" },
          { sourceOrgId: sourceB, label: "Decatur, IL" },
        ],
      },
      now,
    );

    expect(result.canonicalOrgId).toBe(canonical);
    const locA = result.locationIdBySourceOrgId[sourceA];
    const locB = result.locationIdBySourceOrgId[sourceB];
    expect(locA).toBeTruthy();
    expect(locB).toBeTruthy();

    // Contact moved to canonical org with correct location.
    const [movedContact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    expect(movedContact?.organizationId).toBe(canonical);
    expect(movedContact?.organizationLocationId).toBe(locA);

    // Source orgs stamped as consolidated.
    const [orgA] = await db.select({ consolidatedIntoId: organizations.consolidatedIntoId }).from(organizations).where(eq(organizations.id, sourceA));
    expect(orgA?.consolidatedIntoId).toBe(canonical);

    // Locations carry the durable source org link.
    const [locationA] = await db.select({ consolidationSourceOrgId: organizationLocations.consolidationSourceOrgId }).from(organizationLocations).where(eq(organizationLocations.id, locA!));
    expect(locationA?.consolidationSourceOrgId).toBe(sourceA);
  });

  it("is repeat-safe: running the same consolidation twice does not duplicate data", async () => {
    const canonical = await createOrg("Double-Run Fairs");
    const sourceA = await createOrg("Repeat Fair A", "Rockford", "IL");
    const sourceB = await createOrg("Repeat Fair B", "Aurora", "IL");
    created.push(canonical, sourceA, sourceB);

    const input = {
      canonicalOrgId: canonical,
      locationAssignments: [
        { sourceOrgId: sourceA, label: "Rockford" },
        { sourceOrgId: sourceB, label: "Aurora" },
      ],
    };
    const now = new Date();

    // First run
    await applyConsolidation(db, input, now);

    // Second run — should not throw or duplicate locations.
    await applyConsolidation(db, input, now);

    const locationCount = await db
      .select({ id: organizationLocations.id })
      .from(organizationLocations)
      .where(eq(organizationLocations.organizationId, canonical));
    expect(locationCount.length).toBe(2); // Still exactly 2, not 4.
  });

  it("rejects duplicate sourceOrgId in the same request", async () => {
    const canonical = await createOrg("Duplicate Input Org");
    const sourceA = await createOrg("Dup Source A");
    created.push(canonical, sourceA);

    await expect(
      applyConsolidation(
        db,
        {
          canonicalOrgId: canonical,
          locationAssignments: [
            { sourceOrgId: sourceA, label: "Location 1" },
            { sourceOrgId: sourceA, label: "Location 2" }, // same ID twice
          ],
        },
        new Date(),
      ),
    ).rejects.toThrow(/[Dd]uplicate/);

    await cleanupOrgs(created);
  });

  it("rejects consolidating an org already consolidated into a different canonical", async () => {
    const canonical1 = await createOrg("Canonical 1");
    const canonical2 = await createOrg("Canonical 2");
    const sourceA = await createOrg("Shared Source A");
    const sourceB = await createOrg("Extra Source B");
    const sourceC = await createOrg("Extra Source C");
    created.push(canonical1, canonical2, sourceA, sourceB, sourceC);

    const now = new Date();
    await applyConsolidation(db, {
      canonicalOrgId: canonical1,
      locationAssignments: [
        { sourceOrgId: sourceA, label: "Location A" },
        { sourceOrgId: sourceB, label: "Location B" },
      ],
    }, now);

    // Now try to consolidate sourceA (already in canonical1) into canonical2.
    await expect(
      applyConsolidation(db, {
        canonicalOrgId: canonical2,
        locationAssignments: [
          { sourceOrgId: sourceA, label: "Location A again" },
          { sourceOrgId: sourceC, label: "Location C" },
        ],
      }, now),
    ).rejects.toThrow(/consolidated into a different/i);

    await cleanupOrgs(created);
  });
});

describe("getConsolidationRedirect", () => {
  const created: string[] = [];

  beforeEach(async () => {
    created.length = 0;
  });

  it("returns null for a non-consolidated org", async () => {
    const orgId = await createOrg("Live Org");
    created.push(orgId);
    const result = await getConsolidationRedirect(db, orgId);
    expect(result).toBeNull();
    await cleanupOrgs(created);
  });

  it("returns null for an unknown org ID", async () => {
    const result = await getConsolidationRedirect(db, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("returns the correct canonical org ID and the matching location ID", async () => {
    const canonical = await createOrg("Redirect Canonical");
    const sourceA = await createOrg("Redirect Source A", "Joliet", "IL");
    const sourceB = await createOrg("Redirect Source B", "Elgin", "IL");
    created.push(canonical, sourceA, sourceB);

    const result = await applyConsolidation(
      db,
      {
        canonicalOrgId: canonical,
        locationAssignments: [
          { sourceOrgId: sourceA, label: "Joliet" },
          { sourceOrgId: sourceB, label: "Elgin" },
        ],
      },
      new Date(),
    );

    const locA = result.locationIdBySourceOrgId[sourceA];
    const locB = result.locationIdBySourceOrgId[sourceB];

    // Each source should redirect to its OWN location, not the other source's.
    const redirectA = await getConsolidationRedirect(db, sourceA);
    expect(redirectA?.canonicalOrgId).toBe(canonical);
    expect(redirectA?.locationId).toBe(locA);

    const redirectB = await getConsolidationRedirect(db, sourceB);
    expect(redirectB?.canonicalOrgId).toBe(canonical);
    expect(redirectB?.locationId).toBe(locB);

    // The two location IDs must be distinct (no cross-contamination).
    expect(locA).not.toBe(locB);
  });
});
