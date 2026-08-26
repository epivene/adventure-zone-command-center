export type CommunicationBlockTarget = "organization" | "contact" | "recipient_email" | "lead_import_row" | "internal_preview";
export type CommunicationBlock = { id?: string; active: boolean; targetType: CommunicationBlockTarget; organizationId?: string | null; contactId?: string | null; normalizedEmail?: string | null; rowId?: string | null; reason?: string | null };
export type CommunicationBlockHistoryEvent = { action: "created" | "removed"; actorId: string; reason: string };

export function normalizeCommunicationBlockEmail(value: string | null | undefined) { return value?.trim().toLowerCase() ?? ""; }

export function communicationBlockMatches(block: CommunicationBlock, target: { organizationId?: string | null; contactId?: string | null; recipientEmail?: string | null; rowId?: string | null }) {
  if (!block.active) return false;
  if (block.targetType === "internal_preview") return true;
  if (block.targetType === "organization") return Boolean(target.organizationId && target.organizationId === block.organizationId);
  if (block.targetType === "contact") return Boolean(target.contactId && target.contactId === block.contactId);
  if (block.targetType === "lead_import_row") return Boolean(target.rowId && target.rowId === block.rowId);
  const email = normalizeCommunicationBlockEmail(target.recipientEmail);
  return Boolean(email && email === normalizeCommunicationBlockEmail(block.normalizedEmail));
}

export function createCommunicationBlockPolicy() {
  const blocks: CommunicationBlock[] = [];
  const events = new Map<string, CommunicationBlockHistoryEvent[]>();
  const key = (block: Omit<CommunicationBlock, "id" | "active">) => [block.targetType, block.organizationId ?? "", block.contactId ?? "", normalizeCommunicationBlockEmail(block.normalizedEmail), block.rowId ?? ""].join("|");
  return {
    create(input: Omit<CommunicationBlock, "id" | "active"> & { actorId: string }): CommunicationBlock & { id: string } {
      const existing = blocks.find((block) => block.active && key(block) === key(input));
      if (existing) return existing as CommunicationBlock & { id: string };
      const block = { id: `block-${blocks.length + 1}`, active: true, ...input, normalizedEmail: normalizeCommunicationBlockEmail(input.normalizedEmail) || null };
      blocks.push(block); events.set(block.id, [{ action: "created", actorId: input.actorId, reason: input.reason ?? "" }]); return block;
    },
    remove(id: string, input: { actorId: string; reason: string }) {
      const block = blocks.find((item) => item.id === id);
      if (!block || !block.active) return block ?? null;
      block.active = false; events.get(id)?.push({ action: "removed", ...input }); return block;
    },
    isBlocked(target: Parameters<typeof communicationBlockMatches>[1]) { return blocks.some((block) => communicationBlockMatches(block, target)); },
    history(id: string) { return events.get(id) ?? []; },
  };
}
