import { apiFetch } from "@/lib/auth-token";
export async function connectionRequest(
  path = "",
  body?: unknown,
  csrf?: string,
) {
  const response = await apiFetch("/chatgpt-connection" + path, {
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "X-Connection-CSRF": csrf ?? "" },
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? data.error ?? "Connection request failed");
  return data;
}
export const scopeLabels: Record<string, string> = {
  "crm:read": "Read saved app records, profile history, emails, contracts, invoices and document text",
  "crm:append": "Create researched leads and append notes",
  "crm:update":
    "Edit notes and profiles with saved history; removing information and merging profiles need exact approval",
  "drafts:write": "Save and edit app drafts",
  "followups:write": "Create and edit follow-up reminders",
};
export const connectionButton =
  "rounded border px-4 py-2 text-sm disabled:opacity-50";
