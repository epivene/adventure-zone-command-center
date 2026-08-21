import { and, desc, eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { activities, officeMailActivity, officeTasks } from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type { OfficeMailTransactionStore, OfficeMailUnitOfWork } from "./office-mail-service";

type DrizzleDatabase = typeof database;

type Transaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];

function mailRecord(row: typeof officeMailActivity.$inferSelect) {
  return {
    id: row.id,
    taskId: row.taskId,
    organizationId: row.organizationId,
    contactId: row.contactId,
    recipientName: row.recipientName,
    preparedAt: row.preparedAt,
    mailedAt: row.mailedAt,
    note: row.note,
  };
}

class DrizzleOfficeMailTransactionStore implements OfficeMailTransactionStore {
  constructor(private readonly transaction: Transaction) {}

  async loadTask(taskId: string, accountId: string) {
    const [task] = await this.transaction
      .select({
        id: officeTasks.id,
        officeAccountId: officeTasks.officeAccountId,
        taskType: officeTasks.taskType,
        status: officeTasks.status,
        organizationId: officeTasks.organizationId,
        contactId: officeTasks.contactId,
      })
      .from(officeTasks)
      .where(and(eq(officeTasks.id, taskId), eq(officeTasks.officeAccountId, accountId)))
      .limit(1)
      .for("update");
    return task ?? null;
  }

  async loadMail(taskId: string) {
    const [row] = await this.transaction
      .select()
      .from(officeMailActivity)
      .where(eq(officeMailActivity.taskId, taskId))
      .limit(1)
      .for("update");
    return row ? mailRecord(row) : null;
  }

  async savePrepared(input: {
    taskId: string;
    officeAccountId: string;
    organizationId: string;
    contactId: string | null;
    recipientName: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    preparedAt: Date;
  }) {
    const [existing] = await this.transaction.select().from(officeMailActivity).where(eq(officeMailActivity.taskId, input.taskId)).limit(1);
    const values = {
      officeAccountId: input.officeAccountId,
      taskId: input.taskId,
      organizationId: input.organizationId,
      contactId: input.contactId,
      recipientName: input.recipientName,
      address1Snapshot: input.address1,
      address2Snapshot: input.address2,
      citySnapshot: input.city,
      regionSnapshot: input.region,
      postalCodeSnapshot: input.postalCode,
      preparedAt: input.preparedAt,
      updatedAt: new Date(),
    };
    const [saved] = existing
      ? await this.transaction.update(officeMailActivity).set(values).where(eq(officeMailActivity.id, existing.id)).returning()
      : await this.transaction.insert(officeMailActivity).values(values).returning();
    if (!saved) throw new Error("Mail activity could not be saved.");
    return mailRecord(saved);
  }

  async saveMailed(id: string, input: { mailedAt: Date; note: string | null }) {
    const [saved] = await this.transaction
      .update(officeMailActivity)
      .set({ mailedAt: input.mailedAt, note: input.note, updatedAt: new Date() })
      .where(eq(officeMailActivity.id, id))
      .returning();
    if (!saved) throw new Error("Mail activity could not be updated.");
    return mailRecord(saved);
  }

  async appendProfileNote(input: { organizationId: string; contactId: string | null; body: string; occurredAt: Date }) {
    const now = new Date();
    const [activity] = await this.transaction.insert(activities).values({
      organizationId: input.organizationId,
      contactId: input.contactId,
      kind: "note",
      body: input.body,
      occurredAt: input.occurredAt,
      timelineSortAt: input.occurredAt,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!activity) throw new Error("Mail history note could not be saved.");
    await recordAuditEntry(this.transaction, {
      entityType: "activity",
      entityId: activity.id,
      action: "create",
      before: null,
      after: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        kind: "note",
        body: input.body,
        occurredAt: input.occurredAt.toISOString(),
        source: "office_mail",
      },
    });
  }

  async updateTask(taskId: string, input: { status: "in_progress" | "done"; completedAt?: Date | null }) {
    await this.transaction.update(officeTasks).set({
      status: input.status,
      completedAt: input.completedAt ?? null,
      updatedAt: new Date(),
    }).where(eq(officeTasks.id, taskId));
  }
}

export class DrizzleOfficeMailRepository implements OfficeMailUnitOfWork {
  constructor(private readonly database: DrizzleDatabase) {}

  run<T>(operation: (store: OfficeMailTransactionStore) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) => operation(new DrizzleOfficeMailTransactionStore(transaction)));
  }

  async listForOffice(accountId: string) {
    return this.database.select().from(officeMailActivity)
      .where(eq(officeMailActivity.officeAccountId, accountId))
      .orderBy(desc(officeMailActivity.mailedAt), desc(officeMailActivity.createdAt));
  }

  async listForOwner(accountId?: string | null) {
    return this.database.select().from(officeMailActivity)
      .where(accountId ? eq(officeMailActivity.officeAccountId, accountId) : undefined)
      .orderBy(desc(officeMailActivity.mailedAt), desc(officeMailActivity.createdAt));
  }
}
