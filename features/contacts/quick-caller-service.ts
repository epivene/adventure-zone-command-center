import { z } from "zod";

import type { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import type { PhoneMatch, QuickCallerInput } from "@/features/contacts/contact-types";

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
  | { ok: false; error: string }
  | { ok: false; match: PhoneMatch };

export type QuickCallerRepository = Pick<
  DrizzleContactRepository,
  "findContactsByPhone" | "createQuickCaller"
>;

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts.slice(0, -1).join(" ") || parts[0]!,
    lastName: parts.length > 1 ? parts.at(-1)! : "",
  };
}

export async function submitQuickCaller(
  input: QuickCallerFormInput,
  repository: QuickCallerRepository,
): Promise<QuickCallerActionResult> {
  const parsed = quickCallerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Review the caller details.",
    };
  }

  const { name, ...fields } = parsed.data;
  const caller: QuickCallerInput = { ...splitName(name), ...fields };
  if (caller.phone) {
    const match = await repository.findContactsByPhone(caller.phone);
    if (match.kind !== "none") return { ok: false, match };
  }
  const contactId = await repository.createQuickCaller(caller);
  return { ok: true, contactId };
}
