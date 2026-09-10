import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { conventionCampaignTemplates, ensureConventionCampaignTemplateSeed } from "./convention-campaign-template-seed";

it("backfills outreach reviews after templates were already deployed without duplicating completed reviews", async () => {
  const client = new PGlite();
  try {
    await client.exec(`      create table boss_accounts (
        id uuid primary key default gen_random_uuid(), display_name text not null
      );
      insert into boss_accounts(id,display_name) values ('33333333-3333-4333-8333-333333333333','Dave');
      create table communication_templates (
        id uuid primary key default gen_random_uuid(), code text not null unique,
        template_version text, name text not null, channel text not null default 'email',
        category text not null, subject_template text, body_template text not null,
        body_format text not null default 'plain_text', allowed_placeholders text[] not null default '{}',
        required_placeholders text[] not null default '{}', access_scope text not null default 'owner',
        state text not null default 'draft', owner_kind text not null default 'company',
        owner_office_account_id uuid, created_by_kind text not null default 'system',
        created_by_id uuid, source_template_id uuid, source_document_id uuid, source_note text,
        reviewed_by text, reviewed_at timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table boss_work_requests (
        id uuid primary key default gen_random_uuid(), type text not null, state text not null,
        priority text not null default 'normal', title text not null, instructions text, due_at timestamptz,
        created_by_owner_id text, assigned_boss_account_id uuid not null, deduplication_key text,
        completed_at timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (assigned_boss_account_id, deduplication_key)
      );
      create table communication_template_reviews (
        id uuid primary key default gen_random_uuid(), request_id uuid not null,
        position integer not null default 0, template_name_snapshot text not null default 'Email',
        verified_links jsonb not null default '[]',
        template_id uuid not null, template_version text, content_fingerprint text not null,
        subject_snapshot text, body_snapshot text not null, body_format_snapshot text not null,
        decision text not null default 'pending', note text, decided_by_boss_account_id uuid,
        decided_at timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table boss_work_request_events (
        id uuid primary key default gen_random_uuid(), request_id uuid not null,
        actor_kind text not null, actor_id text, prior_state text, new_state text not null,
        note text, metadata jsonb not null default '{}', created_at timestamptz not null default now()
      );
`);
    const database = drizzle(client, { schema });
    // Simulate the previous deployment: current templates exist, reviews do not.
    await database.insert(schema.communicationTemplates).values(conventionCampaignTemplates.map(template => ({
      code: template.code, name: template.name, templateVersion: template.templateVersion,
      subjectTemplate: template.subjectTemplate, bodyTemplate: template.bodyTemplate,
      category: "convention_campaign", channel: "email", bodyFormat: "html" as const,
      state: "active" as const, ownerKind: "company" as const,
    })));
    await ensureConventionCampaignTemplateSeed(database as never);
    await ensureConventionCampaignTemplateSeed(database as never);
    const requests = await client.query<{id:string;state:string;title:string}>(
      "select id,state,title from boss_work_requests where title='Review returning customer outreach (2 emails)'"
    );
    expect(requests.rows).toHaveLength(1);
    expect(requests.rows[0].state).toBe("waiting_on_dave");
    const id = requests.rows[0].id;
    const reviews = await client.query<{body_snapshot:string;subject_snapshot:string;decision:string}>(
      "select body_snapshot,subject_snapshot,decision from communication_template_reviews where request_id=$1 order by position", [id]
    );
    expect(reviews.rows).toHaveLength(2);
    for (const review of reviews.rows) {
      expect(review.body_snapshot).toContain("LET’S RECONNECT!");
      expect(review.body_snapshot).not.toContain("{{conventionName}}");
      expect(review.body_snapshot.indexOf("EARLY BIRD BOOKING OFFER")).toBeLessThan(review.body_snapshot.indexOf("Hi {{contactName}}"));
      expect(review.decision).toBe("pending");
    }
    await client.query("update boss_work_requests set state='approved', completed_at=now(), deduplication_key=null where id=$1", [id]);
    await client.query("update communication_template_reviews set decision='approved' where request_id=$1", [id]);
    await ensureConventionCampaignTemplateSeed(database as never);
    expect((await client.query("select id from boss_work_requests")).rows).toHaveLength(1);
    expect((await client.query("select decision from communication_template_reviews")).rows).toEqual([{decision:"approved"},{decision:"approved"}]);
  } finally {
    await client.close();
  }
});
