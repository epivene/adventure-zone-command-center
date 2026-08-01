import { describe, expect, it, vi } from "vitest";

const getEventProfile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner-1" })),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/event-profiles/event-profile-repository", () => ({
  DrizzleEventProfileRepository: class {
    getEventProfile = getEventProfile;
  },
}));
vi.mock("@/components/event-profiles/event-profile-workspace", () => ({
  EventProfileWorkspace: () => null,
}));

import EventProfilePage from "@/app/(private)/event-profiles/[profileId]/page";

describe("event profile page context", () => {
  it("loads the selected contact and forwards Today action context to the workspace", async () => {
    const profile = { id: "11111111-1111-4111-8111-111111111111" };
    getEventProfile.mockResolvedValue(profile);

    const rendered = await EventProfilePage({
      params: Promise.resolve({ profileId: profile.id }),
      searchParams: Promise.resolve({
        contactId: "22222222-2222-4222-8222-222222222222",
        bookingId: "33333333-3333-4333-8333-333333333333",
        followUpId: "55555555-5555-4555-8555-555555555555",
        action: "call",
        mode: "prospect",
      }),
    });

    expect(getEventProfile).toHaveBeenCalledWith(
      profile.id,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(rendered).toMatchObject({
      props: {
      profile,
      context: {
        bookingId: "33333333-3333-4333-8333-333333333333",
        followUpId: "55555555-5555-4555-8555-555555555555",
        action: "call",
        mode: "prospect",
      },
      },
    });
  });
});
