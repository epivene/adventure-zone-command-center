import { apiFetch } from "@/lib/auth-token";
import type { GoogleRecentValidationRow } from "./google-workspace-client";

async function ok(response: Response): Promise<{ ok: true }> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `API ${response.status}`;
    throw new Error(code);
  }
  return body as { ok: true };
}

function metadata(row: GoogleRecentValidationRow) {
  return {
    threadId: row.threadId,
    subject: row.subject,
    from: row.from,
    to: row.to,
    internalDateMs: row.internalDateMs,
    hasAttachments: row.hasAttachments,
  };
}

export async function changeMatchedGoogleEmailProfile(
  row: GoogleRecentValidationRow,
  organizationId: string,
): Promise<{ ok: true }> {
  return ok(await apiFetch(`/google-workspace/validation/matched/${encodeURIComponent(row.id)}`, {
    method: "PUT",
    body: JSON.stringify({ ...metadata(row), organizationId }),
  }));
}

export async function ignoreMatchedGoogleEmail(
  row: GoogleRecentValidationRow,
): Promise<{ ok: true }> {
  return ok(await apiFetch(`/google-workspace/validation/matched/${encodeURIComponent(row.id)}/ignore`, {
    method: "POST",
    body: JSON.stringify(metadata(row)),
  }));
}
