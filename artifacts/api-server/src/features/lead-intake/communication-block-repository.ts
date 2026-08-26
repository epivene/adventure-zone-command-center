import { and, eq, isNull, or } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { communicationBlockEvents, communicationBlocks } from "@/db/schema";
import { normalizeCommunicationBlockEmail, type CommunicationBlock } from "./communication-block-policy";

type Database = typeof database;
export type CommunicationBlockTargetInput = { organizationId?: string | null; contactId?: string | null; recipientEmail?: string | null; rowId?: string | null };

export class CommunicationBlockRepository {
  constructor(private readonly database: Database) {}

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

  async create(input: { targetType: CommunicationBlock["targetType"]; organizationId?: string | null; contactId?: string | null; normalizedEmail?: string | null; rowId?: string | null; reason: string; actorId: string }) {
    const normalizedEmail = normalizeCommunicationBlockEmail(input.normalizedEmail) || null;
    const existing = await this.database.select().from(communicationBlocks).where(and(
      eq(communicationBlocks.active, true), eq(communicationBlocks.targetType, input.targetType),
      input.organizationId ? eq(communicationBlocks.organizationId, input.organizationId) : isNull(communicationBlocks.organizationId),
      input.contactId ? eq(communicationBlocks.contactId, input.contactId) : isNull(communicationBlocks.contactId),
      normalizedEmail ? eq(communicationBlocks.normalizedEmail, normalizedEmail) : isNull(communicationBlocks.normalizedEmail),
      input.rowId ? eq(communicationBlocks.rowId, input.rowId) : isNull(communicationBlocks.rowId),
    )).limit(1);
    if (existing[0]) return existing[0];
    try {
      const [created] = await this.database.insert(communicationBlocks).values({ ...input, normalizedEmail, createdBy: input.actorId }).returning();
      return created!;
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      const [winner] = await this.database.select().from(communicationBlocks).where(and(
        eq(communicationBlocks.active, true), eq(communicationBlocks.targetType, input.targetType),
        input.organizationId ? eq(communicationBlocks.organizationId, input.organizationId) : isNull(communicationBlocks.organizationId),
        input.contactId ? eq(communicationBlocks.contactId, input.contactId) : isNull(communicationBlocks.contactId),
        normalizedEmail ? eq(communicationBlocks.normalizedEmail, normalizedEmail) : isNull(communicationBlocks.normalizedEmail),
        input.rowId ? eq(communicationBlocks.rowId, input.rowId) : isNull(communicationBlocks.rowId),
      )).limit(1);
      if (winner) return winner;
      throw error;
    }
  }

  async remove(id: string, input: { actorId: string; reason: string }) {
    return this.database.transaction(async (tx) => {
      const [block] = await tx.select().from(communicationBlocks).where(eq(communicationBlocks.id, id)).limit(1).for("update");
      if (!block || !block.active) return block ?? null;
      const [removed] = await tx.update(communicationBlocks).set({ active: false, removedAt: new Date(), removedBy: input.actorId, removalReason: input.reason }).where(eq(communicationBlocks.id, id)).returning();
      await tx.insert(communicationBlockEvents).values({ blockId: id, action: "removed", actorId: input.actorId, reason: input.reason });
      return removed!;
    });
  }
}
