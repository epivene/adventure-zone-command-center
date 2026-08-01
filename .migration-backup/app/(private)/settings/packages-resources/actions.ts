"use server";

import { revalidatePath } from "next/cache";

import {
  packageTemplateInputSchema,
  type PackageTemplateInput,
} from "@/features/packages/package-input";
import {
  DrizzlePackageSettingsRepository,
  PackageSettingsError,
} from "@/features/packages/package-repository";
import {
  resourceInputSchema,
  type ResourceInput,
} from "@/features/resources/resource-input";
import {
  DrizzleResourceSettingsRepository,
  ResourceSettingsError,
} from "@/features/resources/resource-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export type PackageResourceActionResult =
  | { ok: true }
  | { ok: false; error: string };

const revalidationPaths = [
  "/settings/packages-resources",
  "/bookings",
  "/routes",
  "/today",
] as const;

function revalidateSettingsConsumers() {
  for (const path of revalidationPaths) revalidatePath(path);
}

export async function updatePackageTemplateAction(
  input: PackageTemplateInput,
): Promise<PackageResourceActionResult> {
  const actor = await requireOwner();
  const parsed = packageTemplateInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Review the package name, attraction count, and active setting.",
    };
  }

  const { db } = await import("@/db/client");
  try {
    await new DrizzlePackageSettingsRepository(db).updatePackageTemplate(
      parsed.data,
      actor.userId,
    );
  } catch (error) {
    if (
      error instanceof PackageSettingsError &&
      error.code === "PACKAGE_TEMPLATE_NOT_FOUND"
    ) {
      return {
        ok: false,
        error:
          "This package template changed or no longer exists. Refresh and try again.",
      };
    }
    return {
      ok: false,
      error: "The package template could not be saved. Try again.",
    };
  }

  revalidateSettingsConsumers();
  return { ok: true };
}

const resourceErrorMessages: Record<
  ResourceSettingsError["code"],
  string
> = {
  RESOURCE_NOT_FOUND:
    "This resource changed or no longer exists. Refresh and try again.",
  DUPLICATE_RESOURCE_CODE:
    "That resource code is already in use. Choose another stable code.",
  UNKNOWN_PACKAGE_TAG:
    "One of the selected package tags no longer exists.",
  INACTIVE_PACKAGE_TAG:
    "Inactive package tags can only be retained on resources that already use them.",
  UNKNOWN_TRAVEL_LEG:
    "The selected normal travel leg no longer exists.",
  RESOURCE_CODE_IMMUTABLE: "Existing resource codes cannot be changed.",
};

export async function upsertResourceAction(
  input: ResourceInput,
): Promise<PackageResourceActionResult> {
  const actor = await requireOwner();
  const parsed = resourceInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        "Review the resource code, details, package tags, travel leg, timing, and status.",
    };
  }

  const { db } = await import("@/db/client");
  try {
    await new DrizzleResourceSettingsRepository(db).upsertResource(
      parsed.data,
      actor.userId,
    );
  } catch (error) {
    if (error instanceof ResourceSettingsError) {
      return { ok: false, error: resourceErrorMessages[error.code] };
    }
    return {
      ok: false,
      error: "The resource could not be saved. Try again.",
    };
  }

  revalidateSettingsConsumers();
  return { ok: true };
}
