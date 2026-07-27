import type { db as database } from "@/db/client";
import { auditEntries } from "@/db/schema";

export const reversibleEntityTypes = [
  "booking",
  "contact",
  "organization",
  "follow_up",
  "travel_leg",
] as const;

export type ReversibleEntityType = (typeof reversibleEntityTypes)[number];

export type AuditChange = {
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reversesEntryId?: string | null;
};

export type StoredAuditEntry = AuditChange & {
  id: string;
  reversesEntryId: string | null;
  createdAt: Date;
};

type AuditWriter = Pick<typeof database, "insert">;

function jsonSnapshot(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export async function recordAuditEntry(
  transaction: AuditWriter,
  change: AuditChange,
): Promise<void> {
  await transaction.insert(auditEntries).values({
    ...change,
    before: jsonSnapshot(change.before),
    after: jsonSnapshot(change.after),
    reversesEntryId: change.reversesEntryId ?? null,
  });
}
