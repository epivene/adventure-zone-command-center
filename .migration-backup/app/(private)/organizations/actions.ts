"use server";

import { revalidatePath } from "next/cache";

import { setLastResortInputSchema, type SetLastResortInput } from "@/features/organizations/last-resort-input";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import { OrganizationService } from "@/features/organizations/organization-service";
import { requireOwner } from "@/lib/auth/require-owner";

export type LastResortActionResult = { ok: true } | { ok: false; error: string };

export async function setLastResortAction(
  input: SetLastResortInput,
): Promise<LastResortActionResult> {
  await requireOwner();
  const parsed = setLastResortInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Review the Last Resort details.",
    };
  }

  const { db } = await import("@/db/client");
  const service = new OrganizationService(new DrizzleOrganizationRepository(db));
  const result = await service.setLastResort(parsed.data);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error.code === "ORGANIZATION_NOT_FOUND"
          ? "This organization could not be found."
          : result.error.message,
    };
  }

  revalidatePath("/organizations");
  revalidatePath(`/organizations/${input.organizationId}`);
  revalidatePath("/contacts");
  revalidatePath("/bookings");
  return { ok: true };
}
