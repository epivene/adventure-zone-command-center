import { and, eq, isNull, or } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { communicationBlockEvents, communicationBlocks } from "@/db/schema";
import { normalizeCommunicationBlockEmail, type CommunicationBlock } from "./communication-block-policy";
import {
  acquireCommunicationSafetyLock,
  type CommunicationSafetyLockExecutor,
} from "./communication-safety-lock";

type Database = typeof database;
export type CommunicationBlockTargetInput = { organizationId?: string | null; contactId?: string | null; recipientEmail?: string | null; rowId?: string | null };
type CommunicationBlockCreateCommon = { reason: string; actorId: string };
export type CommunicationBlockCreateInput = CommunicationBlockCreateCommon & (
  | { targetType: "organization"; organizationId: string; contactId?: never; normalizedEmail?: never; rowId?: never }
  | { targetType: "contact"; organizationId?: never; contactId: string; normalizedEmail?: never; rowId?: never }
  | { targetType: "recipient_email"; organizationId?: never; contactId?: never; normalizedEmail: string; rowId?: never }
  | { targetType: "lead_import_row"; organizationId?: never; contactId?: never; normalizedEmail?: never; rowId: string }
  | { targetType: "internal_preview"; organizationId?: never; contactId?: never; normalizedEmail?: never; rowId?: never }
);

type NormalizedCommunicationBlockTarget = {
  targetType: CommunicationBlock["targetType"];
  organizationId: string | null;
  contactId: string | null;
  normalizedEmail: string | null;
  rowId: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeCreateTarget(input: CommunicationBlockCreateInput): NormalizedCommunicationBlockTarget {
  const organizationId = input.organizationId?.trim() || null;
  const contactId = input.contactId?.trim() || null;
  const normalizedEmail = normalizeCommunicationBlockEmail(input.normalizedEmail) || null;
  const rowId = input.rowId?.trim() || null;
  const targetCount = [organizationId, contactId, normalizedEmail, rowId].filter(Boolean).length;
  if (input.targetType === "internal_preview" && targetCount === 0) {
    return { targetType: input.targetType, organizationId, contactId, normalizedEmail, rowId };
  }
  if (input.targetType === "organization" && targetCount === 1 && organizationId) {
    return { targetType: input.targetType, organizationId, contactId, normalizedEmail, rowId };
  }
  if (input.targetType === "contact" && targetCount === 1 && contactId) {
    return { targetType: input.targetType, organizationId, contactId, normalizedEmail, rowId };
  }
  if (input.targetType === "lead_import_row" && targetCount === 1 && rowId) {
    return { targetType: input.targetType, organizationId, contactId, normalizedEmail, rowId };
  }
  if (input.targetType === "recipient_email" && targetCount === 1 && normalizedEmail && EMAIL_PATTERN.test(normalizedEmail)) {
    return { targetType: input.targetType, organizationId, contactId, normalizedEmail, rowId };
  }
  if (input.targetType === "recipient_email") throw new Error("A valid recipient email target is required.");
  throw new Error("Exactly one stable target matching the communication-block target type is required.");
}

export class CommunicationBlockRepository {
  private readonly acquireSafetyLock: (executor: CommunicationSafetyLockExecutor) => Promise<void>;

  constructor(
    private readonly database: Database,
    dependencies?: { acquireSafetyLock?: (executor: CommunicationSafetyLockExecutor) => Promise<void> },
  ) {
    this.acquireSafetyLock = dependencies?.acquireSafetyLock ?? acquireCommunicationSafetyLock;
  }

  async listActive(target: CommunicationBlockTargetInput): Promise<CommunicationBlock[]> {
    const recipient = normalizeCommunicationBlockEmail(target.recipientEmail);
    const predicates = [eq(communicationBlocks.targetType, "internal_preview")];
    if (target.organizationId) predicates.push(and(eq(communicationBlocks.targetType, "organization"), eq(communicationBlocks.organizationId, target.organizationId))!);
    if (target.contactId) predicates.push(and(eq(communicationBlocks.targetType, "contact"), eq(communicationBlocks.contactId, target.contactId))!);
    if (target.rowId) predicates.push(and(eq(communicationBlocks.targetType, "lead_import_row"), eq(communicationBlocks.rowId, target.rowId))!);
    if (recipient) predicates.push(and(eq(communicationBlocks.targetType, "recipient_email"), eq(communicationBlocks.normalizedEmail, recipient))!);
    return this.database.select().from(communicationBlocks).where(and(eq(communicationBlocks.active, true), or(...predicates)));
  }

  async list() { return this.database.select().from(communicationBlocks).orderBy(communicationBlocks.createdAt); }

  async history(id: string) {
    return this.database.select().from(communicationBlockEvents).where(eq(communicationBlockEvents.blockId, id)).orderBy(communicationBlockEvents.createdAt);
  }

  async create(input: CommunicationBlockCreateInput) {
    if (!input.reason.trim() || !input.actorId.trim()) throw new Error("A reason and actor are required.");
    const target = normalizeCreateTarget(input);
    return this.database.transaction(async (tx) => {
      await this.acquireSafetyLock(tx);
      const targetPredicates = [
        target.organizationId ? eq(communicationBlocks.organizationId, target.organizationId) : isNull(communicationBlocks.organizationId),
        target.contactId ? eq(communicationBlocks.contactId, target.contactId) : isNull(communicationBlocks.contactId),
        target.normalizedEmail ? eq(communicationBlocks.normalizedEmail, target.normalizedEmail) : isNull(communicationBlocks.normalizedEmail),
        target.rowId ? eq(communicationBlocks.rowId, target.rowId) : isNull(communicationBlocks.rowId),
      ];
      const existing = await tx.select().from(communicationBlocks).where(and(
        eq(communicationBlocks.active, true), eq(communicationBlocks.targetType, target.targetType), ...targetPredicates,
      )).limit(1);
      if (existing[0]) return existing[0];
      const [created] = await tx.insert(communicationBlocks)
        .values({ ...target, reason: input.reason.trim(), createdBy: input.actorId.trim() })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      const [winner] = await tx.select().from(communicationBlocks).where(and(
        eq(communicationBlocks.active, true), eq(communicationBlocks.targetType, target.targetType), ...targetPredicates,
      )).limit(1);
      if (winner) return winner;
      throw new Error("COMMUNICATION_BLOCK_CREATE_CONFLICT");
    });
  }

  async remove(id: string, input: { actorId: string; reason: string }) {
    return this.database.transaction(async (tx) => {
      await this.acquireSafetyLock(tx);
      const [block] = await tx.select().from(communicationBlocks).where(eq(communicationBlocks.id, id)).limit(1).for("update");
      if (!block || !block.active) return block ?? null;
      const [removed] = await tx.update(communicationBlocks).set({ active: false, removedAt: new Date(), removedBy: input.actorId, removalReason: input.reason }).where(eq(communicationBlocks.id, id)).returning();
      await tx.insert(communicationBlockEvents).values({ blockId: id, action: "removed", actorId: input.actorId, reason: input.reason });
      return removed!;
    });
  }
}
