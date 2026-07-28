import { beforeEach, describe, expect, it, vi } from "vitest";

const { complete, revalidatePath } = vi.hoisted(() => ({
  complete: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner" })),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/calls/call-repository", () => ({
  DrizzleCallRepository: vi.fn(),
}));
vi.mock("@/features/calls/call-service", () => ({
  CallService: vi.fn(function CallService() {
    return { complete };
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { completeCallAction } from "@/app/(private)/calls/actions";
import { CallService } from "@/features/calls/call-service";
import { requireOwner } from "@/lib/auth/require-owner";

const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  contactId: "22222222-2222-4222-8222-222222222222",
  bookingId: "33333333-3333-4333-8333-333333333333",
  followUpId: "44444444-4444-4444-8444-444444444444",
  note: "Confirmed the event details.",
  disposition: "follow_up_needed" as const,
  resultingBookingStatus: null,
  startedAt: new Date("2026-07-28T15:00:00Z"),
  endedAt: new Date("2026-07-28T15:01:00Z"),
  nextAction: { kind: "call", dueAt: new Date("2026-08-01T17:00:00Z") },
  lastResortReason: null,
  approvedContactUpdates: null,
  approvedBookingUpdates: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ userId: "owner" });
});

describe("Call Workspace actions", () => {
  it("stops before database-backed service construction when owner authorization fails", async () => {
    vi.mocked(requireOwner).mockRejectedValueOnce(new Error("Not authorized"));

    await expect(completeCallAction(input)).rejects.toThrow("Not authorized");
    expect(CallService).not.toHaveBeenCalled();
  });

  it("maps a typed completion error without revalidating stale views", async () => {
    complete.mockResolvedValue({ ok: false, error: { code: "NEXT_ACTION_REQUIRED" } });

    await expect(completeCallAction(input)).resolves.toEqual({
      ok: false,
      error: "Choose a next action and date before completing this call.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("validates malformed input after authorization and before service work", async () => {
    await expect(completeCallAction({ ...input, note: "" })).resolves.toEqual({
      ok: false,
      error: "Add a call note.",
    });
    expect(requireOwner).toHaveBeenCalledOnce();
    expect(CallService).not.toHaveBeenCalled();
  });

  it("revalidates Today and each affected record after atomic completion", async () => {
    complete.mockResolvedValue({ ok: true, value: { activityId: "activity-1" } });

    await expect(completeCallAction(input)).resolves.toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/today");
    expect(revalidatePath).toHaveBeenCalledWith(`/contacts/${input.contactId}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/bookings/${input.bookingId}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/organizations/${input.organizationId}`);
  });
});
