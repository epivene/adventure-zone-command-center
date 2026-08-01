import { describe, expect, it, vi } from "vitest";

const { events, requireOwner, loadContext, notFound } = vi.hoisted(() => ({
  events: [] as string[],
  requireOwner: vi.fn(async () => { events.push("owner"); }),
  loadContext: vi.fn(async () => {
    events.push("context");
    return { ok: false as const };
  }),
  notFound: vi.fn(() => { throw new Error("not found"); }),
}));

vi.mock("@/lib/auth/require-owner", () => ({ requireOwner }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/features/calls/call-workspace-context", () => ({
  activityTimelineParent: vi.fn(),
  DrizzleCallWorkspaceContextRepository: vi.fn(),
  loadCallWorkspaceContext: loadContext,
}));

import CallWorkspacePage from "@/app/(private)/calls/new/page";

describe("CallWorkspacePage", () => {
  it("authorizes before passing malformed IDs to the testable context loader", async () => {
    await expect(CallWorkspacePage({
      searchParams: Promise.resolve({ contactId: "not-a-uuid" }),
    })).rejects.toThrow("not found");

    expect(events).toEqual(["owner", "context"]);
    expect(loadContext).toHaveBeenCalledWith(
      {
        organizationId: undefined,
        contactId: "not-a-uuid",
        bookingId: undefined,
        followUpId: undefined,
      },
      expect.anything(),
    );
  });
});
