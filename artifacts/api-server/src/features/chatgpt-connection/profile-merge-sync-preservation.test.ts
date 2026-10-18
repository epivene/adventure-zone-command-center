import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { mergeSnapshot } from "./profile-merge-snapshot";
import { moveExtraMergeReferences } from "./profile-merge-references";
vi.mock("../organizations/organization-family-lock", () => ({
  organizationFamilyReviewAdvisoryLockKey: 734802341,
}));
const primary = "11111111-1111-4111-8111-111111111111",
  duplicate = "22222222-2222-4222-8222-222222222222",
  account = "33333333-3333-4333-8333-333333333333";
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,name text,city text,region text,consolidated_into_id uuid);
    CREATE TABLE chatgpt_external_drafts(content jsonb);
    CREATE TABLE audit_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);
    CREATE TABLE deadline_notifications(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations(id),occurrence_key text UNIQUE,title text,active boolean,dismissed_at timestamptz,email_state text);
    INSERT INTO organizations VALUES('${primary}','Fair','Town','WY',NULL),('${duplicate}','Fair old','Town','WY',NULL);
    INSERT INTO deadline_notifications VALUES(gen_random_uuid(),'${duplicate}','original-occurrence','Do not contact',true,now(),'disabled');`);
  await db.exec(
    readFileSync(
      new URL(
        "../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query("INSERT INTO google_sync_enrollments VALUES($1,$2),($1,$3)", [
    account,
    primary,
    duplicate,
  ]);
  await db.query(
    "INSERT INTO google_sync_snapshots(connection_id,thread_id,profile_id,state,snapshot,fingerprint) VALUES($1,'thread',$2,'contact_blocked',$3,'original-hash')",
    [
      account,
      duplicate,
      JSON.stringify({
        messages: [{ id: "message", bodyText: "Original private history" }],
      }),
    ],
  );
  await db.exec(
    "INSERT INTO google_sync_history(connection_id,thread_id,profile_id,state,snapshot,fingerprint) SELECT connection_id,thread_id,profile_id,state,snapshot,fingerprint FROM google_sync_snapshots",
  );
  await db.query(
    "INSERT INTO google_sync_archive_jobs(connection_id,thread_id,profile_id,fingerprint,attempts,error_code) VALUES($1,'thread',$2,'archive-hash',3,'SYNC_ARCHIVE_RETRY')",
    [account, duplicate],
  );
  return db;
}
const moved = [
  "deadline_notifications",
  "google_sync_snapshots",
  "google_sync_history",
  "google_sync_archive_jobs",
];
it("blocks oversized preservation evidence before moving any references", async () => {
  const db = await fixture();
  try {
    await db.query("UPDATE google_sync_history SET snapshot=$1", [
      JSON.stringify({ body: "x".repeat(4 * 1024 * 1024) }),
    ]);
    await expect(
      db.transaction((tx) =>
        moveExtraMergeReferences(tx, primary, [duplicate], moved),
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_MERGE_BLOCKED" });
    expect(
      (
        await db.query<{ organization_id: string }>(
          "SELECT organization_id FROM deadline_notifications",
        )
      ).rows[0].organization_id,
    ).toBe(duplicate);
    expect((await db.query("SELECT * FROM audit_entries")).rows).toHaveLength(
      0,
    );
  } finally {
    await db.close();
  }
});
it("preserves notification status, every sync observation, retry metadata and original reference evidence", async () => {
  const db = await fixture();
  try {
    const before = Object.fromEntries(
      await Promise.all(
        moved.map(async (t) => [
          t,
          (await db.query(`SELECT * FROM ${t}`)).rows,
        ]),
      ),
    );
    const snapshot = await mergeSnapshot(db, primary, [duplicate]);
    expect(snapshot.blockers).toEqual([]);
    await db.transaction(async (tx) => {
      await moveExtraMergeReferences(
        tx,
        primary,
        [duplicate],
        snapshot.references.map((r) => r.table),
      );
      await tx.query("DELETE FROM organizations WHERE id=$1", [duplicate]);
    });
    for (const t of moved) {
      const col =
        t === "deadline_notifications" ? "organization_id" : "profile_id";
      expect((await db.query(`SELECT * FROM ${t}`)).rows).toEqual(
        before[t].map((r: Record<string, unknown>) => ({
          ...r,
          [col]: primary,
        })),
      );
    }
    // Enrollment source identities remain, even when both profiles were enrolled.
    expect(
      (await db.query("SELECT * FROM google_sync_enrollments")).rows,
    ).toHaveLength(2);
    const audit = (
      await db.query<any>(
        "SELECT * FROM audit_entries WHERE action='merge_sync_references'",
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].before.tables.google_sync_history[0].profile_id).toBe(
      duplicate,
    );
    expect(audit[0].after.tables.google_sync_history[0].profile_id).toBe(
      primary,
    );
  } finally {
    await db.close();
  }
});
it("rolls preservation writes and evidence back if the merge fails later", async () => {
  const db = await fixture();
  try {
    const before = (await db.query("SELECT * FROM google_sync_history")).rows;
    const snapshot = await mergeSnapshot(db, primary, [duplicate]);
    await expect(
      db.transaction(async (tx) => {
        await moveExtraMergeReferences(
          tx,
          primary,
          [duplicate],
          snapshot.references.map((r) => r.table),
        );
        throw Error("later failure");
      }),
    ).rejects.toThrow("later failure");
    expect((await db.query("SELECT * FROM google_sync_history")).rows).toEqual(
      before,
    );
    expect((await db.query("SELECT * FROM audit_entries")).rows).toHaveLength(
      0,
    );
  } finally {
    await db.close();
  }
});
it("enrolls a previously unenrolled survivor while retaining the source enrollment", async () => {
  const db = await fixture();
  try {
    await db.query("DELETE FROM google_sync_enrollments WHERE profile_id=$1", [
      primary,
    ]);
    const snapshot = await mergeSnapshot(db, primary, [duplicate]);
    await db.transaction((tx) =>
      moveExtraMergeReferences(
        tx,
        primary,
        [duplicate],
        snapshot.references.map((r) => r.table),
      ),
    );
    expect(
      (
        await db.query(
          "SELECT profile_id FROM google_sync_enrollments ORDER BY profile_id",
        )
      ).rows,
    ).toEqual([{ profile_id: primary }, { profile_id: duplicate }]);
  } finally {
    await db.close();
  }
});
it("does not commit reference moves when the preservation receipt cannot be saved", async () => {
  const db = await fixture();
  try {
    await db.exec(
      "ALTER TABLE audit_entries ADD CONSTRAINT reject_receipt CHECK(action <> 'merge_sync_references')",
    );
    const before = (await db.query("SELECT * FROM deadline_notifications"))
      .rows;
    const snapshot = await mergeSnapshot(db, primary, [duplicate]);
    await expect(
      db.transaction((tx) =>
        moveExtraMergeReferences(
          tx,
          primary,
          [duplicate],
          snapshot.references.map((r) => r.table),
        ),
      ),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT * FROM deadline_notifications")).rows,
    ).toEqual(before);
    expect(
      (await db.query("SELECT profile_id FROM google_sync_history")).rows,
    ).toEqual([{ profile_id: duplicate }]);
  } finally {
    await db.close();
  }
});
