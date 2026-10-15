import { emailReviewToolReminder } from "../email-next-step-review";
import { z } from "zod";
import {
  ConnectionError,
  type ConnectionPrincipal,
  type ConnectionScope,
} from "./contracts";
import {
  attentionInputSchema,
  attentionApplySchema,
  type EmailThreadAttentionService,
} from "../google-workspace/email-thread-attention-service";
export function emailAttentionTools(
  service: EmailThreadAttentionService | undefined,
  p: ConnectionPrincipal,
) {
  const actor = { ownerId: p.ownerId, connectorId: p.connectionId };
  const call = async (fn: () => Promise<unknown>) => {
    if (!service) throw new ConnectionError("EMAIL_ATTENTION_UNAVAILABLE", 503);
    try {
      return await fn();
    } catch (e) {
      if (
        e instanceof Error &&
        /^(EMAIL_ATTENTION_|GOOGLE_WORKSPACE_)/.test(e.message)
      )
        throw new ConnectionError(e.message, 409);
      throw e;
    }
  };
  return [
    {
      name: "preview_email_profile_assignment",
      scope: "crm:read" as ConnectionScope,
      readOnly: true,
      description:
        "Preview filing a verified Gmail conversation under a profile and keeping ongoing work in Needs Attention. Unknown event year must be null. Does not change Gmail; preview expires in 15 minutes. Investigate conflicting mappings using read_email_filing_conflicts and the preview_email_mapping_repair/repair_email_profile_mapping workflow. Re-preview filing after a verified authorized repair. Stop only when identity remains ambiguous or a permission/tool blocker remains; never force a match." + " " + emailReviewToolReminder,
      schema: attentionInputSchema,
      call: (a: any) => call(() => service!.preview(actor, a)),
    },
    {
      name: "apply_email_profile_assignment",
      scope: "email:organize" as ConnectionScope,
      readOnly: false,
      destructive: true,
      description:
        "Apply an owner-authorized filing preview with exact revision and stable requestKey. Applies profile and Needs Attention labels before archiving Inbox. Return separate Gmail/history results; pending or failed sync is not complete. No sending. Resolve only after verifying no outstanding reply or follow-up.",
      schema: attentionApplySchema,
      call: (a: any) => call(() => service!.apply(actor, a)),
    },
    {
      name: "read_email_profile_assignment",
      scope: "crm:read" as ConnectionScope,
      readOnly: true,
      description:
        "Read the saved conversation attention state and filing synchronization receipt." + " " + emailReviewToolReminder,
      schema: z
        .object({
          gmailConnectionId: z.string().uuid(),
          threadId: z.string().min(1).max(200),
        })
        .strict(),
      call: (a: any) => call(() => service!.read(actor, a)),
    },
  ];
}
