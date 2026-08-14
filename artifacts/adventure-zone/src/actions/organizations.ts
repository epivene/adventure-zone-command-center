import { apiPost } from "@/lib/auth-token";
import type { SetLastResortInput } from "@/features/organizations/last-resort-input";

export type LastResortActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function setLastResortAction(
  input: SetLastResortInput,
): Promise<LastResortActionResult> {
  try {
    return await apiPost<LastResortActionResult>("/organizations/last-resort", input);
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not update last resort status." };
  }
}


export type OrganizationHierarchyActionResult =
  | { ok: true; parentId?: string }
  | { ok: false; error: string };

export type SetOrganizationParentInput = {
  childId: string;
  parentId: string;
};

export type CreateOrganizationParentInput = {
  name: string;
  website?: string | null;
  phone?: string | null;
  childIds: string[];
};

export type UngroupOrganizationInput = {
  childId: string;
};

async function hierarchyAction(
  path: string,
  input: unknown,
): Promise<OrganizationHierarchyActionResult> {
  try {
    return await apiPost<OrganizationHierarchyActionResult>(path, input);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not update organization hierarchy.",
    };
  }
}

export function setOrganizationParentAction(
  input: SetOrganizationParentInput,
): Promise<OrganizationHierarchyActionResult> {
  return hierarchyAction("/organizations/hierarchy/parent", input);
}

export function createOrganizationParentAction(
  input: CreateOrganizationParentInput,
): Promise<OrganizationHierarchyActionResult> {
  return hierarchyAction("/organizations/hierarchy/create-parent", input);
}

export function ungroupOrganizationAction(
  input: UngroupOrganizationInput,
): Promise<OrganizationHierarchyActionResult> {
  return hierarchyAction("/organizations/hierarchy/ungroup", input);
}
