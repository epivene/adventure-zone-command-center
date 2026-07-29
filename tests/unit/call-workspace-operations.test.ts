import { describe, expect, it, vi } from "vitest";

import { loadCallWorkspace } from "@/features/calls/call-workspace-query";
import type { CallWorkspaceContextRepository } from "@/features/calls/call-workspace-context";
import type { BookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";

const bookingId = "11111111-1111-4111-8111-111111111111";

const repository: CallWorkspaceContextRepository = {
  findOrganization: async () => null,
  findContact: async () => null,
  findFollowUp: async () => null,
  findBooking: async (id) => ({
    id,
    organizationId: null,
    primaryContactId: null,
    name: "County Fair",
    city: "Shelby",
    region: "MT",
    status: "interested",
    startsAt: null,
  }),
};

describe("loadCallWorkspace operations adapter", () => {
  it("loads package/resource operations only through the provider when a booking exists", async () => {
    const getForBooking = vi.fn(async () => ({
      packageNames: ["Adventure Zone", "Weekend Warriors"],
      sharedAttractionTotal: 11,
      pendingRequestCount: 1,
      leg: null,
      warnings: [],
    }));
    const result = await loadCallWorkspace(
      { bookingId },
      repository,
      { getForBooking } satisfies BookingOperationsSummaryProvider,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        context: { booking: { id: bookingId } },
        operations: { sharedAttractionTotal: 11 },
      },
    });
    expect(getForBooking).toHaveBeenCalledOnce();
    expect(getForBooking).toHaveBeenCalledWith(bookingId);
  });

  it("does not ask the operations provider for contact-only workspaces", async () => {
    const contactId = "22222222-2222-4222-8222-222222222222";
    const getForBooking = vi.fn();
    const result = await loadCallWorkspace(
      { contactId },
      {
        ...repository,
        findContact: async () => ({
          id: contactId,
          organizationId: null,
          firstName: "Avery",
          lastName: "Example",
          email: null,
          phone: null,
          city: null,
          region: null,
        }),
      },
      { getForBooking },
    );

    expect(result).toMatchObject({ ok: true, value: { operations: null } });
    expect(getForBooking).not.toHaveBeenCalled();
  });
});
