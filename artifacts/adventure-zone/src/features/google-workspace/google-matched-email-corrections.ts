import { apiFetch } from "@/lib/auth-token";
import type {
  GoogleProfileLabelSyncResult,
  GoogleRecentValidationRow,
} from "./google-workspace-client";

async function ok<T extends { ok: true }>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `API ${response.status}`;
    throw new Error(code);
  }
  return body as T;
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
): Promise<{ ok: true; gmailSync: GoogleProfileLabelSyncResult }> {
  return ok<{ ok: true; gmailSync: GoogleProfileLabelSyncResult }>(
    await apiFetch(`/google-workspace/validation/matched/${encodeURIComponent(row.id)}`, {
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
