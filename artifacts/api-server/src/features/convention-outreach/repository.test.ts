import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { ConventionRepository } from "./repository";

describe("convention persistence", () => {
  it("imports once, keeps ambiguous contacts, rejects stale edits and preserves previous years", async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,name text); CREATE TABLE contacts(id uuid PRIMARY KEY,organization_id uuid,email text);
        CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean DEFAULT true);`);
      const migration = await readFile(
        new URL(
          "../../../../../lib/db/migrations/20260909c_convention_outreach.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await db.exec(migration);
      await db.exec(migration);
      const client = {
        query: async (sql: string, values?: unknown[]) => ({
          rows: (await db.query(sql, values)).rows as any[],
        }),
      };
      const repo = new ConventionRepository({
        ...client,
        connect: async () => client,
      });
      const org = "00000000-0000-4000-8000-000000000001",
        contact = "00000000-0000-4000-8000-000000000002";
      await db.query("INSERT INTO organizations VALUES($1,$2)", [
        org,
        "County Fair",
      ]);
      await db.query("INSERT INTO contacts VALUES($1,$2,$3)", [
        contact,
        org,
        "fair@example.com",
      ]);
      const edition = await repo.create(
        {
          convention: "Heartland",
          year: 2026,
          summary: "My research",
          recommendation: "Start with returning contacts",
          sources: "S1",
        },
        "owner",
      );
      const rows = [
        {
          sourceKey: "S1",
          event: "County Fair",
          email: "fair@example.com",
          group: "replacement",
          outcome: "interested",
        },
        {
          sourceKey: "S2",
          event: "Unresolved Fair",
          email: "fair@example.com",
          group: "special",
        },
      ];
      const preview = await repo.preview(edition.id, rows);
      assert.equal(preview.rows[0].match?.organizationId, org);
      assert.equal(preview.rows[1].match, null);
      const result = await repo.import(edition.id, rows, 1, "batch1", "owner");
      assert.equal(result.added, 2);
      assert.deepEqual(
        await repo.import(edition.id, rows, 1, "batch1", "owner"),
        result,
      );
      await assert.rejects(
        repo.import(edition.id, rows.slice(0, 1), 1, "batch1", "owner"),
        /different content/,
      );
      const detail = await repo.detail(edition.id, "boss");
      assert.equal(detail.members.length, 2);
      const member = detail.members.find((m) => m.source_key === "S1");
      const responseUpdate = await repo.updateConventionResponse(
        edition.id,
        member.id,
        1,
        {
          met: true,
          interested: true,
          followUp: true,
          contact: "Taylor",
          notes: "Asked about Weekend Warriors.",
        },
        "boss:one",
      );
      assert.equal(responseUpdate.organization_id, org);
      assert.equal(responseUpdate.data.conventionResponse.met, true);
      assert.equal(responseUpdate.data.notes, "");
      await repo.review(edition.id, 3, "Looks good", "boss");
      await repo.updateMember(
        edition.id,
        member.id,
        2,
        { ...responseUpdate.data, notes: "New notes" },
        { organizationId: org, contactId: contact },
        "owner",
      );
      await assert.rejects(
        repo.updateMember(
          edition.id,
          member.id,
          2,
          member.data,
          { organizationId: org, contactId: contact },
          "owner",
        ),
        /changed/,
      );
      const updated = await repo.detail(edition.id, "boss");
      assert.equal(updated.review.reviewed_revision, 3);
      assert.equal(updated.edition.revision, 4);
      assert.equal(
        updated.members.find((m) => m.source_key === "S1").data
          .conventionResponse.contact,
        "Taylor",
      );
      const next = await repo.rollover(edition.id, 4, "owner");
      assert.equal(next.year, 2027);
      assert.equal((await repo.rollover(edition.id, 4, "owner")).id, next.id);
      const nextDetail = await repo.detail(next.id, "boss");
      assert.equal(nextDetail.members.length, 2);
      assert.equal(
        nextDetail.members.find((m) => m.source_key === "S1").data.outcome,
        "not_contacted",
      );
      assert.equal(
        nextDetail.members.find((m) => m.source_key === "S1").data.group,
        "replacement",
      );
      assert.equal(nextDetail.review, null);
      const original = await repo.detail(edition.id, "boss");
      assert.equal(
        original.members.find((m) => m.source_key === "S1").data.outcome,
        "interested",
      );
      assert.equal((await repo.profileHistory(org)).length, 2);
      await assert.rejects(
        repo.create(
          {
            convention: "Heartland",
            year: 2027,
            summary: "",
            recommendation: "",
            sources: "",
          },
          "owner",
        ),
        /already exist/,
      );
      await assert.rejects(
        repo.preview(edition.id, [rows[0], rows[0]]),
        /Duplicate source keys/,
      );
      const archived = await repo.updateEdition(
        edition.id,
        4,
        {
          summary: "My final notes",
          recommendation: "Contact next year",
          sources: "S1",
          archived: true,
        },
        "owner",
      );
      assert.equal(archived.revision, 5);
      await assert.rejects(repo.preview(edition.id, rows), /archived/);
      await assert.rejects(
        repo.updateMember(
          edition.id,
          member.id,
          3,
          member.data,
          { organizationId: org, contactId: contact },
          "owner",
        ),
        /archived/,
      );
      await assert.rejects(
        repo.updateEdition(
          edition.id,
          4,
          {
            summary: "stale",
            recommendation: "",
            sources: "",
            archived: false,
          },
          "owner",
        ),
        /changed/,
      );
      assert.equal(
        (await repo.detail(next.id, "boss")).edition.archived_at,
        null,
      );
      await db.exec(`
        CREATE TABLE activities(id uuid,organization_id uuid,kind text,subject text,body text,occurred_at timestamptz,timeline_sort_at timestamptz,deleted_at timestamptz);
        CREATE TABLE early_bird_promo_enrollments(id uuid,organization_id uuid,event_year integer,status text,first_sent_at timestamptz,deadline_date date,interest_confirmed_at timestamptz,reminder_due_at timestamptz,reminder_draft_id uuid,deposit_received_at timestamptz,cancel_reason text);
        CREATE TABLE follow_ups(id uuid,organization_id uuid,kind text,due_at timestamptz,completed_at timestamptz,outcome text);
        CREATE TABLE boss_convention_submissions(id uuid,applied_organization_id uuid,payload jsonb,created_at timestamptz,applied_at timestamptz);
      `);
      await db.query(
        `INSERT INTO activities VALUES($1,$2,'email','Reply','Interested','2026-09-20','2026-09-20',NULL)`,
        [contact, org],
      );
      await db.query(
        `INSERT INTO early_bird_promo_enrollments(id,organization_id,event_year,status,first_sent_at,deadline_date) VALUES($1,$2,2027,'active','2026-09-09','2026-10-09')`,
        [contact, org],
      );
      const context = await repo.memberContext(edition.id, member.id);
      assert.equal(context.activities[0].body, "Interested");
      assert.equal(context.promotions[0].event_year, 2027);
      assert.equal(String(context.promotions[0].deadline_date), "2026-10-09");
      const unresolved = original.members.find((m) => m.source_key === "S2");
      assert.deepEqual(await repo.memberContext(edition.id, unresolved.id), {
        activities: [],
        promotions: [],
        followUps: [],
        submissions: [],
      });
    } finally {
      await db.close();
    }
  });
});
