import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  updatePackageTemplate: vi.fn(),
  upsertResource: vi.fn(),
}));

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner_1" })),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  updatePackageTemplateAction,
  upsertResourceAction,
} from "@/app/(private)/settings/packages-resources/actions";
import {
  DrizzlePackageSettingsRepository,
  PackageSettingsError,
} from "@/features/packages/package-repository";
import {
  DrizzleResourceSettingsRepository,
  ResourceSettingsError,
} from "@/features/resources/resource-repository";
import { requireOwner } from "@/lib/auth/require-owner";
import { revalidatePath } from "next/cache";

const packageInput = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Adventure Zone",
  baseAttractionCount: 10,
  active: true,
};

const resourceInput = {
  id: "22222222-2222-4222-8222-222222222222",
  code: "paintball_trailer",
  name: "Paintball trailer",
  category: "trailer",
  countsAsAttraction: true,
  packageTemplateIds: ["11111111-1111-4111-8111-111111111111"],
  normalTravelLegId: "33333333-3333-4333-8333-333333333333",
  movable: true,
  setupMinutes: 30,
  teardownMinutes: 20,
  minimumTransferMinutes: 60,
  status: "available" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOwner).mockResolvedValue({ userId: "owner_1" });
  vi.spyOn(
    DrizzlePackageSettingsRepository.prototype,
    "updatePackageTemplate",
  ).mockImplementation(actionMocks.updatePackageTemplate);
  vi.spyOn(
    DrizzleResourceSettingsRepository.prototype,
    "upsertResource",
  ).mockImplementation(actionMocks.upsertResource);
});

describe("package and resource settings actions", () => {
  it("authorizes before doing any package work", async () => {
    vi.mocked(requireOwner).mockRejectedValueOnce(new Error("Not authorized"));

    await expect(
      updatePackageTemplateAction(packageInput),
    ).rejects.toThrow("Not authorized");

    expect(actionMocks.updatePackageTemplate).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied package actor after authorization", async () => {
    await expect(
      updatePackageTemplateAction({
        ...packageInput,
        actorId: "attacker",
      } as never),
    ).resolves.toMatchObject({ ok: false });

    expect(requireOwner).toHaveBeenCalledOnce();
    expect(actionMocks.updatePackageTemplate).not.toHaveBeenCalled();
  });

  it("parses and canonicalizes a package update again on the server", async () => {
    actionMocks.updatePackageTemplate.mockResolvedValue({
      ...packageInput,
      name: "Adventure Zone Deluxe",
    });

    await expect(
      updatePackageTemplateAction({
        ...packageInput,
        id: packageInput.id.toUpperCase(),
        name: "  Adventure Zone Deluxe  ",
      }),
    ).resolves.toEqual({ ok: true });

    expect(actionMocks.updatePackageTemplate).toHaveBeenCalledWith(
      {
        ...packageInput,
        name: "Adventure Zone Deluxe",
      },
      "owner_1",
    );
    expect(revalidatePath).toHaveBeenCalledTimes(4);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/settings/packages-resources"],
      ["/bookings"],
      ["/routes"],
      ["/today"],
    ]);
  });

  it.each([
    { baseAttractionCount: "10" },
    { active: "true" },
    { baseAttractionCount: 0 },
    { id: "not-a-uuid" },
  ])(
    "rejects malformed non-coerced package input %o without a write or revalidation",
    async (override) => {
      await expect(
        updatePackageTemplateAction({
          ...packageInput,
          ...override,
        } as never),
      ).resolves.toMatchObject({ ok: false });

      expect(actionMocks.updatePackageTemplate).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("maps a stale package id to a readable error without revalidation", async () => {
    actionMocks.updatePackageTemplate.mockRejectedValue(
      new PackageSettingsError("PACKAGE_TEMPLATE_NOT_FOUND"),
    );

    await expect(
      updatePackageTemplateAction(packageInput),
    ).resolves.toEqual({
      ok: false,
      error:
        "This package template changed or no longer exists. Refresh and try again.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("derives the resource audit actor from the owner and canonicalizes creation input", async () => {
    actionMocks.upsertResource.mockResolvedValue({
      ...resourceInput,
      id: "44444444-4444-4444-8444-444444444444",
    });

    await expect(
      upsertResourceAction({
        ...resourceInput,
        id: null,
        code: "  NEW_RIG  ",
        name: "  New rig  ",
        category: "  Trailer  ",
        packageTemplateIds: [
          resourceInput.packageTemplateIds[0]!.toUpperCase(),
        ],
        normalTravelLegId: resourceInput.normalTravelLegId.toUpperCase(),
      }),
    ).resolves.toEqual({ ok: true });

    expect(actionMocks.upsertResource).toHaveBeenCalledWith(
      {
        ...resourceInput,
        id: null,
        code: "new_rig",
        name: "New rig",
        category: "Trailer",
      },
      "owner_1",
    );
    expect(revalidatePath).toHaveBeenCalledTimes(4);
  });

  it("authorizes before parsing or persisting a resource", async () => {
    vi.mocked(requireOwner).mockRejectedValueOnce(new Error("Not authorized"));

    await expect(
      upsertResourceAction({
        actorId: "attacker",
      } as never),
    ).rejects.toThrow("Not authorized");

    expect(actionMocks.upsertResource).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { countsAsAttraction: "true" },
    { movable: 1 },
    { setupMinutes: "30" },
    { teardownMinutes: -1 },
    { minimumTransferMinutes: 1.5 },
    {
      packageTemplateIds: [
          resourceInput.packageTemplateIds[0],
          resourceInput.packageTemplateIds[0],
      ],
    },
    { normalTravelLegId: "not-a-uuid" },
    { actorId: "attacker" },
  ])(
    "rejects malformed resource input %o before persistence",
    async (override) => {
      await expect(
        upsertResourceAction({
          ...resourceInput,
          ...override,
        } as never),
      ).resolves.toMatchObject({ ok: false });

      expect(actionMocks.upsertResource).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "RESOURCE_NOT_FOUND",
      "This resource changed or no longer exists. Refresh and try again.",
    ],
    [
      "DUPLICATE_RESOURCE_CODE",
      "That resource code is already in use. Choose another stable code.",
    ],
    [
      "UNKNOWN_PACKAGE_TAG",
      "One of the selected package tags no longer exists.",
    ],
    [
      "INACTIVE_PACKAGE_TAG",
      "Inactive package tags can only be retained on resources that already use them.",
    ],
    [
      "UNKNOWN_TRAVEL_LEG",
      "The selected normal travel leg no longer exists.",
    ],
    [
      "RESOURCE_CODE_IMMUTABLE",
      "Existing resource codes cannot be changed.",
    ],
  ] as const)("maps %s to readable resource feedback", async (code, message) => {
    actionMocks.upsertResource.mockRejectedValue(
      new ResourceSettingsError(code),
    );

    await expect(upsertResourceAction(resourceInput)).resolves.toEqual({
      ok: false,
      error: message,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("archives through status rather than exposing a delete action", async () => {
    actionMocks.upsertResource.mockResolvedValue({
      ...resourceInput,
      status: "archived",
    });

    await upsertResourceAction({ ...resourceInput, status: "archived" });

    expect(actionMocks.upsertResource).toHaveBeenCalledWith(
      { ...resourceInput, status: "archived" },
      "owner_1",
    );
  });
});
