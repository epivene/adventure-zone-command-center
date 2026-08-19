import { describe, expect, it, vi } from "vitest";

import { ProfileResearchBulkIntakeService } from "./profile-research-bulk-intake";

const prospect = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  city: "Breckenridge",
  region: "CO",
  startsAt: "2026-09-11",
  endsAt: "2026-09-13",
  venue: "Main Street Station",
  url: `https://example.com/${name.toLowerCase().replace(/\s+/g, "-")}`,
  rationale: "Found on the cited tourism calendar.",
  ...overrides,
});

describe("ProfileResearchBulkIntakeService", () => {
  it("creates only prospects that still classify as new and applies one shared first follow-up", async () => {
    const store = {
      classify: vi.fn(async (event: any) => event.name === "Already Saved"
        ? { status: "existing", organizationId: "org-existing", matchedName: "Already Saved" }
        : { status: "new_prospect" }),
      createLead: vi.fn(async (input: any) => ({ profileId: `profile-${input.event.name}`, bookingId: `booking-${input.event.name}` })),
    };
    const service = new ProfileResearchBulkIntakeService(store as any);

    const result = await service.create({
      events: [prospect("Bluegrass Festival"), prospect("Already Saved")],
      nextActionKind: "call",
      nextActionDueAt: "2026-08-24",
    });

    expect(store.createLead).toHaveBeenCalledTimes(1);
    expect(store.createLead).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ name: "Bluegrass Festival", website: "https://example.com/bluegrass-festival" }),
      booking: expect.objectContaining({ status: "new_lead", nextActionKind: "call", nextActionDueAt: "2026-08-24" }),
    }));
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toEqual([expect.objectContaining({ name: "Already Saved", reason: "existing" })]);
  });

  it("rejects an oversized batch before creating anything", async () => {
    const store = { classify: vi.fn(), createLead: vi.fn() };
    const service = new ProfileResearchBulkIntakeService(store as any);
    const events = Array.from({ length: 21 }, (_, index) => prospect(`Event ${index + 1}`));

    await expect(service.create({ events, nextActionKind: "email", nextActionDueAt: "2026-08-25" }))
      .rejects.toThrow("BULK_PROSPECT_LIMIT");
    expect(store.createLead).not.toHaveBeenCalled();
  });
});
