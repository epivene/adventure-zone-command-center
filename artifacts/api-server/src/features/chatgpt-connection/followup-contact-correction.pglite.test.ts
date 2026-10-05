import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { DraftFollowupService } from "./draft-followup-service";

let f: Awaited<ReturnType<typeof fixture>>;
let service: DraftFollowupService;
beforeEach(async () => {
  f = await fixture();
  service = new DraftFollowupService(f.db);
  await f.db.exec(`CREATE TABLE audit_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb)`);
});
afterEach(async () => f.db.close());
async function setup() {
  const oldContact = randomUUID(), newContact = randomUUID();
  for (const id of [oldContact, newContact]) {
    await f.db.query("INSERT INTO contacts(id) VALUES($1)", [id]);
    await f.db.query("INSERT INTO organization_contacts(organization_id,contact_id) VALUES($1,$2)", [f.profileId, id]);
  }
  const input = { profileId: f.profileId, contactId: oldContact, bookingId: null, kind: "Check committee response", dueAt: "2026-10-09T09:00:00-06:00" };
  const saved = await service.saveFollowup(f.principal, { requestKey: "create" }, input);
  return { oldContact, newContact, saved, input: { ...input, followupId: saved.recordId, expectedRevision: saved.revision, contactId: newContact } };
}
it("corrects the same reminder's linked contact, preserves history and replays exactly once", async () => {
  const { oldContact, newContact, saved, input } = await setup();
  const changed = await service.saveFollowup(f.principal, { requestKey: "correct" }, input);
  expect(changed.recordId).toBe(saved.recordId);
  expect(changed.revision).not.toBe(saved.revision);
  expect(await service.saveFollowup(f.principal, { requestKey: "correct" }, input)).toEqual(changed);
  const rows = (await f.db.query("SELECT * FROM follow_ups")).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ contact_id: newContact, kind: input.kind, completed_at: null });
  expect(new Date(rows[0].due_at).toISOString()).toBe(new Date(input.dueAt).toISOString());
  const audit = (await f.db.query("SELECT * FROM audit_entries")).rows;
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ entity_type: "follow_up", entity_id: saved.recordId, before: { contactId: oldContact }, after: { contactId: newContact } });
  await expect(service.saveFollowup(f.principal, { requestKey: "stale" }, { ...input, contactId: oldContact })).rejects.toMatchObject({ code: "CONNECTION_STALE_REVISION" });
});
it("rejects unrelated or inactive contacts and keeps booking reassignment forbidden", async () => {
  const { input, newContact, oldContact } = await setup();
  await expect(service.saveFollowup(f.principal, { requestKey: "unrelated" }, { ...input, contactId: randomUUID() })).rejects.toMatchObject({ code: "CONNECTION_CONTACT_MISMATCH" });
  await f.db.query("UPDATE organization_contacts SET active=false WHERE contact_id=$1", [newContact]);
  await expect(service.saveFollowup(f.principal, { requestKey: "inactive" }, input)).rejects.toMatchObject({ code: "CONNECTION_CONTACT_MISMATCH" });
  const bookingId = randomUUID();
  await f.db.query("INSERT INTO bookings(id,organization_id) VALUES($1,$2)", [bookingId, f.profileId]);
  await expect(service.saveFollowup(f.principal, { requestKey: "booking" }, { ...input, contactId: oldContact, bookingId })).rejects.toMatchObject({ code: "CONNECTION_FOLLOWUP_ASSOCIATION_IMMUTABLE" });
  expect((await f.db.query("SELECT contact_id FROM follow_ups")).rows[0].contact_id).toBe(oldContact);
  expect((await f.db.query("SELECT * FROM audit_entries")).rows).toHaveLength(0);
});
it("rolls back the contact correction when its audit cannot be saved", async () => {
  const { input, oldContact } = await setup();
  await f.db.exec("DROP TABLE audit_entries");
  await expect(service.saveFollowup(f.principal, { requestKey: "failed-audit" }, input)).rejects.toThrow();
  expect((await f.db.query("SELECT contact_id FROM follow_ups")).rows[0].contact_id).toBe(oldContact);
  expect((await f.db.query("SELECT * FROM chatgpt_operations WHERE request_key='failed-audit'")).rows).toHaveLength(0);
});
it("does not correct closed reminders or allow a read-only connection to write", async () => {
  const { input, oldContact } = await setup();
  await expect(service.saveFollowup({ ...f.principal, scopes: ["crm:read"] }, { requestKey: "read-only" }, input)).rejects.toThrow();
  await f.db.query("UPDATE follow_ups SET completed_at=now() WHERE id=$1", [input.followupId]);
  await expect(service.saveFollowup(f.principal, { requestKey: "closed" }, input)).rejects.toMatchObject({ code: "CONNECTION_STALE_REVISION" });
  expect((await f.db.query("SELECT contact_id FROM follow_ups")).rows[0].contact_id).toBe(oldContact);
  expect((await f.db.query("SELECT * FROM audit_entries")).rows).toHaveLength(0);
});
