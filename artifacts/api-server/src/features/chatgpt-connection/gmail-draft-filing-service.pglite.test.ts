import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { GmailDraftFilingService, type DraftFilingAccess } from "./gmail-draft-filing-service";
import { connectionTools, type ConnectionServices } from "./tool-registry";
let f: Awaited<ReturnType<typeof fixture>>, service: GmailDraftFilingService, access: DraftFilingAccess;
let account: string, message: string, raw: string, labels: string[];
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
  labels = ["DRAFT"];
  modify.mockReset(); resolve.mockReset();
  // Model Gmail's real contract: a draft cannot accept user labels.
  modify.mockRejectedValue(new Error("INVALID_ARGUMENT"));
  resolve.mockRejectedValue(new Error("Draft filing must not create labels"));
  access = {
    connectionId: account,
    readDraft: async () => ({ draftId: "stable-draft", messageId: message, threadId: "thread", raw }),
    metadata: async id => ({ id, threadId: "thread", labelIds: [...labels],
      headers: { subject: "County Fair", from: "owner@example.test", to: "fair@example.test" } }),
  };
  service = new GmailDraftFilingService(f.db, async () => ({ ...access, connectionId: account, modify, resolve }));
});
afterEach(async () => f.db.close());
function input() { return { draftId: "stable-draft", profileId: f.profileId }; }
async function ready() { return { ...input(), expectedRevision: (await service.preview(f.principal, input())).expectedRevision }; }
it("files the current edited draft only, preserves attention and Inbox, and never records a sent email or follow-up", async () => {
  const a = await ready();
  const result = await service.apply(f.principal, { requestKey: "file" }, a);
  expect(modify).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
  expect(labels).toEqual(["DRAFT"]);
  expect(result.value).toMatchObject({ state: "draft_filed", filingLocation: "app", gmailLabelsChanged: false, sent: false, archived: false, messageId: message });
  expect((await f.db.query("SELECT * FROM google_workspace_validation_mappings")).rows)
    .toMatchObject([{ organization_id: f.profileId, message_id: message }]);
  for (const table of ["activities", "follow_ups", "chatgpt_external_drafts"])
    expect((await f.db.query("SELECT * FROM " + table)).rows).toEqual([]);
});
it("replays a verified receipt without reapplying and rejects a changed request", async () => {
  const a = await ready(), key = { requestKey: "retry" };
  const first = await service.apply(f.principal, key, a);
  expect(await service.apply(f.principal, key, a)).toEqual(first);
  expect(modify).not.toHaveBeenCalled();
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
it("rechecks the draft before saving when Gmail replaces it mid-operation", async () => {
  const a = await ready();
  const original = access.readDraft;
  let reads = 0;
  access.readDraft = async id => {
    if (++reads === 2) message = "new-during-save";
    return original(id);
  };
  await expect(service.apply(f.principal, { requestKey: "mid-edit" }, a))
    .rejects.toMatchObject({ code: "CONNECTION_STALE_REVISION" });
  expect((await f.db.query("SELECT * FROM google_workspace_validation_mappings")).rows).toEqual([]);
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
it("rolls back app association and receipt when the database write fails", async () => {
  const a = await ready();
  await f.db.exec(`CREATE FUNCTION reject_mapping() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'save failed'; END $$;
    CREATE TRIGGER reject_mapping BEFORE INSERT ON google_workspace_validation_mappings FOR EACH ROW EXECUTE FUNCTION reject_mapping();`);
  await expect(service.apply(f.principal, { requestKey: "failed-save" }, a)).rejects.toThrow();
  expect((await f.db.query("SELECT * FROM chatgpt_operations")).rows).toEqual([]);
  expect((await f.db.query("SELECT * FROM google_workspace_validation_mappings")).rows).toEqual([]);
  expect(modify).not.toHaveBeenCalled();
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
  expect(modify).not.toHaveBeenCalled();
  expect(await draftTools[2].call({ gmailConnectionId: account, threadId: "thread" })).toMatchObject({ mappings: [{ profileId: f.profileId }] });
});

it("reconciles the app mapping without requiring forbidden draft labels", async () => {
  const a = await ready();
  await expect(service.verifyCurrent(a)).rejects.toMatchObject({ code: "CONNECTION_DRAFT_FILING_READBACK_FAILED" });
  await service.apply(f.principal, { requestKey: "reconcile-source" }, a);
  expect(await service.verifyCurrent(a)).toMatchObject({ state: "draft_filed", filingLocation: "app", gmailLabelsChanged: false, sent: false });
  expect(labels).toEqual(["DRAFT"]);
  await f.db.query("DELETE FROM google_workspace_validation_mappings");
  await expect(service.verifyCurrent(a)).rejects.toMatchObject({ code: "CONNECTION_DRAFT_FILING_READBACK_FAILED" });
  expect(modify).not.toHaveBeenCalled();
});

it("rejects an existing current-message mapping even when its stored thread ID is wrong", async () => {
  const other = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Other Fair')", [other]);
  await f.db.query("INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id) VALUES($1,$2,'wrong-thread',$3)", [account, message, other]);
  await expect(service.apply(f.principal, { requestKey: "wrong-thread" }, await ready()))
    .rejects.toMatchObject({ code: "EMAIL_ATTENTION_PROFILE_CONFLICT" });
  expect(modify).not.toHaveBeenCalled();
});
