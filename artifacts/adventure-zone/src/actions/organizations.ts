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
