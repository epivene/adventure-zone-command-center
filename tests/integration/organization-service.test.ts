import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildOrganizationListCondition,
  type OrganizationRepository,
  type OrganizationSummary,
} from "@/features/organizations/organization-repository";
import { OrganizationService } from "@/features/organizations/organization-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const travelLegId = "22222222-2222-4222-8222-222222222222";

class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly auditEntries: Array<{
    entityType: string;
    entityId: string;
    action: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }> = [];
  public writes = 0;
  public organization: OrganizationSummary | null = {
    id: organizationId,
    name: "Marias Fair",
    lastResort: false,
    lastResortReason: null,
    lastResortChangedAt: null,
    contacts: [
      { id: "contact-1", name: "Avery Example" },
      { id: "contact-2", name: "Casey Example" },
    ],
    bookings: [
      {
        id: "booking-1",
        name: "Marias County Fair",
        travelLeg: { id: travelLegId, name: "North crew", color: "#123456" },
      },
    ],
  };

  async setLastResort(
    input: { organizationId: string; enabled: boolean; reason: string },
    changedAt: Date,
  ) {
    if (!this.organization || input.organizationId !== this.organization.id) return false;
    this.writes += 1;
    const before = {
      lastResort: this.organization.lastResort,
      lastResortReason: this.organization.lastResortReason,
      lastResortChangedAt: this.organization.lastResortChangedAt?.toISOString() ?? null,
    };
    this.organization = {
      ...this.organization,
      lastResort: input.enabled,
      lastResortReason: input.enabled ? input.reason : null,
      lastResortChangedAt: changedAt,
    };
    this.auditEntries.push({
      entityType: "organization",
      entityId: input.organizationId,
      action: input.enabled ? "last_resort_enabled" : "last_resort_cleared",
      before,
      after: {
        lastResort: this.organization.lastResort,
        lastResortReason: this.organization.lastResortReason,
        lastResortChangedAt: changedAt.toISOString(),
      },
    });
    return true;
  }

  async getOrganizationSummary(organizationIdToFind: string) {
    return this.organization?.id === organizationIdToFind ? this.organization : null;
  }
}

describe("OrganizationService.setLastResort", () => {
  it("writes one organization audit entry", async () => {
    const repository = new InMemoryOrganizationRepository();
    const service = new OrganizationService(repository, {
      now: () => new Date("2026-07-28T15:00:00.000Z"),
    });

    const result = await service.setLastResort({
      organizationId,
      enabled: true,
      reason: "  Repeated cancellations. ",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(repository.auditEntries).toEqual([
      {
        entityType: "organization",
        entityId: organizationId,
        action: "last_resort_enabled",
        before: {
          lastResort: false,
          lastResortReason: null,
          lastResortChangedAt: null,
        },
        after: {
          lastResort: true,
          lastResortReason: "Repeated cancellations.",
          lastResortChangedAt: "2026-07-28T15:00:00.000Z",
        },
      },
    ]);
  });

  it("shows the inherited warning through every associated contact and booking", async () => {
    const repository = new InMemoryOrganizationRepository();
    const service = new OrganizationService(repository);

    await service.setLastResort({
      organizationId,
      enabled: true,
      reason: "Repeated cancellations.",
    });
    const summary = await repository.getOrganizationSummary(organizationId);

    expect(summary?.lastResort).toBe(true);
    expect(summary?.contacts.map((contact) => contact.name)).toEqual([
      "Avery Example",
      "Casey Example",
    ]);
    expect(summary?.bookings.map((booking) => booking.name)).toEqual([
      "Marias County Fair",
    ]);
  });

  it("allows a deliberate audited removal", async () => {
    const repository = new InMemoryOrganizationRepository();
    const service = new OrganizationService(repository, {
      now: () => new Date("2026-07-28T16:00:00.000Z"),
    });
    await service.setLastResort({
      organizationId,
      enabled: true,
      reason: "Repeated cancellations.",
    });

    const result = await service.setLastResort({
      organizationId,
      enabled: false,
      reason: "",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(repository.organization).toMatchObject({
      lastResort: false,
      lastResortReason: null,
    });
    expect(repository.auditEntries.at(-1)).toMatchObject({
      action: "last_resort_cleared",
      before: expect.objectContaining({ lastResort: true }),
      after: expect.objectContaining({ lastResort: false, lastResortReason: null }),
    });
  });

  it("returns ORGANIZATION_NOT_FOUND without writing", async () => {
    const repository = new InMemoryOrganizationRepository();
    repository.organization = null;
    const service = new OrganizationService(repository);

    const result = await service.setLastResort({
      organizationId,
      enabled: true,
      reason: "Repeated cancellations.",
    });

    expect(result).toEqual({ ok: false, error: { code: "ORGANIZATION_NOT_FOUND" } });
    expect(repository.writes).toBe(0);
    expect(repository.auditEntries).toEqual([]);
  });
});

describe("organization list query contract", () => {
  it("filters the organization list to Last Resort accounts", () => {
    const condition = buildOrganizationListCondition({
      search: "",
      lastResort: "only",
      travelLegId: null,
    });
    const query = new PgDialect().sqlToQuery(condition!);

    expect(query.sql).toContain('"organizations"."last_resort" = $1');
    expect(query.params).toEqual([true]);
  });

  it("filters Last Resort organizations by associated leg", () => {
    const condition = buildOrganizationListCondition({
      search: "Marias",
      lastResort: "only",
      travelLegId,
    });
    const query = new PgDialect().sqlToQuery(condition!);

    expect(query.sql).toContain('"bookings"."organization_id" = "organizations"."id"');
    expect(query.sql).toContain('"bookings"."travel_leg_id" = $3');
    expect(query.params).toEqual(["%Marias%", true, travelLegId]);
  });
});
