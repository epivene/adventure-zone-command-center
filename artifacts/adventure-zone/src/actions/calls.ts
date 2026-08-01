import { apiPost } from "@/lib/auth-token";
import type { CompleteCallResult } from "@/components/calls/call-workspace";
import type { CompleteCallInput } from "@/features/calls/call-types";

export async function completeCallAction(
  input: CompleteCallInput,
): Promise<CompleteCallResult> {
  try {
    return await apiPost<CompleteCallResult>("/calls/complete", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
