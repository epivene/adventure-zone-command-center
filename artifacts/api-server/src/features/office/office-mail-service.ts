export type OfficeMailTask = {
  id: string;
  officeAccountId: string;
  taskType: string;
  status: string;
  organizationId: string | null;
  contactId: string | null;
};

export type OfficeMailRecord = {
  id: string;
  taskId: string | null;
  organizationId: string;
  contactId: string | null;
  recipientName: string | null;
  preparedAt: Date | null;
  mailedAt: Date | null;
  note?: string | null;
};

export type OfficeMailTransactionStore = {
  loadTask(taskId: string, accountId: string): Promise<OfficeMailTask | null>;
  loadMail(taskId: string): Promise<OfficeMailRecord | null>;
  savePrepared(input: {
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
  }): Promise<OfficeMailRecord>;
  saveMailed(id: string, input: { mailedAt: Date; note: string | null }): Promise<OfficeMailRecord>;
  appendProfileNote(input: { organizationId: string; contactId: string | null; body: string; occurredAt: Date }): Promise<void>;
  updateTask(taskId: string, input: { status: "in_progress" | "done"; completedAt?: Date | null }): Promise<void>;
};

export type OfficeMailUnitOfWork = {
  run<T>(operation: (store: OfficeMailTransactionStore) => Promise<T>): Promise<T>;
};

export class OfficeMailError extends Error {
  constructor(public readonly code: "TASK_NOT_FOUND" | "NOT_MAIL_TASK" | "PROFILE_REQUIRED" | "NOT_PREPARED") {
    super(code);
    this.name = "OfficeMailError";
  }
}

function recipientLabel(name: string | null) {
  return name?.trim() || "the event contact";
}

export class OfficeMailService {
  constructor(private readonly work: OfficeMailUnitOfWork) {}

  async markPrepared(input: {
    accountId: string;
    taskId: string;
    recipientName: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
  }) {
    return this.work.run(async (store) => {
      const task = await store.loadTask(input.taskId, input.accountId);
      if (!task) throw new OfficeMailError("TASK_NOT_FOUND");
      if (task.taskType !== "mail_brochure") throw new OfficeMailError("NOT_MAIL_TASK");
      if (!task.organizationId) throw new OfficeMailError("PROFILE_REQUIRED");

      const existing = await store.loadMail(input.taskId);
      if (existing?.preparedAt) return existing;

      const now = new Date();
      const saved = await store.savePrepared({
        taskId: task.id,
        officeAccountId: task.officeAccountId,
        organizationId: task.organizationId,
        contactId: task.contactId,
        recipientName: input.recipientName?.trim() || null,
        address1: input.address1?.trim() || null,
        address2: input.address2?.trim() || null,
        city: input.city?.trim() || null,
        region: input.region?.trim() || null,
        postalCode: input.postalCode?.trim() || null,
        preparedAt: now,
      });
      await store.appendProfileNote({
        organizationId: task.organizationId,
        contactId: task.contactId,
        body: `Brochure prepared for ${recipientLabel(input.recipientName)}.`,
        occurredAt: now,
      });
      if (task.status === "todo") await store.updateTask(task.id, { status: "in_progress", completedAt: null });
      return saved;
    });
  }

  async markMailed(input: {
    accountId: string;
    taskId: string;
    mailedAt: Date;
    note: string | null;
  }) {
    return this.work.run(async (store) => {
      const task = await store.loadTask(input.taskId, input.accountId);
      if (!task) throw new OfficeMailError("TASK_NOT_FOUND");
      if (task.taskType !== "mail_brochure") throw new OfficeMailError("NOT_MAIL_TASK");
      if (!task.organizationId) throw new OfficeMailError("PROFILE_REQUIRED");

      const existing = await store.loadMail(input.taskId);
      if (!existing?.preparedAt) throw new OfficeMailError("NOT_PREPARED");
      if (existing.mailedAt) return existing;

      const note = input.note?.trim() || null;
      const saved = await store.saveMailed(existing.id, { mailedAt: input.mailedAt, note });
      const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Denver" }).format(input.mailedAt);
      await store.appendProfileNote({
        organizationId: task.organizationId,
        contactId: task.contactId,
        body: `Brochure mailed to ${recipientLabel(existing.recipientName)} on ${date}.${note ? ` ${note}` : ""}`,
        occurredAt: input.mailedAt,
      });
      await store.updateTask(task.id, { status: "done", completedAt: new Date() });
      return saved;
    });
  }
}
