import { z } from "zod";

import type { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import type { DuplicateCandidate } from "@/features/caller-finder/caller-finder-types";
import type { QuickCallerInput } from "@/features/contacts/contact-types";

const optionalText = z.string().trim().transform((value) => value || null);

const quickCallerSchema = z.object({
  requestKey: z.string().uuid(),
  name: z.string().trim().min(1, "Enter the caller's name."),
  organizationName: z.string().trim().min(1, "Enter an organization or event."),
  phone: optionalText,
  email: z.string().trim().toLowerCase().transform((value) => value || null),
  reason: z.string().trim().min(1, "Enter the reason for calling."),
  eventDate: optionalText,
  eventLocation: optionalText,
  continueCreating: z.boolean().optional().default(false),
}).refine((value) => Boolean(value.phone || value.email), {
  message: "Enter a phone number or email address.",
  path: ["phone"],
});

export type QuickCallerFormInput = z.input<typeof quickCallerSchema>;
export type QuickCallerActionResult =
  | { ok: true; contactId: string }
  | { ok: false; error: string }
  | {
      ok: false;
      candidates: DuplicateCandidate[];
      canContinueCreating: boolean;
    };

export type QuickCallerRepository = Pick<
  DrizzleContactRepository,
  "hasExactQuickCallerDuplicate" | "findQuickCallerDuplicates" | "createQuickCaller"
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
  const [hasExact, candidates] = await Promise.all([
    repository.hasExactQuickCallerDuplicate(caller),
    repository.findQuickCallerDuplicates(caller),
  ]);
  if (hasExact) {
    return { ok: false, candidates, canContinueCreating: false };
  }
  if (candidates.length > 0 && !caller.continueCreating) {
    return { ok: false, candidates, canContinueCreating: true };
  }

  const result = await repository.createQuickCaller(caller);
  return result.kind === "created"
    ? { ok: true, contactId: result.contactId }
    : {
        ok: false,
        candidates: result.candidates,
        canContinueCreating: result.canContinueCreating,
      };
}
