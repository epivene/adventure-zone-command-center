"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import type { QuickCallerInput } from "@/features/contacts/contact-types";
import { requireOwner } from "@/lib/auth/require-owner";

const optionalText = z.string().trim().transform((value) => value || null);

const quickCallerSchema = z.object({
  name: z.string().trim().min(1, "Enter the caller's name."),
  organizationName: z.string().trim().min(1, "Enter an organization or event."),
  phone: optionalText,
  email: z.string().trim().toLowerCase().refine(
    (value) => !value || z.email().safeParse(value).success,
    "Enter a valid email address.",
  ).transform((value) => value || null),
  reason: z.string().trim().min(1, "Enter the reason for calling."),
  eventDate: optionalText,
  eventLocation: optionalText,
}).refine((value) => Boolean(value.phone || value.email), {
  message: "Enter a phone number or email address.",
  path: ["phone"],
});

export type QuickCallerFormInput = z.input<typeof quickCallerSchema>;
export type QuickCallerActionResult =
  | { ok: true; contactId: string }
  | { ok: false; error: string };

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts.slice(0, -1).join(" ") || parts[0]!,
    lastName: parts.length > 1 ? parts.at(-1)! : "",
  };
}

export async function createQuickCallerAction(
  input: QuickCallerFormInput,
): Promise<QuickCallerActionResult> {
  await requireOwner();
  const parsed = quickCallerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Review the caller details.",
    };
  }

  const { name, ...fields } = parsed.data;
  const caller: QuickCallerInput = { ...splitName(name), ...fields };
  const { db } = await import("@/db/client");
  const contactId = await new DrizzleContactRepository(db).createQuickCaller(caller);
  revalidatePath("/contacts");
  revalidatePath("/organizations");
  return { ok: true, contactId };
}
