import { afterEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";
import { EmailThreadAttentionRepository } from "../google-workspace/email-thread-attention-repository";
import { mergeSnapshot } from "./profile-merge-snapshot";
import { moveExtraMergeReferences } from "./profile-merge-references";

// The snapshot only uses this module's lock key. Avoid loading the unrelated
// application DB pool/schema; all catalog queries and mutations below are real SQL.
vi.mock("../organizations/organization-family-lock", () => ({
  organizationFamilyReviewAdvisoryLockKey: 734_802_341,
}));

let db: PGlite;
afterEach(async () => {
  await db?.close();
});

async function setup() {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE organizations(id uuid PRIMARY KEY,name text,city text,region text,consolidated_into_id uuid);
    CREATE TABLE chatgpt_external_drafts(content jsonb);
    CREATE TABLE google_workspace_historical_gmail_outcomes(
      connection_id uuid NOT NULL,batch_id uuid NOT NULL,message_id text NOT NULL,
      thread_id text NOT NULL,outcome text NOT NULL,
      organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
      error_code text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
      PRIMARY KEY(connection_id,message_id));
    CREATE TABLE google_drive_backup_jobs(
      id uuid PRIMARY KEY,entity_kind text NOT NULL,entity_id uuid NOT NULL,
      status text NOT NULL,request_generation bigint NOT NULL,run_id uuid,
      UNIQUE(entity_kind,entity_id));
    CREATE TABLE google_drive_backup_mappings(
      id uuid PRIMARY KEY,entity_kind text NOT NULL,entity_id uuid NOT NULL,
      drive_file_id text NOT NULL UNIQUE,source_removed_at timestamptz,
      UNIQUE(entity_kind,entity_id));
  `);
  await ensureEmailThreadAttentionSchema(db);
  const primary = randomUUID(),
    duplicate = randomUUID(),
    account = randomUUID();
  await db.query(
    "INSERT INTO organizations(id,name,city,region) VALUES($1,'County Fair','Town','WY'),($2,'County Fair old','Town','WY')",
    [primary, duplicate],
  );
  const attention = randomUUID(),
    revision = randomUUID();
  await db.query(
    `INSERT INTO email_thread_attention(id,gmail_connection_id,thread_id,profile_id,event_year,state,reason,subject,due_at,followup_id,reviewed_message_id,revision,actor_id)
    VALUES($1,$2,'thread-old',$3,2027,'waiting_for_their_reply','Awaiting reply','Contract', '2026-11-01',NULL,'message-old',$4,'owner')`,
    [attention, account, duplicate, revision],
  );
  await db.query(
    "INSERT INTO email_thread_attention_audit(id,attention_id,actor_id,after_value) VALUES($1,$2,'owner',$3)",
    [randomUUID(), attention, JSON.stringify({ profileId: duplicate })],
  );
  await db.query(
    "INSERT INTO google_workspace_historical_gmail_outcomes(connection_id,batch_id,message_id,thread_id,outcome,organization_id) VALUES($1,$2,'message-old','thread-old','attached',$3)",
    [account, randomUUID(), duplicate],
  );
  for (const profile of [primary, duplicate]) {
    for (const kind of ["profile_summary", "follow_up_summary"]) {
      await db.query(
        "INSERT INTO google_drive_backup_jobs VALUES($1,$2,$3,'queued',4,$4)",
        [randomUUID(), kind, profile, randomUUID()],
      );
      await db.query(
        "INSERT INTO google_drive_backup_mappings(id,entity_kind,entity_id,drive_file_id) VALUES($1,$2,$3,$4)",
        [randomUUID(), kind, profile, randomUUID()],
      );
    }
  }
  return { primary, duplicate, account, revision, attention };
}

it("previews and preserves mail relationships while retaining backup source identities", async () => {
  const { primary, duplicate, account, revision } = await setup();
  const snapshot = await mergeSnapshot(db, primary, [duplicate]);
  expect(snapshot.blockers).toEqual([]);
  const before = (await db.query("SELECT * FROM email_thread_attention"))
    .rows[0];
  const audit = (await db.query("SELECT * FROM email_thread_attention_audit"))
    .rows;
  const history = (
    await db.query("SELECT * FROM google_workspace_historical_gmail_outcomes")
  ).rows[0];
  const backups = await db.query(
    "SELECT * FROM google_drive_backup_jobs ORDER BY id",
  );
  const mappings = await db.query(
    "SELECT * FROM google_drive_backup_mappings ORDER BY id",
  );
  await db.transaction(async (tx) => {
    await moveExtraMergeReferences(
      tx,
      primary,
      [duplicate],
      snapshot.references.map((r) => r.table),
    );
    await tx.query("DELETE FROM organizations WHERE id=$1", [duplicate]);
  });
  const after = (await db.query("SELECT * FROM email_thread_attention"))
    .rows[0];
  expect(after.profile_id).toBe(primary);
  expect(after.revision).not.toBe(revision);
  expect({
    ...after,
    profile_id: before.profile_id,
    revision: before.revision,
    updated_at: before.updated_at,
  }).toEqual(before);
  expect(
    (await db.query("SELECT * FROM email_thread_attention_audit")).rows,
  ).toEqual(audit);
  expect(
    (await db.query("SELECT * FROM google_workspace_historical_gmail_outcomes"))
      .rows,
  ).toEqual([{ ...history, organization_id: primary }]);
  expect(
    (await db.query("SELECT * FROM google_drive_backup_jobs ORDER BY id")).rows,
  ).toEqual(backups.rows);
  expect(
    (await db.query("SELECT * FROM google_drive_backup_mappings ORDER BY id"))
      .rows,
  ).toEqual(mappings.rows);
  // An attention preview made before the merge cannot restore the removed ID.
  await expect(
    new EmailThreadAttentionRepository(db).commit(
      db,
      {
        gmailConnectionId: account,
        threadId: "thread-old",
        profileId: duplicate,
        expectedRevision: revision,
        eventYear: 2027,
        state: "resolved",
        reason: "Reviewed",
        subject: "Contract",
        dueAt: null,
        followupId: null,
        latestMessageId: "message-old",
      } as any,
      "owner",
    ),
  ).rejects.toThrow("EMAIL_ATTENTION_STALE");
});

it("includes supported mail and backup records in approval fingerprints", async () => {
  const { primary, duplicate } = await setup();
  let previous = await mergeSnapshot(db, primary, [duplicate]);
  for (const statement of [
    "UPDATE email_thread_attention SET reason='Changed after preview'",
    "UPDATE google_workspace_historical_gmail_outcomes SET outcome='needs_review'",
    "UPDATE google_drive_backup_jobs SET request_generation=request_generation+1",
    "UPDATE google_drive_backup_mappings SET source_removed_at=now()",
  ]) {
    await db.exec(statement);
    const current = await mergeSnapshot(db, primary, [duplicate]);
    expect(current.fingerprint).not.toBe(previous.fingerprint);
    previous = current;
  }
});

it("rolls mail reparenting back with the surrounding merge", async () => {
  const { primary, duplicate } = await setup();
  const snapshot = await mergeSnapshot(db, primary, [duplicate]);
  const attention = (await db.query("SELECT * FROM email_thread_attention"))
    .rows;
  const history = (
    await db.query("SELECT * FROM google_workspace_historical_gmail_outcomes")
  ).rows;
  await expect(
    db.transaction(async (tx) => {
      await moveExtraMergeReferences(
        tx,
        primary,
        [duplicate],
        snapshot.references.map((r) => r.table),
      );
      throw new Error("later merge failure");
    }),
  ).rejects.toThrow("later merge failure");
  expect((await db.query("SELECT * FROM email_thread_attention")).rows).toEqual(
    attention,
  );
  expect(
    (await db.query("SELECT * FROM google_workspace_historical_gmail_outcomes"))
      .rows,
  ).toEqual(history);
});

it("continues to block unknown profile references", async () => {
  const { primary, duplicate } = await setup();
  await db.exec(
    "CREATE TABLE future_profile_records(id uuid,profile_id uuid REFERENCES organizations(id) ON DELETE CASCADE)",
  );
  await db.query("INSERT INTO future_profile_records VALUES($1,$2)", [
    randomUUID(),
    duplicate,
  ]);
  const snapshot = await mergeSnapshot(db, primary, [duplicate]);
  expect(
    snapshot.blockers.some((b) => b.includes("future_profile_records")),
  ).toBe(true);
});

it("does not exempt a new live profile link added to a retained backup table", async () => {
  const { primary, duplicate } = await setup();
  await db.exec(
    "ALTER TABLE google_drive_backup_jobs ADD COLUMN organization_id uuid REFERENCES organizations(id)",
  );
  await db.query(
    "UPDATE google_drive_backup_jobs SET organization_id=$1 WHERE entity_id=$1",
    [duplicate],
  );
  const snapshot = await mergeSnapshot(db, primary, [duplicate]);
  expect(
    snapshot.blockers.some((b) => b.includes("google_drive_backup_jobs")),
  ).toBe(true);
});

it("preserves the survivor's existing attention revision and history association", async () => {
  const { primary, duplicate } = await setup();
  const attention = randomUUID(),
    revision = randomUUID();
  await db.query(
    `INSERT INTO email_thread_attention(id,gmail_connection_id,thread_id,profile_id,state,reason,subject,reviewed_message_id,revision,actor_id)
    SELECT $1,gmail_connection_id,'survivor-thread',$2,'resolved','Already handled','Original','survivor-message',$3,actor_id FROM email_thread_attention`,
    [attention, primary, revision],
  );
  await db.query(
    `INSERT INTO google_workspace_historical_gmail_outcomes(connection_id,batch_id,message_id,thread_id,outcome,organization_id)
    SELECT connection_id,batch_id,'survivor-message','survivor-thread','ignored',$1 FROM google_workspace_historical_gmail_outcomes`,
    [primary],
  );
  const before = (
    await db.query("SELECT * FROM email_thread_attention WHERE id=$1", [
      attention,
    ])
  ).rows;
  const history = (
    await db.query(
      "SELECT * FROM google_workspace_historical_gmail_outcomes WHERE message_id='survivor-message'",
    )
  ).rows;
  const snapshot = await mergeSnapshot(db, primary, [duplicate]);
  await moveExtraMergeReferences(
    db,
    primary,
    [duplicate],
    snapshot.references.map((r) => r.table),
  );
  expect(
    (
      await db.query("SELECT * FROM email_thread_attention WHERE id=$1", [
        attention,
      ])
    ).rows,
  ).toEqual(before);
  expect(
    (
      await db.query(
        "SELECT * FROM google_workspace_historical_gmail_outcomes WHERE message_id='survivor-message'",
      )
    ).rows,
  ).toEqual(history);
});
