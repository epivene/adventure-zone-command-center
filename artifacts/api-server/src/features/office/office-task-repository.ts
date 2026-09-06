import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { contacts, officeTasks, organizations, type OfficeTaskStatus, type OfficeTaskType } from "@/db/schema";
import type { OfficeTaskView } from "./office-task-types";

type DrizzleDatabase = typeof database;

type OfficeTaskRow = {
  id: string;
  officeAccountId: string;
  taskType: OfficeTaskType;
  title: string;
  instructions: string | null;
  organizationId: string | null;
  organizationName: string | null;
  contactId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  status: OfficeTaskStatus;
  needsHelp: boolean;
  coordinatorNote: string | null;
  ownerSortOrder: number;
  dueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

const activeCondition = sql`${officeTasks.status} not in ('done', 'cancelled')`;

function iso(value: Date | null) {
  return value ? value.toISOString() : null;
}

export function toOfficeTaskView(row: OfficeTaskRow): OfficeTaskView {
  const contactName = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ").trim();
  return {
    id: row.id,
    type: row.taskType,
    title: row.title,
    instructions: row.instructions,
    profile: row.organizationId && row.organizationName ? { id: row.organizationId, name: row.organizationName } : null,
    contact: row.contactId ? { id: row.contactId, name: contactName || "Contact" } : null,
    status: row.status as Exclude<OfficeTaskStatus, "cancelled">,
    needsHelp: row.needsHelp,
    coordinatorNote: row.coordinatorNote,
    dueAt: iso(row.dueAt),
    completedAt: iso(row.completedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function officeTaskUpdateSet(
  input: { status?: Exclude<OfficeTaskStatus, "cancelled">; coordinatorNote?: string | null; needsHelp?: boolean },
  now = new Date(),
) {
  const set: Record<string, unknown> = { updatedAt: now };
  if (input.status !== undefined) {
    set.status = input.status;
    set.completedAt = input.status === "done" ? now : null;
  }
  if (input.coordinatorNote !== undefined) set.coordinatorNote = input.coordinatorNote;
  if (input.needsHelp !== undefined) set.needsHelp = input.needsHelp;
  return set;
}

export class DrizzleOfficeTaskRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  private selection() {
    return {
      id: officeTasks.id,
      officeAccountId: officeTasks.officeAccountId,
      taskType: officeTasks.taskType,
      title: officeTasks.title,
      instructions: officeTasks.instructions,
      organizationId: officeTasks.organizationId,
      organizationName: organizations.name,
      contactId: officeTasks.contactId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      status: officeTasks.status,
      needsHelp: officeTasks.needsHelp,
      coordinatorNote: officeTasks.coordinatorNote,
      ownerSortOrder: officeTasks.ownerSortOrder,
      dueAt: officeTasks.dueAt,
      createdAt: officeTasks.createdAt,
      updatedAt: officeTasks.updatedAt,
      completedAt: officeTasks.completedAt,
    };
  }

  private async rows(where: ReturnType<typeof and>): Promise<OfficeTaskRow[]> {
    return this.database
      .select(this.selection())
      .from(officeTasks)
      .leftJoin(organizations, eq(organizations.id, officeTasks.organizationId))
      .leftJoin(contacts, eq(contacts.id, officeTasks.contactId))
      .where(where)
      .orderBy(asc(officeTasks.ownerSortOrder), asc(officeTasks.createdAt), asc(officeTasks.id)) as Promise<OfficeTaskRow[]>;
  }

  async listForOffice(accountId: string, view: "active" | "done" = "active"): Promise<OfficeTaskView[]> {
    const condition = view === "done"
      ? and(eq(officeTasks.officeAccountId, accountId), eq(officeTasks.status, "done"))
      : and(eq(officeTasks.officeAccountId, accountId), activeCondition);
    return (await this.rows(condition)).map(toOfficeTaskView);
  }

  async todayForOffice(accountId: string) {
    const tasks = await this.listForOffice(accountId, "active");
    return {
      tasks: tasks.slice(0, 8),
      activeCount: tasks.length,
      needsHelpCount: tasks.filter((task) => task.needsHelp).length,
    };
  }

  async updateForOffice(
    taskId: string,
    accountId: string,
    input: { status?: Exclude<OfficeTaskStatus, "cancelled">; coordinatorNote?: string | null; needsHelp?: boolean },
  ): Promise<OfficeTaskView | null> {
    const [updated] = await this.database
      .update(officeTasks)
      .set(officeTaskUpdateSet(input))
      .where(and(eq(officeTasks.id, taskId), eq(officeTasks.officeAccountId, accountId), sql`${officeTasks.status} <> 'cancelled'`))
      .returning({ id: officeTasks.id });
    if (!updated) return null;
    const rows = await this.rows(and(eq(officeTasks.id, taskId), eq(officeTasks.officeAccountId, accountId)));
    return rows[0] ? toOfficeTaskView(rows[0]) : null;
  }

  async listForOwner(accountId?: string | null) {
    const where = accountId ? eq(officeTasks.officeAccountId, accountId) : undefined;
    return this.database
      .select(this.selection())
      .from(officeTasks)
      .leftJoin(organizations, eq(organizations.id, officeTasks.organizationId))
      .leftJoin(contacts, eq(contacts.id, officeTasks.contactId))
      .where(where)
      .orderBy(asc(officeTasks.officeAccountId), asc(officeTasks.ownerSortOrder), desc(officeTasks.updatedAt));
  }

  async createForOwner(input: {
    officeAccountId: string;
    taskType: OfficeTaskType;
    title: string;
    instructions?: string | null;
    organizationId?: string | null;
    contactId?: string | null;
    dueAt?: Date | null;
  }) {
    const [maximum] = await this.database
      .select({ value: max(officeTasks.ownerSortOrder) })
      .from(officeTasks)
      .where(eq(officeTasks.officeAccountId, input.officeAccountId));
    const ownerSortOrder = Number(maximum?.value ?? 0) + 1000;
    const [created] = await this.database
      .insert(officeTasks)
      .values({
        officeAccountId: input.officeAccountId,
        taskType: input.taskType,
        title: input.title.trim(),
        instructions: input.instructions?.trim() || null,
        organizationId: input.organizationId ?? null,
        contactId: input.contactId ?? null,
        status: "todo",
        ownerSortOrder,
        dueAt: input.dueAt ?? null,
        createdBy: "owner",
      })
      .returning();
    if (!created) throw new Error("Office task could not be created.");
    return created;
  }

  async updateForOwner(taskId: string, input: {
    taskType?: OfficeTaskType;
    title?: string;
    instructions?: string | null;
    organizationId?: string | null;
    contactId?: string | null;
    dueAt?: Date | null;
    status?: OfficeTaskStatus;
    needsHelp?: boolean;
  }) {
    const now = new Date();
    const set: Record<string, unknown> = { updatedAt: now };
    if (input.taskType !== undefined) set.taskType = input.taskType;
    if (input.title !== undefined) set.title = input.title.trim();
    if (input.instructions !== undefined) set.instructions = input.instructions?.trim() || null;
    if (input.organizationId !== undefined) set.organizationId = input.organizationId;
    if (input.contactId !== undefined) set.contactId = input.contactId;
    if (input.dueAt !== undefined) set.dueAt = input.dueAt;
    if (input.needsHelp !== undefined) set.needsHelp = input.needsHelp;
    if (input.status !== undefined) {
      set.status = input.status;
      set.completedAt = input.status === "done" ? now : null;
    }
    const [updated] = await this.database.update(officeTasks).set(set).where(eq(officeTasks.id, taskId)).returning();
    return updated ?? null;
  }

  async deleteForOwner(taskId: string) {
    const [deleted] = await this.database
      .delete(officeTasks)
      .where(eq(officeTasks.id, taskId))
      .returning({ id: officeTasks.id });
    return deleted ?? null;
  }

  async reorderForOwner(accountId: string, taskIds: string[]): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select({ id: officeTasks.id })
        .from(officeTasks)
        .where(and(eq(officeTasks.officeAccountId, accountId), activeCondition))
        .orderBy(asc(officeTasks.ownerSortOrder), asc(officeTasks.id))
        .for("update");
      const currentIds = rows.map((row) => row.id);
      if (currentIds.length !== taskIds.length || new Set(taskIds).size !== taskIds.length || !currentIds.every((id) => taskIds.includes(id))) {
        return false;
      }
      for (const [index, taskId] of taskIds.entries()) {
        await transaction.update(officeTasks).set({ ownerSortOrder: (index + 1) * 1000, updatedAt: new Date() }).where(and(eq(officeTasks.id, taskId), eq(officeTasks.officeAccountId, accountId)));
      }
      return true;
    });
  }
}
