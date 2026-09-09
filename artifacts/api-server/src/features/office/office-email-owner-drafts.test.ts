import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleOfficeEmailRepository } from "./office-email-repository";
const client = new PGlite();
const repository = new DrizzleOfficeEmailRepository(drizzle(client) as any);
const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "10000000-0000-4000-8000-000000000002";
const accountId = "10000000-0000-4000-8000-000000000003";
const input = { organizationId, contactId, subject: "Fair plans", body: "Hello" };
beforeAll(async () => {
  await client.exec(`
    CREATE TABLE contacts (id uuid PRIMARY KEY, email text);
    CREATE TABLE organization_contacts (organization_id uuid, contact_id uuid, active boolean);
    CREATE TABLE office_email_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), office_account_id uuid, organization_id uuid NOT NULL,
      contact_id uuid NOT NULL, booking_id uuid, event_year integer, communication_template_id uuid,
      recipient_email text NOT NULL, subject text NOT NULL, body text NOT NULL, coordinator_note text,
      state text NOT NULL DEFAULT 'draft', submitted_at timestamptz, owner_return_note text, sent_at timestamptz,
      sent_message_id text, last_send_error text, created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    );
    INSERT INTO contacts VALUES ('${contactId}', ' Fair@Example.org ');
    INSERT INTO organization_contacts VALUES ('${organizationId}', '${contactId}', true);
  `);
});
afterAll(() => client.close());
describe("owner draft persistence", () => {
  it("persists a profile draft, normalizes the linked recipient, and reopens edits", async () => {
    const draft = await repository.createForOwner(input);
    expect(draft).toMatchObject({ ...input, state: "draft", recipientEmail: "fair@example.org", sentAt: null });
    await repository.updateForOwner(draft.id, { subject: "Updated", body: "Updated body" });
    expect(await repository.listForProfile(organizationId)).toEqual([expect.objectContaining({ id: draft.id, subject: "Updated", state: "draft", sentAt: null })]);
  });
  it("rejects an unlinked or inactive contact", async () => {
    await expect(repository.createForOwner({ ...input, contactId: accountId })).rejects.toMatchObject({ code: "CONTACT_NOT_LINKED" });
    await client.query('UPDATE organization_contacts SET active = false');
    await expect(repository.createForOwner(input)).rejects.toMatchObject({ code: "CONTACT_NOT_LINKED" });
    await client.query('UPDATE organization_contacts SET active = true');
  });
  it("cannot edit coordinator-owned drafts or drafts already submitted", async () => {
    const office = await repository.createForOffice({ ...input, accountId, communicationTemplateId: null, bookingId: null, eventYear: null, coordinatorNote: null });
    await expect(repository.updateForOwner(office.id, { subject: "No", body: "No" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await repository.listForProfile(organizationId)).map((draft) => draft.id)).not.toContain(office.id);
    const owner = await repository.createForOwner(input);
    await client.query("UPDATE office_email_drafts SET state = 'submitted' WHERE id = $1", [owner.id]);
    await expect(repository.updateForOwner(owner.id, { subject: "No", body: "No" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
