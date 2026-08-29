import { apiPost } from "@/lib/auth-token";
import type { SetFillerInput, SetLastResortInput } from "@/features/organizations/last-resort-input";

export type OrganizationStrategyActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function setLastResortAction(
  input: SetLastResortInput,
): Promise<OrganizationStrategyActionResult> {
  try {
    return await apiPost<OrganizationStrategyActionResult>("/organizations/last-resort", input);
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not update last resort status." };
  }
}

export async function setFillerAction(
  input: SetFillerInput,
): Promise<OrganizationStrategyActionResult> {
  try {
    return await apiPost<OrganizationStrategyActionResult>("/organizations/filler", input);
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not update filler strategy." };
  }
}
