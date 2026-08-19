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
  it("uses the shared single-prospect service sequentially and keeps duplicate skips", async () => {
    const intake = {
      create: vi.fn(async (input: any) => input.accepted.name === "Already Saved"
        ? { kind: "duplicate", match: { status: "existing", organizationId: "org-existing", matchedName: "Already Saved" } }
        : { kind: "created", profileId: `profile-${input.accepted.name}`, bookingId: `booking-${input.accepted.name}` }),
    };
    const service = new ProfileResearchBulkIntakeService(intake as any);

    const result = await service.create({
      events: [prospect("Bluegrass Festival"), prospect("Already Saved")],
      nextActionKind: "call",
      nextActionDueAt: "2026-08-24",
    });

    expect(intake.create).toHaveBeenCalledTimes(2);
    expect(intake.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      accepted: expect.objectContaining({
        name: "Bluegrass Festival",
        city: "Breckenridge",
        region: "CO",
        website: "https://example.com/bluegrass-festival",
      }),
      nextActionKind: "call",
      nextActionDueAt: "2026-08-24",
    }));
    expect(result.created).toEqual([expect.objectContaining({ name: "Bluegrass Festival", profileId: "profile-Bluegrass Festival" })]);
    expect(result.skipped).toEqual([expect.objectContaining({ name: "Already Saved", reason: "existing" })]);
  });

  it("rejects an oversized batch before calling the single service", async () => {
    const intake = { create: vi.fn() };
    const service = new ProfileResearchBulkIntakeService(intake as any);
    const events = Array.from({ length: 21 }, (_, index) => prospect(`Event ${index + 1}`));

    await expect(service.create({ events, nextActionKind: "email", nextActionDueAt: "2026-08-25" }))
      .rejects.toThrow("BULK_PROSPECT_LIMIT");
    expect(intake.create).not.toHaveBeenCalled();
  });
});
