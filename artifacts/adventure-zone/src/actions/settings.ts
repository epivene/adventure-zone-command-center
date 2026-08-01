import { apiPost, apiPatch } from "@/lib/auth-token";

export type SettingsActionResult = { ok: true } | { ok: false; error: string };

export async function updatePackageTemplateAction(input: unknown): Promise<SettingsActionResult> {
  try {
    return await apiPost<SettingsActionResult>("/settings/package-templates", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function upsertResourceAction(input: unknown): Promise<SettingsActionResult> {
  try {
    return await apiPost<SettingsActionResult>("/settings/resources", input);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
