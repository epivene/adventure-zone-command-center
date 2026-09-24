import { z } from "zod";
import type { Grant } from "./contracts";
import {
  officeProfileInputSchema,
  officeNoteInputSchema,
} from "../office/office-profile-input";
export function mutationAllowed(
  grants: Grant[],
  kind: string,
  targetId: string,
) {
  return grants.some(
    (g) => g.actionKind === kind && g.targetIds.includes(targetId),
  );
}
export function assertMutationGrant(
  grants: Grant[],
  intent: {
    actorId: string;
    sourceMessageId: string;
    kind: string;
    targetId: string;
    expectedRevision: string | null;
    connectionId: string | null;
  },
) {
  if (
    !grants.some(
      (g) =>
        g.actorId === intent.actorId &&
        g.sourceMessageId === intent.sourceMessageId &&
        g.actionKind === intent.kind &&
        g.targetIds.includes(intent.targetId) &&
        g.revision === intent.expectedRevision &&
        g.connectionId === intent.connectionId,
    )
  )
    throw new Error("ASSISTANT_ACTION_NOT_AUTHORIZED");
}
export const recordSchemas = {
  update_profile: officeProfileInputSchema,
  add_profile_note: officeNoteInputSchema,
  create_followup: z
    .object({
      kind: z.string().min(1).max(120),
      dueAt: z.iso.datetime({ offset: true }),
      contactId: z.string().uuid().nullable(),
      bookingId: z.string().uuid().nullable(),
    })
    .strict(),
  update_followup: z
    .object({
      kind: z.string().min(1).max(120),
      dueAt: z.iso.datetime({ offset: true }),
      completed: z.boolean(),
      outcome: z.string().max(4000).nullable(),
    })
    .strict(),
  link_document: z
    .object({
      organizationId: z.string().uuid(),
      bookingId: z.string().uuid().nullable(),
    })
    .strict(),
  assign_profile_label: z
    .object({ organizationId: z.string().uuid() })
    .strict(),
};
export function validateRecordAction(kind: string, args: unknown) {
  const schema = recordSchemas[kind as keyof typeof recordSchemas];
  if (!schema) throw new Error("ASSISTANT_TOOL_UNKNOWN");
  return schema.parse(args);
}
