import { describe, expect, it, vi } from "vitest";
import { approveMeetupRequest, createMeetupRequest, dismissMeetupRequest } from "./meetup-request-service";

function stores() {
  const requests = {
    findByMutation: vi.fn(async () => null),
    create: vi.fn(async (input: any) => ({ id: "request-1", status: "pending_admin", ...input })),
    get: vi.fn(async () => ({
      id: "request-1", status: "pending_admin", requestingLegId: "leg-a", otherLegIds: ["leg-b"], resourceId: "resource-1",
      meetupLabel: "Bismarck", meetupLatitude: 46.8, meetupLongitude: -100.78,
      preferredStartsAt: new Date("2026-08-20T18:00:00Z"), preferredEndsAt: new Date("2026-08-20T20:00:00Z"),
      notes: "Swap trailer", linkedConversationId: "conversation-1", linkedMessageId: null,
    })),
    markApproved: vi.fn(async (_id: string, handoffId: string) => ({ id: "request-1", status: "approved", handoffId })),
    markDismissed: vi.fn(async () => ({ id: "request-1", status: "dismissed" })),
  };
  const handoffs = { createApprovedManual: vi.fn(async () => ({ id: "handoff-1", status: "approved" })) };
  const notifications = { create: vi.fn(async (input: any) => input) };
  return { requests, handoffs, notifications };
}

const proposal = {
  requestingLegId: "leg-a",
  otherLegIds: ["leg-b"],
  resourceId: "resource-1",
  meetupLabel: "Bismarck",
  meetupLatitude: 46.8,
  meetupLongitude: -100.78,
  preferredStartsAt: new Date("2026-08-20T18:00:00Z"),
  preferredEndsAt: new Date("2026-08-20T20:00:00Z"),
  notes: "Swap trailer",
  linkedConversationId: "conversation-1",
  linkedMessageId: null,
  clientMutationId: "00000000-0000-4000-8000-000000000401",
};

describe("meetup request service", () => {
  it("creates a pending admin request without creating an official handoff", async () => {
    const { requests, handoffs, notifications } = stores();
    const result = await createMeetupRequest(requests as any, notifications as any, proposal);
    expect(result.status).toBe("pending_admin");
    expect(handoffs.createApprovedManual).not.toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ legId: "leg-a", kind: "request_update", actionRequired: false }));
  });

  it("deduplicates a retried manager request by requesting leg and client mutation id", async () => {
    const { requests, notifications } = stores();
    requests.findByMutation.mockResolvedValueOnce({ id: "existing", status: "pending_admin" } as any);
    const result = await createMeetupRequest(requests as any, notifications as any, proposal);
    expect(result.id).toBe("existing");
    expect(requests.create).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it("admin may revise final leg/resource/location/window before creating the official handoff", async () => {
    const { requests, handoffs, notifications } = stores();
    const result = await approveMeetupRequest(requests as any, handoffs as any, notifications as any, "request-1", {
      fromLegId: "leg-a", toLegId: "leg-c", resourceId: "resource-2",
      meetupLabel: "Dickinson", meetupLatitude: 46.88, meetupLongitude: -102.79,
      windowStartsAt: new Date("2026-08-20T19:00:00Z"), windowEndsAt: new Date("2026-08-20T21:00:00Z"),
      adminNotes: "Adjusted to fit both routes",
    });
    expect(handoffs.createApprovedManual).toHaveBeenCalledWith(expect.objectContaining({ toLegId: "leg-c", resourceId: "resource-2", meetupLabel: "Dickinson" }));
    expect(requests.markApproved).toHaveBeenCalledWith("request-1", "handoff-1");
    expect(result.handoff.id).toBe("handoff-1");
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "request_update", title: "Meetup approved" }));
  });

  it("dismissal keeps the request history and sends an FYI notification", async () => {
    const { requests, notifications } = stores();
    const result = await dismissMeetupRequest(requests as any, notifications as any, "request-1", "Routes do not overlap");
    expect(result.status).toBe("dismissed");
    expect(requests.markDismissed).toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ legId: "leg-a", title: "Meetup request closed" }));
  });
});
