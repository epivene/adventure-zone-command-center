import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { ProfileMergeService } from "./profile-merge-service";
import { ProfileUpdateService } from "./profile-update-service";
import type { SqlQuery } from "./contracts";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";

let f: Awaited<ReturnType<typeof fixture>>,
  service: ProfileMergeService,
  duplicateId: string;
const sources = [
  {
    url: "https://fair.example/about",
    retrievedAt: "2026-10-01T16:00:00Z",
    eventYear: 2027,
    claim: "Same event and venue",
    verification: "verified" as const,
  },
];
// The legacy merge executor is tested in the organization merge suites. Here a
// real SQL executor isolates the connector's approval, snapshot and transaction boundary.
async function coreMerge(tx: SqlQuery, primaryId: string, ids: string[]) {
  for (const table of ["activities", "contacts", "bookings", "follow_ups"])
    await tx.query(
      `UPDATE ${table} SET organization_id=$1 WHERE organization_id=ANY($2::uuid[])`,
      [primaryId, ids],
    );
  await tx.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [ids]);
}
beforeEach(async () => {
  f = await fixture();
  duplicateId = randomUUID();
  await f.db.query(
    "INSERT INTO organizations(id,name,city,region,phone) VALUES($1,'County Fair old','Town','UT','801-555-0100')",
    [duplicateId],
  );
  await f.db.query(
    "INSERT INTO activities(organization_id,kind,subject,body,timeline_sort_at) VALUES($1,'note','Original history','Keep my wording',now())",
    [duplicateId],
  );
  service = new ProfileMergeService(f.db, coreMerge);
});
afterEach(async () => f.db.close());
const preview = () =>
  service.preview(
    f.principal,
    { requestKey: "preview" },
    {
      primaryId: f.profileId,
      duplicateIds: [duplicateId],
      reason: "Verified duplicate event",
      sources,
    },
  );
it("applies an owner-approved merge with mail history and retired backup jobs", async () => {
  await ensureEmailThreadAttentionSchema(f.db);
  await f.db.exec(`
    CREATE TABLE google_workspace_historical_gmail_outcomes(
      connection_id uuid,message_id text,organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
      outcome text,PRIMARY KEY(connection_id,message_id));
    CREATE TABLE google_drive_backup_jobs(
      id uuid PRIMARY KEY,entity_kind text,entity_id uuid,status text,
      UNIQUE(entity_kind,entity_id));
  `);
  const attentionId = randomUUID(), revision = randomUUID(), backupId = randomUUID();
  await f.db.query(`INSERT INTO email_thread_attention(id,gmail_connection_id,thread_id,profile_id,state,reason,subject,reviewed_message_id,revision,actor_id)
    VALUES($1,$2,'thread',$3,'needs_your_reply','Incoming reply','Fair contract','message',$4,'owner')`,
    [attentionId,f.principal.connectionId,duplicateId,revision]);
  await f.db.query("INSERT INTO google_workspace_historical_gmail_outcomes VALUES($1,'message',$2,'attached')",[f.principal.connectionId,duplicateId]);
  await f.db.query("INSERT INTO google_drive_backup_jobs VALUES($1,'profile_summary',$2,'queued')",[backupId,duplicateId]);
  const p = await preview();
  expect(p.value.blockers).toEqual([]);
  // Preview alone must not mutate any profile links.
  expect((await f.db.query("SELECT profile_id FROM email_thread_attention")).rows).toEqual([{profile_id:duplicateId}]);
  const approval = await service.approve('owner',p.recordId,p.value.contentHash,true);
  const input = {proposalId:p.recordId,approvalId:approval.approvalId};
  const result = await service.apply(f.principal,{requestKey:'mail-merge'},input);
  expect(result.value.mergedProfileIds).toEqual([duplicateId]);
  const attention = (await f.db.query("SELECT profile_id,revision,state FROM email_thread_attention")).rows[0];
  expect(attention.profile_id).toBe(f.profileId);
  expect(attention.revision).not.toBe(revision);
  expect(attention.state).toBe('needs_your_reply');
  expect((await f.db.query("SELECT organization_id,outcome FROM google_workspace_historical_gmail_outcomes")).rows).toEqual([{organization_id:f.profileId,outcome:'attached'}]);
  expect((await f.db.query("SELECT entity_id,status FROM google_drive_backup_jobs")).rows).toEqual([{entity_id:duplicateId,status:'queued'}]);
  expect((await service.apply(f.principal,{requestKey:'mail-merge'},input)).operationId).toBe(result.operationId);
});
async function approved() {
  const p = await preview();
  const a = await service.approve(
    "owner",
    p.recordId,
    p.value.contentHash,
    true,
  );
  return { proposalId: p.recordId, approvalId: a.approvalId };
}
it("previews actual profiles, field conflicts and linked notes without merging", async () => {
  const p = await preview();
  expect(p.value.kind).toBe("profile_merge");
  expect(p.value.primary.id).toBe(f.profileId);
  expect(p.value.duplicates[0].id).toBe(duplicateId);
  expect(p.value.conflicts).toContainEqual({
    field: "phone",
    primaryValue: null,
    duplicateId,
    duplicateValue: "801-555-0100",
  });
  expect(p.value.references.find((r) => r.table === "activities")?.count).toBe(
    1,
  );
  expect((await f.db.query("SELECT id FROM organizations")).rows).toHaveLength(
    2,
  );
  await expect(
    service.approve("owner", p.recordId, p.value.contentHash, false),
  ).rejects.toMatchObject({ code: "CONNECTION_MERGE_CONFIRMATION_REQUIRED" });
});
it("requires owner approval and keeps connector links, source fields, note history and a retry receipt", async () => {
  await f.db.query(
    "INSERT INTO chatgpt_lead_identities(identity_hash,profile_id) VALUES('source',$1)",
    [duplicateId],
  );
  const draftId = randomUUID();
  await f.db.query(
    "INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision) VALUES($1,'owner',$2,$3,$4)",
    [
      draftId,
      f.principal.connectionId,
      JSON.stringify({
        organizationId: duplicateId,
        text: "Preserve owner edits",
      }),
      randomUUID(),
    ],
  );
  const input = await approved();
  await expect(
    service.apply(
      f.principal,
      { requestKey: "forged" },
      { ...input, approvalId: randomUUID() },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_APPROVAL_REQUIRED" });
  const r = await service.apply(f.principal, { requestKey: "apply" }, input);
  expect(r.value.primaryId).toBe(f.profileId);
  expect((await f.db.query("SELECT * FROM organizations")).rows).toHaveLength(
    1,
  );
  expect(
    (
      await f.db.query(
        "SELECT organization_id,body FROM activities WHERE subject='Original history'",
      )
    ).rows[0],
  ).toEqual({ organization_id: f.profileId, body: "Keep my wording" });
  expect(
    (
      await f.db.query<{ profile_id: string }>(
        "SELECT profile_id FROM chatgpt_lead_identities",
      )
    ).rows[0].profile_id,
  ).toBe(f.profileId);
  expect(
    (
      await f.db.query<{ content: { organizationId: string; text: string } }>(
        "SELECT content FROM chatgpt_external_drafts WHERE id=$1",
        [draftId],
      )
    ).rows[0].content,
  ).toEqual({ organizationId: f.profileId, text: "Preserve owner edits" });
  const audit = (
    await f.db.query<{ body: string }>(
      "SELECT body FROM activities WHERE subject='Duplicate profiles merged'",
    )
  ).rows[0].body;
  expect(audit).toContain("801-555-0100");
  expect(audit).toContain(duplicateId);
  expect(
    await service.apply(f.principal, { requestKey: "apply" }, input),
  ).toEqual(r);
  await expect(
    service.apply(f.principal, { requestKey: "again" }, input),
  ).rejects.toMatchObject({ code: "CONNECTION_APPROVAL_REQUIRED" });
});
it.each(["profile", "note", "new booking", "draft"])(
  "rejects changed %s after approval",
  async (kind) => {
    const input = await approved();
    if (kind === "profile")
      await f.db.query(
        "UPDATE organizations SET website='https://changed.example' WHERE id=$1",
        [duplicateId],
      );
    if (kind === "note")
      await f.db.query("UPDATE activities SET body='New owner correction'");
    if (kind === "new booking")
      await f.db.query(
        "INSERT INTO bookings(organization_id,name,status) VALUES($1,'New booking','confirmed')",
        [duplicateId],
      );
    if (kind === "draft")
      await f.db.query(
        "INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision) VALUES($1,'owner',$2,$3,$4)",
        [
          randomUUID(),
          f.principal.connectionId,
          JSON.stringify({ organizationId: duplicateId, text: "new" }),
          randomUUID(),
        ],
      );
    await expect(
      service.apply(f.principal, { requestKey: "apply" }, input),
    ).rejects.toMatchObject({ code: "CONNECTION_STALE_MERGE" });
    expect(
      (await f.db.query("SELECT id FROM organizations")).rows,
    ).toHaveLength(2);
  },
);
it("blocks different locations and retired or missing profiles", async () => {
  await f.db.query("UPDATE organizations SET city='Other city' WHERE id=$1", [
    duplicateId,
  ]);
  const p = await preview();
  expect(p.value.blockers.length).toBeGreaterThan(0);
  await expect(
    service.approve("owner", p.recordId, p.value.contentHash, true),
  ).rejects.toMatchObject({ code: "CONNECTION_MERGE_BLOCKED" });
  await f.db.query(
    "UPDATE organizations SET consolidated_into_id=$1 WHERE id=$2",
    [f.profileId, duplicateId],
  );
  await expect(
    service.preview(
      f.principal,
      { requestKey: "retired" },
      {
        primaryId: f.profileId,
        duplicateIds: [duplicateId],
        reason: "Duplicate",
        sources,
      },
    ),
  ).rejects.toThrow();
});
it.each(["expired", "tampered", "revoked", "wrong owner", "scope"])(
  "rejects %s authorization",
  async (kind) => {
    const p = await preview();
    if (kind === "wrong owner") {
      await expect(
        service.approve("other", p.recordId, p.value.contentHash, true),
      ).rejects.toThrow();
      return;
    }
    const a = await service.approve(
      "owner",
      p.recordId,
      p.value.contentHash,
      true,
    );
    if (kind === "expired")
      await f.db.query(
        "UPDATE chatgpt_update_proposals SET approval_expires_at=now()-interval '1 second'",
      );
    if (kind === "tampered")
      await f.db.query(
        "UPDATE chatgpt_update_proposals SET content=jsonb_set(content,'{reason}','\"changed\"')",
      );
    if (kind === "revoked")
      await f.db.query("UPDATE chatgpt_connections SET revoked_at=now()");
    const principal =
      kind === "scope"
        ? { ...f.principal, scopes: ["crm:read" as const] }
        : f.principal;
    await expect(
      service.apply(
        principal,
        { requestKey: "apply" },
        { proposalId: p.recordId, approvalId: a.approvalId },
      ),
    ).rejects.toThrow();
    expect(
      (await f.db.query("SELECT id FROM organizations")).rows,
    ).toHaveLength(2);
  },
);
it("rolls back the entire merge on executor failure and permits a safe retry", async () => {
  const input = await approved();
  const failing = new ProfileMergeService(f.db, async (tx, primary, ids) => {
    await coreMerge(tx, primary, ids);
    throw Error("constraint failure");
  });
  await expect(
    failing.apply(f.principal, { requestKey: "apply" }, input),
  ).rejects.toThrow("constraint failure");
  expect(
    (
      await f.db.query<{ organization_id: string }>(
        "SELECT organization_id FROM activities",
      )
    ).rows[0].organization_id,
  ).toBe(duplicateId);
  expect((await f.db.query("SELECT id FROM organizations")).rows).toHaveLength(
    2,
  );
  await service.apply(f.principal, { requestKey: "apply" }, input);
  expect((await f.db.query("SELECT id FROM organizations")).rows).toHaveLength(
    1,
  );
});
it("does not allow a merge proposal through the field-update approval route", async () => {
  const p = await preview();
  await expect(
    new ProfileUpdateService(f.db).approve(
      "owner",
      p.recordId,
      p.value.contentHash,
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_WRONG_PROPOSAL_TYPE" });
});
it("preserves signed agreement and invoice links without altering their terms", async () => {
  await f.db.exec(
    "CREATE TABLE contract_agreements(id uuid primary key,organization_id uuid REFERENCES organizations(id),terms text); CREATE TABLE invoices(id uuid primary key,organization_id uuid REFERENCES organizations(id),amount integer)",
  );
  await f.db.query(
    "INSERT INTO contract_agreements VALUES($1,$2,'Signed original terms')",
    [randomUUID(), duplicateId],
  );
  await f.db.query("INSERT INTO invoices VALUES($1,$2,9000)", [
    randomUUID(),
    duplicateId,
  ]);
  const input = await approved();
  await service.apply(f.principal, { requestKey: "merge" }, input);
  expect(
    (await f.db.query("SELECT organization_id,terms FROM contract_agreements"))
      .rows[0],
  ).toEqual({ organization_id: f.profileId, terms: "Signed original terms" });
  expect(
    (await f.db.query("SELECT organization_id,amount FROM invoices")).rows[0],
  ).toEqual({ organization_id: f.profileId, amount: 9000 });
});
it("blocks an unknown cascading reference instead of deleting its records", async () => {
  await f.db.exec(
    "CREATE TABLE future_records(id uuid primary key,unusual_profile_link uuid REFERENCES organizations(id) ON DELETE CASCADE)",
  );
  await f.db.query("INSERT INTO future_records VALUES($1,$2)", [
    randomUUID(),
    duplicateId,
  ]);
  const p = await preview();
  expect(p.value.blockers.join(" ")).toContain("future_records");
  await expect(
    service.approve("owner", p.recordId, p.value.contentHash, true),
  ).rejects.toMatchObject({ code: "CONNECTION_MERGE_BLOCKED" });
  expect((await f.db.query("SELECT * FROM future_records")).rows).toHaveLength(
    1,
  );
});
it("normalizes UUID case and rejects the survivor repeated as a duplicate", async () => {
  await expect(
    service.preview(
      f.principal,
      { requestKey: "self" },
      {
        primaryId: f.profileId.toUpperCase(),
        duplicateIds: [f.profileId],
        reason: "Duplicate",
        sources,
      },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_INVALID_MERGE" });
  const p = await service.preview(
    f.principal,
    { requestKey: "upper" },
    {
      primaryId: f.profileId.toUpperCase(),
      duplicateIds: [duplicateId.toUpperCase()],
      reason: "Duplicate",
      sources,
    },
  );
  expect(p.value.primary.id).toBe(f.profileId);
});
it("blocks in-app assistant drafts that require their own send-review reconciliation", async () => {
  await f.db.exec(
    "CREATE TABLE assistant_workspace_drafts(id uuid,content jsonb)",
  );
  await f.db.query("INSERT INTO assistant_workspace_drafts VALUES($1,$2)", [
    randomUUID(),
    JSON.stringify({
      organizationId: duplicateId,
      text: "Do not lose this draft",
    }),
  ]);
  const p = await preview();
  expect(p.value.blockers.join(" ")).toContain("assistant_workspace_drafts");
});

it('blocks same-year active work and preserves both activities',async()=>{
 const {ensureBookingWorkSchema}=await import('../../db/booking-work-schema');await ensureBookingWorkSchema(f.db);
 for(const id of [f.profileId,duplicateId])await f.db.query("INSERT INTO booking_work_activities(profile_id,event_year,queue,title,next_action) VALUES($1,2027,'replies','Reply','Read')",[id]);
 const p=await preview();expect(p.value.blockers.join(' ')).toContain('active booking work');
 await expect(service.approve('owner',p.recordId,p.value.contentHash,true)).rejects.toThrow();
 expect((await f.db.query('SELECT * FROM booking_work_activities')).rows).toHaveLength(2);
});
it('moves completed work and distinct-year work while invalidating changed previews',async()=>{
 const {ensureBookingWorkSchema}=await import('../../db/booking-work-schema');await ensureBookingWorkSchema(f.db);
 await f.db.query("INSERT INTO booking_work_activities(profile_id,event_year,queue,title,next_action,status) VALUES($1,2027,'replies','Done','Done','completed'),($1,2028,'replies','Next','Read','queued')",[duplicateId]);
 const p=await preview();await f.db.query('UPDATE booking_work_activities SET revision=revision+1');
 await expect(service.approve('owner',p.recordId,p.value.contentHash,true)).rejects.toMatchObject({code:'CONNECTION_STALE_MERGE'});
 const p2=await service.preview(f.principal,{requestKey:'new-preview'},{primaryId:f.profileId,duplicateIds:[duplicateId],reason:'Verified same event',sources});
 const a=await service.approve('owner',p2.recordId,p2.value.contentHash,true);
 await service.apply(f.principal,{requestKey:'merge'},{proposalId:p2.recordId,approvalId:a.approvalId});
 expect((await f.db.query('SELECT profile_id FROM booking_work_activities')).rows.every(r=>r.profile_id===f.profileId)).toBe(true);
});

async function chatInput() {
  const p = await preview();
  return {
    proposalId: p.recordId,
    expectedContentHash: p.value.contentHash,
    primaryId: f.profileId,
    duplicateIds: [duplicateId],
    authorization: {
      source: "current_owner_message" as const,
      instruction:
        "Merge these exact County Fair profiles, keeping the richer profile and all history.",
      confirmedSameEvent: true as const,
    },
  };
}
it("applies exact chat authorization, preserves contacts/history and records a retry-safe receipt", async () => {
  await f.db.query(
    "INSERT INTO contacts(organization_id,first_name,email) VALUES($1,'Original','contact@example.com')",
    [duplicateId],
  );
  const input = await chatInput();
  const result = await service.applyChatAuthorized(
    f.principal,
    { requestKey: "chat" },
    input,
  );
  expect(result.value.authorization).toMatchObject(input.authorization);
  expect(
    (await f.db.query("SELECT organization_id,email FROM contacts")).rows,
  ).toEqual([{ organization_id: f.profileId, email: "contact@example.com" }]);
  expect(
    (
      await f.db.query<{body:string}>(
        "SELECT body FROM activities WHERE subject='Original history'",
      )
    ).rows[0].body,
  ).toBe("Keep my wording");
  expect(
    (
      await f.db.query<{body:string}>(
        "SELECT body FROM activities WHERE subject='Duplicate profiles merged'",
      )
    ).rows[0].body,
  ).toContain(input.authorization.instruction);
  expect(
    await service.applyChatAuthorized(
      f.principal,
      { requestKey: "chat" },
      input,
    ),
  ).toEqual(result);
  await expect(
    service.applyChatAuthorized(f.principal, { requestKey: "again" }, input),
  ).rejects.toThrow();
});
it.each([
  "missing instruction",
  "background",
  "unconfirmed",
  "wrong pair",
  "wrong hash",
  "stale",
  "expired",
  "scope",
  "wrong connection",
  "revoked",
  "blocker",
])("rejects chat merge: %s", async (kind) => {
  const input: any = await chatInput();
  let principal = f.principal;
  if (kind === "missing instruction") input.authorization.instruction = "";
  if (kind === "background") input.authorization.source = "background_audit";
  if (kind === "unconfirmed") input.authorization.confirmedSameEvent = false;
  if (kind === "wrong pair") input.duplicateIds = [randomUUID()];
  if (kind === "wrong hash") input.expectedContentHash = "0".repeat(64);
  if (kind === "stale")
    await f.db.query("UPDATE activities SET body='Owner correction'");
  if (kind === "expired")
    await f.db.query(
      "UPDATE chatgpt_update_proposals SET created_at=now()-interval '16 minutes'",
    );
  if (kind === "scope") principal = { ...f.principal, scopes: ["crm:read"] };
  if (kind === "wrong connection")
    principal = { ...f.principal, connectionId: randomUUID() };
  if (kind === "revoked")
    await f.db.query("UPDATE chatgpt_connections SET revoked_at=now()");
  if (kind === "blocker")
    await f.db.exec(
      "CREATE TABLE unexpected_child(id uuid,profile_id uuid REFERENCES organizations(id) ON DELETE CASCADE)",
    );
  if (kind === "blocker")
    await f.db.query("INSERT INTO unexpected_child VALUES($1,$2)", [
      randomUUID(),
      duplicateId,
    ]);
  await expect(
    service.applyChatAuthorized(principal, { requestKey: "chat" }, input),
  ).rejects.toThrow();
  expect((await f.db.query("SELECT id FROM organizations")).rows).toHaveLength(
    2,
  );
});
it("rolls back chat authorization and data on merge failure", async () => {
  const input = await chatInput();
  const failing = new ProfileMergeService(f.db, async (tx, primary, ids) => {
    await coreMerge(tx, primary, ids);
    throw Error("failure");
  });
  await expect(
    failing.applyChatAuthorized(f.principal, { requestKey: "chat" }, input),
  ).rejects.toThrow("failure");
  expect((await f.db.query("SELECT id FROM organizations")).rows).toHaveLength(
    2,
  );
  expect(
    (await f.db.query<{consumed_at:string|null}>("SELECT consumed_at FROM chatgpt_update_proposals"))
      .rows[0].consumed_at,
  ).toBeNull();
  await service.applyChatAuthorized(f.principal, { requestKey: "chat" }, input);
});
