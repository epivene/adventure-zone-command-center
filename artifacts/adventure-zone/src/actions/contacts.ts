import { apiPost, apiPatch } from "@/lib/auth-token";
import type { ContactInput } from "@/features/contacts/contact-input";

export type ContactActionResult =
  | { ok: true; contactId?: string }
  | { ok: false; error: string };

export async function createContactAction(
  input: ContactInput,
): Promise<ContactActionResult> {
  try {
    return await apiPost<ContactActionResult>("/contacts", input);
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not create contact." };
  }
}

export async function updateContactAction(
  contactId: string,
  input: ContactInput,
): Promise<ContactActionResult> {
  try {
    return await apiPatch<ContactActionResult>(`/contacts/${contactId}`, input);
  } catch (e: any) {
    return { ok: false, error: e.message ?? "Could not update contact." };
  }
}
