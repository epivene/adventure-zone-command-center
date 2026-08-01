import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, edit, revalidatePath } = vi.hoisted(() => ({
  create: vi.fn(),
  edit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner" })),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/activities/activity-repository", () => ({
  DrizzleActivityRepository: vi.fn(),
}));
vi.mock("@/features/activities/activity-service", () => ({
  ActivityService: vi.fn(function ActivityService() {
    return { create, edit };
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createActivityAction,
  editActivityAction,
} from "@/app/(private)/activities/actions";
import { ActivityService } from "@/features/activities/activity-service";
import { requireOwner } from "@/lib/auth/require-owner";

const activity = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: "11111111-1111-4111-8111-111111111111",
  contactId: null,
  bookingId: null,
  kind: "note" as const,
  body: "Confirmed the venue.",
  occurredAt: new Date("2026-07-28T15:00:00Z"),
  createdAt: new Date("2026-07-28T15:00:00Z"),
  updatedAt: new Date("2026-07-28T15:00:00Z"),
  revisionCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ userId: "owner" });
});

describe("activity actions", () => {
  it("authorizes before constructing a database-backed activity service", async () => {
    vi.mocked(requireOwner).mockRejectedValueOnce(new Error("Not authorized"));

    await expect(createActivityAction({
      organizationId: activity.organizationId!,
      kind: "note",
      body: "Confirmed the venue.",
      occurredAt: activity.occurredAt,
    })).rejects.toThrow("Not authorized");
    expect(ActivityService).not.toHaveBeenCalled();
  });

  it("rejects malformed create input after authorization and before service work", async () => {
    await expect(createActivityAction({
      organizationId: activity.organizationId!,
      kind: "note",
      body: " ",
      occurredAt: activity.occurredAt,
    })).resolves.toEqual({ ok: false, error: "Add activity text." });
    expect(requireOwner).toHaveBeenCalledOnce();
    expect(ActivityService).not.toHaveBeenCalled();
  });

  it("creates through ActivityService and revalidates only affected CRM surfaces", async () => {
    create.mockResolvedValue({ ok: true, value: activity });

    await expect(createActivityAction({
      organizationId: activity.organizationId!,
      kind: "note",
      body: activity.body,
      occurredAt: activity.occurredAt,
    })).resolves.toEqual({ ok: true, activity });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/organizations/${activity.organizationId}`,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/organizations");
    expect(revalidatePath).toHaveBeenCalledWith("/calls/new");
    expect(revalidatePath).not.toHaveBeenCalledWith("/bookings");
  });

  it("edits through ActivityService and returns a readable missing error", async () => {
    edit.mockResolvedValue({
      ok: false,
      error: { code: "ACTIVITY_NOT_FOUND" },
    });

    await expect(editActivityAction({
      activityId: activity.id,
      body: "Corrected venue.",
      reason: "Fixed the summary.",
    })).resolves.toEqual({
      ok: false,
      error: "This activity could not be found. Refresh and try again.",
    });
  });
});
