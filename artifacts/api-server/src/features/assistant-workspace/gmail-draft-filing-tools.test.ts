import { beforeEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { emptySelection, type RunContext, type ActionIntent } from "./contracts";
import { createGmailDraftFilingTools, gmailDraftFilingAdapter } from "./gmail-draft-filing-tools";
let c: RunContext, deps: any, tools: ReturnType<typeof createGmailDraftFilingTools>, intent: ActionIntent;
beforeEach(() => {
  const profileId = randomUUID(), connectionId = randomUUID();
  c = { actor: { id: "owner", role: "owner", connectionId }, conversationId: randomUUID(),
    runId: randomUUID(), selection: { ...emptySelection(), organizationIds: [profileId] },
    grants: [], signal: new AbortController().signal };
  const preview = { gmailConnectionId: connectionId, expectedRevision: "a".repeat(64), conflicts: [],
    draftId: "stable-draft", messageId: "current-message", threadId: "thread", profileId };
  const tx = { query: vi.fn().mockResolvedValue({ rows: [] }) };
  deps = { ownerId: "owner",
    db: { transaction: vi.fn(async fn => fn(tx)) },
    google: { getCurrent: vi.fn().mockResolvedValue({ id: connectionId }),
      createReadClient: vi.fn().mockResolvedValue({ listGmailDrafts: vi.fn().mockResolvedValue({
        drafts: [{ id: "stable-draft", message: { id: "current-message", threadId: "thread" } }], nextPageToken: "more",
      }) }) },
    service: { previewCurrent: vi.fn().mockResolvedValue(preview),
      inspectCurrent: vi.fn().mockResolvedValue({ mappings: [{ profileId, profileName: "County Fair" }] }),
      fileCurrent: vi.fn().mockResolvedValue({ value: { state: "draft_filed", sent: false, archived: false } }),
      verifyCurrent: vi.fn().mockResolvedValue({ state: "draft_filed", sent: false, archived: false }) },
    runs: { get: vi.fn().mockResolvedValue({ conversationId: c.conversationId, input: { sourceMessageId: "source" } }) },
    executor: { execute: vi.fn().mockResolvedValue({ status: "blocked", code: "ASSISTANT_APPROVAL_REQUIRED" }) },
  };
  intent = { id: randomUUID(), actorId: "owner", conversationId: c.conversationId, sourceMessageId: "source",
    kind: "file_gmail_draft_to_profile", targetId: profileId, connectionId,
    expectedRevision: "a".repeat(64), arguments: { draftId: "stable-draft", profileId } };
  tools = createGmailDraftFilingTools(deps);
});
function call(name: string, a: any = {}) { return tools.execute(c, { id: "call", name, arguments: JSON.stringify(a) }); }
it("discovers draft-only tools for the owner and exposes partial inventory honestly", async () => {
  expect(tools.definitions(c).map((d: any) => d.name)).toEqual([
    "find_gmail_drafts", "read_gmail_draft_filing", "file_gmail_draft_to_profile", "read_email_filing_conflicts",
  ]);
  const page = await call("find_gmail_drafts", { query: "subject:County Fair" });
  expect(page.data).toMatchObject({ complete: false, nextPageToken: "more" });
  expect(deps.executor.execute).not.toHaveBeenCalled();
  c.actor.id = "other";
  expect(tools.definitions(c)).toEqual([]);
  expect(await call("find_gmail_drafts", { query: "in:drafts" })).toMatchObject({ code: "ASSISTANT_ACCESS_DENIED" });
});
it("checks the selected profile and current account before returning draft evidence", async () => {
  const a = intent.arguments as any;
  expect(await call("read_gmail_draft_filing", a)).toMatchObject({ status: "ok", data: { messageId: "current-message" } });
  c.selection.organizationIds = [];
  expect(await call("read_gmail_draft_filing", a)).toMatchObject({ code: "ASSISTANT_TARGET_NOT_IN_BATCH" });
  c.actor.connectionId = randomUUID();
  expect(await call("read_gmail_draft_filing", a)).toMatchObject({ code: "ASSISTANT_CONNECTION_CHANGED" });
});
it("submits filing through existing ActionExecutor approval instead of mutating directly", async () => {
  const a = { ...(intent.arguments as any), expectedRevision: intent.expectedRevision };
  expect(await call("file_gmail_draft_to_profile", a)).toMatchObject({ code: "ASSISTANT_APPROVAL_REQUIRED" });
  expect(deps.executor.execute).toHaveBeenCalledWith(c, expect.objectContaining({
    targetId: intent.targetId, expectedRevision: intent.expectedRevision, connectionId: intent.connectionId,
    arguments: intent.arguments, sourceMessageId: "source", kind: "file_gmail_draft_to_profile",
  }));
  expect(deps.service.fileCurrent).not.toHaveBeenCalled();
  deps.runs.get.mockResolvedValue({ conversationId: randomUUID() });
  expect(await call("file_gmail_draft_to_profile", a)).toMatchObject({ code: "ASSISTANT_RUN_NOT_FOUND" });
});
it("exposes conflict mappings without a write and rejects another account", async () => {
  expect(await call("read_email_filing_conflicts", { gmailConnectionId: intent.connectionId, threadId: "thread" }))
    .toMatchObject({ status: "ok", data: { mappings: [{ profileName: "County Fair" }] } });
  expect(await call("read_email_filing_conflicts", { gmailConnectionId: randomUUID(), threadId: "thread" }))
    .toMatchObject({ code: "ASSISTANT_CONNECTION_CHANGED" });
  expect(deps.service.fileCurrent).not.toHaveBeenCalled();
});
it("revalidates adapter source/account/profile and uses a transaction for draft-only filing", async () => {
  const adapter = gmailDraftFilingAdapter(deps);
  const output = await adapter.apply(c, intent);
  expect(output).toMatchObject({ status: "ok", data: { sent: false, archived: false },
    receipts: [{ kind: "gmail_draft_filing", id: "stable-draft" }] });
  expect(deps.service.previewCurrent).toHaveBeenCalledWith(intent.arguments);
  expect(deps.db.transaction).toHaveBeenCalledTimes(1);
  expect(deps.service.fileCurrent).toHaveBeenCalledWith(expect.anything(), { ...(intent.arguments as any), expectedRevision: intent.expectedRevision });
  c.selection.organizationIds = [];
  await expect(adapter.apply(c, intent)).rejects.toThrow("ASSISTANT_TARGET_NOT_IN_BATCH");
  expect(deps.service.fileCurrent).toHaveBeenCalledTimes(1);
});
it.each(["revision", "conflict", "account"])("rejects changed %s before adapter apply", async change => {
  if (change === "revision") deps.service.previewCurrent.mockResolvedValue({ expectedRevision: "b".repeat(64), gmailConnectionId: intent.connectionId, conflicts: [] });
  if (change === "conflict") deps.service.previewCurrent.mockResolvedValue({ expectedRevision: intent.expectedRevision, gmailConnectionId: intent.connectionId, conflicts: [{ profileId: randomUUID() }] });
  if (change === "account") deps.google.getCurrent.mockResolvedValue({ id: randomUUID() });
  await expect(gmailDraftFilingAdapter(deps).apply(c, intent)).rejects.toThrow();
  expect(deps.service.fileCurrent).not.toHaveBeenCalled();
});
it("reconciles with readback only and never reapplies uncertain filing", async () => {
  const output = await gmailDraftFilingAdapter(deps).reconcile!(c, intent);
  expect(output).toMatchObject({ status: "ok", receipts: [{ id: "stable-draft" }] });
  expect(deps.service.verifyCurrent).toHaveBeenCalledTimes(1);
  expect(deps.service.fileCurrent).not.toHaveBeenCalled();
  deps.service.verifyCurrent.mockRejectedValue(new Error("CONNECTION_DRAFT_FILING_READBACK_FAILED"));
  await expect(gmailDraftFilingAdapter(deps).reconcile!(c, intent)).rejects.toThrow("CONNECTION_DRAFT_FILING_READBACK_FAILED");
});
it("does not accept bad arguments or cancelled work", async () => {
  expect(await call("file_gmail_draft_to_profile", { draftId: "stable-draft" })).toMatchObject({ code: "ASSISTANT_ARGUMENTS_INVALID" });
  c.signal = AbortSignal.abort();
  expect(await call("find_gmail_drafts", { query: "in:drafts" })).toMatchObject({ code: "ASSISTANT_ACCESS_DENIED" });
});
