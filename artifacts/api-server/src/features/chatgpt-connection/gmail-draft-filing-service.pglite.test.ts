import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { GmailDraftFilingService, type DraftFilingAccess } from "./gmail-draft-filing-service";
import { connectionTools, type ConnectionServices } from "./tool-registry";
let f: Awaited<ReturnType<typeof fixture>>, service: GmailDraftFilingService, access: DraftFilingAccess;
let account: string, message: string, raw: string, labels: string[], readbackFails: boolean;
const modify = vi.fn(), resolve = vi.fn();
beforeEach(async () => {
  f = await fixture();
  await f.db.exec(`CREATE TABLE google_workspace_validation_mappings(
    connection_id uuid NOT NULL,message_id text NOT NULL,thread_id text NOT NULL,
    organization_id uuid NOT NULL,contact_id uuid,evidence_codes jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(connection_id,message_id));
    CREATE TABLE google_workspace_profile_labels(connection_id uuid,organization_id uuid,
      gmail_label_id text,gmail_label_name text,state text); `);
  account = randomUUID(); message = "current-after-edit"; raw = "full-current-mime";
  labels = ["DRAFT", "INBOX", "attention", "old-profile"]; readbackFails = false;
  modify.mockReset(); resolve.mockReset();
  modify.mockImplementation(async input => {
    if (!readbackFails) labels = [...new Set([...labels.filter(id => !input.removeLabelIds.includes(id)), ...input.addLabelIds])];
  });
  resolve.mockResolvedValue({ id: "profile-label", name: "Profiles/County Fair" });
  access = {
    connectionId: account,
    readDraft: async () => ({ draftId: "stable-draft", messageId: message, threadId: "thread", raw }),
    metadata: async id => ({ id, threadId: "thread", labelIds: [...labels],
      headers: { subject: "County Fair", from: "owner@example.test", to: "fair@example.test" } }),
    labels: async () => [
      { id: "profile-label", name: "Profiles/County Fair", type: "user" },
      { id: "old-profile", name: "Profiles/Another Fair", type: "user" },
      { id: "attention", name: "Needs Attention", type: "user" },
    ],
    resolve, modify,
  };
  service = new GmailDraftFilingService(f.db, async () => ({ ...access, connectionId: account }));
});
afterEach(async () => f.db.close());
function input() { return { draftId: "stable-draft", profileId: f.profileId }; }
async function ready() { return { ...input(), expectedRevision: (await service.preview(f.principal, input())).expectedRevision }; }
it("files the current edited draft only, preserves attention and Inbox, and never records a sent email or follow-up", async () => {
  const a = await ready();
  const result = await service.apply(f.principal, { requestKey: "file" }, a);
  expect(modify).toHaveBeenCalledExactlyOnceWith({
    messageId: "current-after-edit", addLabelIds: ["profile-label"], removeLabelIds: ["old-profile"],
  });
  expect(labels.sort()).toEqual(["DRAFT", "INBOX", "attention", "profile-label"].sort());
  expect(result.value).toMatchObject({ state: "draft_filed", sent: false, archived: false, messageId: message });
  expect((await f.db.query("SELECT * FROM google_workspace_validation_mappings")).rows)
    .toMatchObject([{ organization_id: f.profileId, message_id: message }]);
  for (const table of ["activities", "follow_ups", "chatgpt_external_drafts"])
    expect((await f.db.query("SELECT * FROM " + table)).rows).toEqual([]);
});
it("replays a verified receipt without reapplying and rejects a changed request", async () => {
  const a = await ready(), key = { requestKey: "retry" };
  const first = await service.apply(f.principal, key, a);
  expect(await service.apply(f.principal, key, a)).toEqual(first);
  expect(modify).toHaveBeenCalledTimes(1);
  await expect(service.apply(f.principal, key, { ...a, draftId: "changed" }))
    .rejects.toMatchObject({ code: "CONNECTION_REQUEST_CONFLICT" });
});
it.each(["message", "raw", "account", "profile"])("rejects changed %s before any Gmail mutation", async change => {
  const a = await ready();
  if (change === "message") message = "newer-message";
  if (change === "raw") raw = "revised-mime";
  if (change === "account") account = randomUUID();
  if (change === "profile") await f.db.query("UPDATE organizations SET updated_at=updated_at+interval '1 second' WHERE id=$1", [f.profileId]);
  await expect(service.apply(f.principal, { requestKey: change }, a)).rejects.toMatchObject({ code: "CONNECTION_STALE_REVISION" });
  expect(modify).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
});
it("rechecks after label resolution if Gmail replaces the draft mid-operation", async () => {
  const a = await ready();
  resolve.mockImplementationOnce(async () => {
    message = "new-during-resolve";
    return { id: "profile-label", name: "Profiles/County Fair" };
  });
  await expect(service.apply(f.principal, { requestKey: "mid-edit" }, a))
    .rejects.toMatchObject({ code: "CONNECTION_STALE_REVISION" });
  expect(modify).not.toHaveBeenCalled();
});
it("rejects sent or non-draft sources", async () => {
  for (const invalid of [["SENT"], ["DRAFT", "SENT"], []]) {
    labels = invalid;
    await expect(service.preview(f.principal, input())).rejects.toMatchObject({ code: "CONNECTION_DRAFT_SOURCE_CHANGED" });
  }
  expect(modify).not.toHaveBeenCalled();
});
it("exposes exact conflicting profile evidence and blocks filing without overwriting it", async () => {
  const other = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Historic Fair')", [other]);
  await f.db.query("INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id) VALUES($1,'historic-message','thread',$2)", [account, other]);
  const preview = await service.preview(f.principal, input());
  expect(preview.conflicts).toMatchObject([{ profileId: other, profileName: "Historic Fair", messageId: "historic-message" }]);
  expect((await service.inspect(f.principal, { gmailConnectionId: account, threadId: "thread" })).mappings).toEqual(preview.conflicts);
  await expect(service.apply(f.principal, { requestKey: "conflict" }, { ...input(), expectedRevision: preview.expectedRevision }))
    .rejects.toMatchObject({ code: "EMAIL_ATTENTION_PROFILE_CONFLICT" });
  expect(modify).not.toHaveBeenCalled();
  expect((await f.db.query<{ organization_id: string }>("SELECT organization_id FROM google_workspace_validation_mappings")).rows[0].organization_id).toBe(other);
  await expect(service.inspect(f.principal, { gmailConnectionId: randomUUID(), threadId: "thread" }))
    .rejects.toMatchObject({ code: "CONNECTION_DRAFT_SOURCE_CHANGED" });
});
it("does not save a success receipt when Gmail readback fails; identical retry can finish", async () => {
  const a = await ready(), key = { requestKey: "readback" };
  readbackFails = true;
  await expect(service.apply(f.principal, key, a)).rejects.toMatchObject({ code: "CONNECTION_DRAFT_FILING_READBACK_FAILED" });
  expect((await f.db.query("SELECT * FROM chatgpt_operations")).rows).toEqual([]);
  expect((await f.db.query("SELECT * FROM google_workspace_validation_mappings")).rows).toEqual([]);
  readbackFails = false;
  expect((await service.apply(f.principal, key, a)).value.state).toBe("draft_filed");
});
it("enforces read/organize scopes and revocation for all new paths", async () => {
  const a = await ready(), denied = { ...f.principal, scopes: [] };
  await expect(service.preview(denied, input())).rejects.toThrow();
  await expect(service.inspect(denied, { gmailConnectionId: account, threadId: "thread" })).rejects.toThrow();
  await expect(service.apply(denied, { requestKey: "scope" }, a)).rejects.toThrow();
  await f.db.query("UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1", [f.principal.connectionId]);
  await expect(service.preview(f.principal, input())).rejects.toMatchObject({ code: "CONNECTION_REVOKED" });
  await expect(service.inspect(f.principal, { gmailConnectionId: account, threadId: "thread" })).rejects.toMatchObject({ code: "CONNECTION_REVOKED" });
  await expect(service.apply(f.principal, { requestKey: "revoked" }, a)).rejects.toMatchObject({ code: "CONNECTION_REVOKED" });
  expect(modify).not.toHaveBeenCalled();
});
it("registers separate draft-only filing and conflict reads with the correct permissions", async () => {
  const tools = connectionTools({ draftFiling: service } as ConnectionServices, f.principal);
  const draftTools = tools.filter(t => ["read_gmail_draft_filing", "file_gmail_draft_to_profile", "read_email_filing_conflicts"].includes(t.name));
  expect(draftTools.map(t => [t.name,t.scope,t.readOnly])).toEqual([
    ["read_gmail_draft_filing", "crm:read", true], ["file_gmail_draft_to_profile", "email:organize", false], ["read_email_filing_conflicts", "crm:read", true],
  ]);
  const preview = await draftTools[0].call(input()) as any;
  await draftTools[1].call({ ...input(), expectedRevision: preview.expectedRevision, requestKey: "tool" });
  expect(modify).toHaveBeenCalledTimes(1);
  expect(await draftTools[2].call({ gmailConnectionId: account, threadId: "thread" })).toMatchObject({ mappings: [{ profileId: f.profileId }] });
});

it("reconciles only when both the app mapping and current Gmail label still prove filing", async () => {
  const a = await ready();
  await service.apply(f.principal, { requestKey: "reconcile-source" }, a);
  await expect(service.verifyCurrent(a)).rejects.toMatchObject({ code: "CONNECTION_DRAFT_FILING_READBACK_FAILED" });
  await f.db.query("INSERT INTO google_workspace_profile_labels VALUES($1,$2,'profile-label','Profiles/County Fair','active')", [account, f.profileId]);
  expect(await service.verifyCurrent(a)).toMatchObject({ state: "draft_filed", messageId: message, sent: false });
  const count = modify.mock.calls.length;
  labels = labels.filter(id => id !== "profile-label");
  await expect(service.verifyCurrent(a)).rejects.toMatchObject({ code: "CONNECTION_DRAFT_FILING_READBACK_FAILED" });
  expect(modify).toHaveBeenCalledTimes(count);
});

it("rejects an existing current-message mapping even when its stored thread ID is wrong", async () => {
  const other = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Other Fair')", [other]);
  await f.db.query("INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id) VALUES($1,$2,'wrong-thread',$3)", [account, message, other]);
  await expect(service.apply(f.principal, { requestKey: "wrong-thread" }, await ready()))
    .rejects.toMatchObject({ code: "EMAIL_ATTENTION_PROFILE_CONFLICT" });
  expect(modify).not.toHaveBeenCalled();
});
