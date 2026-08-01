"use server";

import { revalidatePath } from "next/cache";

import {
  contactFormInputSchema,
  type ContactInput,
} from "@/features/contacts/contact-input";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export type ContactActionResult =
  | { ok: true; contactId?: string }
  | { ok: false; error: string };

export async function createContactAction(
  input: ContactInput,
): Promise<ContactActionResult> {
  await requireOwner();
  const parsed = contactFormInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review the highlighted contact fields." };
  }

  const { db } = await import("@/db/client");
  const contactId = await new DrizzleContactRepository(db).createContact(
    parsed.data,
  );
  revalidatePath("/contacts");
  return { ok: true, contactId };
}

export async function updateContactAction(
  contactId: string,
  input: ContactInput,
): Promise<ContactActionResult> {
  await requireOwner();
  const parsed = contactFormInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review the highlighted contact fields." };
  }

  const { db } = await import("@/db/client");
  const updated = await new DrizzleContactRepository(db).updateContact(
    contactId,
    parsed.data,
  );
  if (!updated) return { ok: false, error: "This contact could not be found." };

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath(`/contacts/${contactId}/edit`);
  return { ok: true, contactId };
}
