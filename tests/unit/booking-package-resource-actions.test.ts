import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  configurePackages: vi.fn(),
  addRequest: vi.fn(),
  decideRequest: vi.fn(),
  configureResources: vi.fn(),
  acknowledge: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => {
    mocks.events.push("owner");
    return { userId: "owner_1" };
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/packages/package-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/packages/package-service")>();
  return {
    ...actual,
    PackageService: class {
      configureBooking(...args: unknown[]) {
        mocks.events.push("configure-packages");
        return mocks.configurePackages(...args);
      }
      addSpecialRequest(...args: unknown[]) {
        mocks.events.push("add-request");
        return mocks.addRequest(...args);
      }
      decideSpecialRequest(...args: unknown[]) {
        mocks.events.push("decide-request");
        return mocks.decideRequest(...args);
      }
    },
  };
});
vi.mock("@/features/resources/resource-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/resources/resource-service")>();
  return {
    ...actual,
    ResourceService: class {
      configureBookingAssignments(...args: unknown[]) {
        mocks.events.push("configure-resources");
        return mocks.configureResources(...args);
      }
      acknowledgeConflict(...args: unknown[]) {
        mocks.events.push("acknowledge");
        return mocks.acknowledge(...args);
      }
    },
  };
});

import {
  acknowledgeResourceConflictAction,
  addBookingSpecialRequestAction,
  configureBookingPackagesAction,
  configureBookingResourcesAction,
  decideBookingSpecialRequestAction,
} from "@/app/(private)/bookings/actions";

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  resource: "22222222-2222-4222-8222-222222222222",
  request: "33333333-3333-4333-8333-333333333333",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.configurePackages.mockResolvedValue({ ok: true, value: {} });
  mocks.addRequest.mockResolvedValue({ ok: true, value: {} });
  mocks.decideRequest.mockResolvedValue({
    ok: true,
    value: { bookingId: ids.booking },
  });
  mocks.configureResources.mockResolvedValue({ ok: true, value: {} });
  mocks.acknowledge.mockResolvedValue({ ok: true, value: undefined });
});

describe("booking package/resource actions", () => {
  it("authorizes before parsing and never accepts a client actor identity", async () => {
    await expect(configureBookingResourcesAction({
      bookingId: "not-a-uuid",
      resourceIds: [],
      actorId: "attacker",
    } as never)).resolves.toEqual({
      ok: false,
      error: "Review the resource assignments.",
    });

    expect(mocks.events).toEqual(["owner"]);
  });

  it("injects the owner into valid resource and exact-key override service calls", async () => {
    await configureBookingResourcesAction({
      bookingId: ids.booking,
      resourceIds: [ids.resource],
    });
    await acknowledgeResourceConflictAction({
      bookingId: ids.booking,
      conflictKey: "current-key",
      reason: "Owner approved",
    });

    expect(mocks.configureResources).toHaveBeenCalledWith({
      bookingId: ids.booking,
      resourceIds: [ids.resource],
      actorId: "owner_1",
    });
    expect(mocks.acknowledge).toHaveBeenCalledWith({
      bookingId: ids.booking,
      conflictKey: "current-key",
      reason: "Owner approved",
      actorId: "owner_1",
    });
  });

  it("authorizes package/request actions first and revalidates every consumer only after success", async () => {
    await configureBookingPackagesAction({
      bookingId: ids.booking,
      packageTemplateIds: [],
      physicalAttractionTotal: null,
      attractionTotalApprovalReason: null,
      manualAttributions: [],
    });
    await addBookingSpecialRequestAction({
      bookingId: ids.booking,
      description: "Ferris wheel",
      treatment: "add_to_count",
    });
    await decideBookingSpecialRequestAction({
      specialRequestId: ids.request,
      decision: "approved",
      reason: "Owner approved",
    });

    expect(mocks.events).toEqual([
      "owner", "configure-packages",
      "owner", "add-request",
      "owner", "decide-request",
    ]);
    expect(new Set(mocks.revalidatePath.mock.calls.map(([path]) => path))).toEqual(new Set([
      "/bookings",
      `/bookings/${ids.booking}`,
      `/bookings/${ids.booking}/edit`,
      "/today",
      "/calls/new",
      "/routes",
    ]));
  });

  it("maps stale conflict keys readably and does not invalidate on failure", async () => {
    mocks.acknowledge.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT_NOT_FOUND" },
    });

    await expect(acknowledgeResourceConflictAction({
      bookingId: ids.booking,
      conflictKey: "stale-key",
      reason: "Owner approved",
    })).resolves.toEqual({
      ok: false,
      error: "This conflict changed. Refresh and review the current warning.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
