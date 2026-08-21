import { describe, expect, it } from "vitest";
import { OfficeMailService, type OfficeMailTransactionStore } from "./office-mail-service";

const accountId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";
const organizationId = "30000000-0000-4000-8000-000000000001";

function fakeStore(options: { failNote?: boolean } = {}) {
  const state: any = {
    task: { id: taskId, officeAccountId: accountId, taskType: "mail_brochure", status: "todo", organizationId, contactId: null },
    mail: null,
    notes: [],
  };
  const store: OfficeMailTransactionStore = {
    loadTask: async (id, owner) => id === taskId && owner === accountId ? { ...state.task } : null,
    loadMail: async () => state.mail ? { ...state.mail } : null,
    savePrepared: async (input) => state.mail = { id: "mail-1", ...input },
    saveMailed: async (_id, input) => state.mail = { ...state.mail, ...input },
    appendProfileNote: async (input) => {
      if (options.failNote) throw new Error("history failed");
      state.notes.push(input.body);
    },
    updateTask: async (_id, input) => Object.assign(state.task, input),
  };
  return { state, store };
}

function unitOfWork(store: OfficeMailTransactionStore, state: any) {
  return {
    run: async <T>(operation: (store: OfficeMailTransactionStore) => Promise<T>) => {
      const snapshot = structuredClone(state);
      try { return await operation(store); }
      catch (error) { Object.keys(state).forEach((key) => delete state[key]); Object.assign(state, snapshot); throw error; }
    },
  };
}

describe("Office brochure mail service", () => {
  it("records preparation once and moves a todo mail task into progress", async () => {
    const { state, store } = fakeStore();
    const service = new OfficeMailService(unitOfWork(store, state));
    await service.markPrepared({
      accountId, taskId, recipientName: "Fair Office", address1: "1 Main", address2: null,
      city: "Example", region: "ND", postalCode: "58000",
    });
    expect(state.mail.preparedAt).toBeInstanceOf(Date);
    expect(state.task.status).toBe("in_progress");
    expect(state.notes).toHaveLength(1);

    await service.markPrepared({
      accountId, taskId, recipientName: "Fair Office", address1: "1 Main", address2: null,
      city: "Example", region: "ND", postalCode: "58000",
    });
    expect(state.notes).toHaveLength(1);
  });

  it("marks the task done only when the mailed row and profile history both succeed", async () => {
    const { state, store } = fakeStore();
    const service = new OfficeMailService(unitOfWork(store, state));
    await service.markPrepared({ accountId, taskId, recipientName: "Fair Office", address1: "1 Main", address2: null, city: "Example", region: "ND", postalCode: "58000" });
    await service.markMailed({ accountId, taskId, mailedAt: new Date("2026-08-21T18:00:00Z"), note: "Tracking 123" });
    expect(state.mail.mailedAt).toEqual(new Date("2026-08-21T18:00:00Z"));
    expect(state.task.status).toBe("done");
    expect(state.notes.at(-1)).toMatch(/Brochure mailed/);
  });

  it("rolls mail/task changes back when profile history fails", async () => {
    const { state, store } = fakeStore({ failNote: true });
    state.mail = { id: "mail-1", taskId, organizationId, contactId: null, recipientName: "Fair Office", preparedAt: new Date("2026-08-20T18:00:00Z"), mailedAt: null };
    state.task.status = "in_progress";
    const service = new OfficeMailService(unitOfWork(store, state));
    await expect(service.markMailed({ accountId, taskId, mailedAt: new Date("2026-08-21T18:00:00Z"), note: null })).rejects.toThrow("history failed");
    expect(state.mail.mailedAt).toBeNull();
    expect(state.task.status).toBe("in_progress");
  });

  it("rejects another account's task and non-mail tasks", async () => {
    const { state, store } = fakeStore();
    const service = new OfficeMailService(unitOfWork(store, state));
    await expect(service.markPrepared({ accountId: "other", taskId, recipientName: null, address1: null, address2: null, city: null, region: null, postalCode: null })).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    state.task.taskType = "draft_email";
    await expect(service.markPrepared({ accountId, taskId, recipientName: null, address1: null, address2: null, city: null, region: null, postalCode: null })).rejects.toMatchObject({ code: "NOT_MAIL_TASK" });
  });
});
