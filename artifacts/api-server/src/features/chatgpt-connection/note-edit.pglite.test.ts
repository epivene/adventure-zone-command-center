import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { LeadNoteService } from "./lead-note-service";
let f: Awaited<ReturnType<typeof fixture>>,
  service: LeadNoteService,
  noteId: string;
beforeEach(async () => {
  f = await fixture();
  service = new LeadNoteService(f.db);
  noteId = randomUUID();
  await f.db.exec(`ALTER TABLE activities ADD COLUMN source_record_id text;
    CREATE TABLE activity_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),activity_id uuid,prior_body text NOT NULL,replacement_body text NOT NULL,reason text,created_at timestamptz DEFAULT now());
    CREATE TABLE audit_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);`);
  await f.db.query(
    `INSERT INTO activities(id,organization_id,kind,subject,body,occurred_at,timeline_sort_at) VALUES($1,$2,'note','History','Deposit $500; dates unknown.',now(),now())`,
    [noteId, f.profileId],
  );
});
afterEach(async () => f.db.close());
async function editInput() {
  const n = await service.readNote(f.principal, {
    profileId: f.profileId,
    noteId,
  });
  return {
    profileId: f.profileId,
    noteId,
    expectedRevision: n.revision!,
    body: "Dates unknown. Deposit: $500.",
    reason: "Simplify wording; preserve facts.",
  };
}
it("edits once, preserves original and timeline, and returns the same receipt on retry", async () => {
  const input = await editInput();
  const before = (await f.db.query("SELECT * FROM activities")).rows[0];
  const first = await service.editNote(
    f.principal,
    { requestKey: "edit" },
    input,
  );
  expect(
    await service.editNote(f.principal, { requestKey: "edit" }, input),
  ).toEqual(first);
  const rows = (await f.db.query("SELECT * FROM activity_revisions")).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    prior_body: before.body,
    replacement_body: input.body,
  });
  const after = await service.readNote(f.principal, {
    profileId: f.profileId,
    noteId,
  });
  expect(after.body).toBe(input.body);
  expect(after.revision).not.toBe(input.expectedRevision);
  const current = (await f.db.query("SELECT * FROM activities")).rows[0];
  expect(current.occurred_at).toEqual(before.occurred_at);
  expect(current.subject).toBe(before.subject);
  expect((await f.db.query("SELECT * FROM audit_entries")).rows).toHaveLength(
    1,
  );
});
it("rejects stale versions without writing history", async () => {
  const input = await editInput();
  await f.db.query(
    "UPDATE activities SET body='Owner changed it' WHERE id=$1",
    [noteId],
  );
  await expect(
    service.editNote(f.principal, { requestKey: "stale" }, input),
  ).rejects.toMatchObject({ code: "CONNECTION_STALE_REVISION" });
  expect(
    (await f.db.query("SELECT * FROM activity_revisions")).rows,
  ).toHaveLength(0);
});
it("requires edit scope and rejects imported, deleted, non-note and wrong-profile records", async () => {
  const input = await editInput();
  await expect(
    service.editNote(
      { ...f.principal, scopes: ["crm:read", "crm:append"] },
      { requestKey: "denied" },
      input,
    ),
  ).rejects.toThrow();
  for (const assignment of [
    "source_record_id='ACT-1'",
    "source_record_id=null,kind='email'",
    "kind='note',deleted_at=now()",
    "deleted_at=null,organization_id=null",
  ]) {
    await f.db.query(`UPDATE activities SET ${assignment} WHERE id=$1`, [
      noteId,
    ]);
    await expect(
      service.editNote(f.principal, { requestKey: assignment }, input),
    ).rejects.toThrow();
  }
  expect(
    (await f.db.query("SELECT * FROM activity_revisions")).rows,
  ).toHaveLength(0);
});
it("rejects blank or provider-branded replacements instead of silently dropping factual lines", async () => {
  const input = await editInput();
  for (const body of ["   ", "ChatGPT found a $500 deposit."])
    await expect(
      service.editNote(f.principal, { requestKey: body }, { ...input, body }),
    ).rejects.toThrow();
  expect(
    (await f.db.query("SELECT * FROM activity_revisions")).rows,
  ).toHaveLength(0);
});
it("rolls back the note and revision if recording its audit fails", async () => {
  const input = await editInput();
  await f.db.exec("DROP TABLE audit_entries");
  await expect(
    service.editNote(f.principal, { requestKey: "rollback" }, input),
  ).rejects.toThrow();
  expect(
    (await service.readNote(f.principal, { profileId: f.profileId, noteId }))
      .body,
  ).toBe("Deposit $500; dates unknown.");
  expect(
    (await f.db.query("SELECT * FROM activity_revisions")).rows,
  ).toHaveLength(0);
});
it("does not expose an edit token for truncated text", async () => {
  await f.db.query("UPDATE activities SET body=$2 WHERE id=$1", [
    noteId,
    "a".repeat(20001),
  ]);
  const note = await service.readNote(f.principal, {
    profileId: f.profileId,
    noteId,
  });
  expect(note).toMatchObject({
    editable: false,
    truncated: true,
    revision: null,
  });
});
