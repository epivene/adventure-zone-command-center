import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { templateFingerprint } from "@/features/boss-work-requests/boss-work-request-service";
import {
  conventionCampaignTemplates,
  ensureConventionCampaignTemplateSeed,
} from "./convention-campaign-template-seed";

const clients: PGlite[] = [];
afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

describe("convention campaign template seed", () => {
  it("preserves all seven finalized Gmail convention drafts as distinct templates", () => {
    expect(conventionCampaignTemplates).toHaveLength(7);
    expect(conventionCampaignTemplates.map((item) => ({
      code: item.code,
      gmailMessageId: item.gmailMessageId,
      name: item.name,
    }))).toEqual([
      {
        code: "convention_before_general_v2",
        gmailMessageId: "1a0847e159516da1",
        name: "TEMPLATE 1 — BEFORE Convention — General (New or Past Event)",
      },
      {
        code: "convention_before_new_event_v2",
        gmailMessageId: "1a084a2f40feb499",
        name: "TEMPLATE 2 — BEFORE Convention — New Event",
      },
      {
        code: "convention_before_past_event_v2",
        gmailMessageId: "1a084a30b8f72f15",
        name: "TEMPLATE 3 — BEFORE Convention — Past Event",
      },
      {
        code: "convention_during_new_event_v2",
        gmailMessageId: "1a084a31eb26862c",
        name: "TEMPLATE 4 — DURING Convention — New Event",
      },
      {
        code: "convention_during_past_event_v2",
        gmailMessageId: "1a084a3353ce3f92",
        name: "TEMPLATE 5 — DURING Convention — Past Event",
      },
      {
        code: "convention_after_new_event_v2",
        gmailMessageId: "1a08975b5738b040",
        name: "TEMPLATE 6 — AFTER Convention — New Event",
      },
      {
        code: "convention_after_past_event_v2",
        gmailMessageId: "1a08975cc9c100c8",
        name: "TEMPLATE 7 — AFTER Convention — Past Event",
      },
    ]);
  });

  it("turns both after-convention messages into package-closing emails", () => {
    const afterConvention = conventionCampaignTemplates.filter((template) =>
      template.code.startsWith("convention_after_"),
    );

    expect(afterConvention).toHaveLength(2);
    for (const template of afterConvention) {
      expect(template.templateVersion).toBe("2026-09-after-convention-close-v4");
      expect(template.bodyTemplate).toContain(
        'href="https://www.the-adventure-zone.com/?welcome=convention"',
      );
      expect(template.bodyTemplate).toContain("SEE YOUR PACKAGE OPTIONS");
      expect(template.bodyTemplate).not.toContain("EXPLORE THE WEBSITE");
      expect(template.bodyTemplate).toContain("AMERICA’S GREATEST BOUNCE HOUSE CARNIVAL");
      expect(template.bodyTemplate).toContain("background:#0f1729");
      expect(template.bodyTemplate).toContain("background:#ffca05");
      expect(template.bodyTemplate).toContain("{{earlyBirdDeadline}}");
    }
  });

  it("refreshes an active template without an availability or audit gap", async () => {
    const client = new PGlite();
    clients.push(client);
    await client.exec(`
      create table boss_accounts (
        id uuid primary key default gen_random_uuid(), display_name text not null
      );
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
        id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
        template_id uuid not null, template_version text, content_fingerprint text not null,
        subject_snapshot text, body_snapshot text not null, body_format_snapshot text not null,
        decision text not null default 'pending', note text, decided_by_boss_account_id uuid,
        decided_at timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      insert into communication_templates (
        id, code, template_version, name, category, subject_template, body_template,
        body_format, access_scope, state, owner_kind, reviewed_by, reviewed_at
      ) values (
        '11111111-1111-4111-8111-111111111111', 'convention_after_new_event_v2',
        '2026-09-gmail-final-v2', 'Old active template', 'convention_campaign',
        'Old subject', 'Old body', 'html', 'office', 'active', 'company',
        'boss:old-reviewer', '2026-09-01T12:00:00Z'
      );
      insert into boss_work_requests (
        id, type, state, title, assigned_boss_account_id, deduplication_key
      ) values (
        '22222222-2222-4222-8222-222222222222', 'email_template_approval',
        'changes_requested', 'Review old template', '33333333-3333-4333-8333-333333333333',
        'template-review:old'
      );
      insert into communication_template_reviews (
        request_id, template_id, template_version, content_fingerprint,
        subject_snapshot, body_snapshot, body_format_snapshot, decision
      ) values (
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111', '2026-09-gmail-final-v2',
        'old-fingerprint', 'Old subject', 'Old body', 'html', 'changes_requested'
      );
    `);
    const database = drizzle(client, { schema });

    const matchingTemplate = conventionCampaignTemplates[0];
    const matchingFingerprint = templateFingerprint({
      templateVersion: matchingTemplate.templateVersion,
      subjectTemplate: matchingTemplate.subjectTemplate,
      bodyTemplate: matchingTemplate.bodyTemplate,
      bodyFormat: "html",
    });
    await client.query(
      `insert into communication_templates (
        id, code, template_version, name, category, subject_template, body_template,
        body_format, access_scope, state, owner_kind
      ) values ($1, $2, $3, $4, 'convention_campaign', $5, $6, 'html', 'office', 'draft', 'company')`,
      [
        "44444444-4444-4444-8444-444444444444",
        matchingTemplate.code,
        matchingTemplate.templateVersion,
        matchingTemplate.name,
        matchingTemplate.subjectTemplate,
        matchingTemplate.bodyTemplate,
      ],
    );
    await client.query(
      `insert into boss_work_requests (
        id, type, state, title, assigned_boss_account_id, deduplication_key
      ) values ($1, 'email_template_approval', 'waiting_on_dave', $2, $3, $4)`,
      [
        "55555555-5555-4555-8555-555555555555",
        "Review matching finalized template",
        "33333333-3333-4333-8333-333333333333",
        "template-review:matching",
      ],
    );
    await client.query(
      `insert into communication_template_reviews (
        request_id, template_id, template_version, content_fingerprint,
        subject_snapshot, body_snapshot, body_format_snapshot
      ) values ($1, $2, $3, $4, $5, $6, 'html')`,
      [
        "55555555-5555-4555-8555-555555555555",
        "44444444-4444-4444-8444-444444444444",
        matchingTemplate.templateVersion,
        matchingFingerprint,
        matchingTemplate.subjectTemplate,
        matchingTemplate.bodyTemplate,
      ],
    );

    await ensureConventionCampaignTemplateSeed(database as never);
    const afterFirstRun = await client.query<{
      template_version: string;
      body_template: string;
      state: string;
      reviewed_by: string;
      reviewed_at: Date;
      request_state: string;
      completed_at: Date;
      deduplication_key: string | null;
    }>(`
      select t.template_version, t.body_template, t.state, t.reviewed_by, t.reviewed_at,
        r.state as request_state, r.completed_at, r.deduplication_key
      from communication_templates t
      join communication_template_reviews review on review.template_id = t.id
      join boss_work_requests r on r.id = review.request_id
      where t.code = 'convention_after_new_event_v2'
    `);

    expect(afterFirstRun.rows).toHaveLength(1);
    expect(afterFirstRun.rows[0]).toMatchObject({
      template_version: "2026-09-after-convention-close-v4",
      state: "active",
      reviewed_by: "system:owner-approved-convention-finalized",
      request_state: "cancelled",
      deduplication_key: null,
    });
    expect(afterFirstRun.rows[0].body_template).toContain("SEE YOUR PACKAGE OPTIONS");
    expect(afterFirstRun.rows[0].reviewed_at).toBeInstanceOf(Date);
    expect(afterFirstRun.rows[0].completed_at).toBeInstanceOf(Date);

    const matchingReview = await client.query<{
      request_state: string;
      completed_at: Date;
      deduplication_key: string | null;
    }>(`
      select state as request_state, completed_at, deduplication_key
      from boss_work_requests
      where id = '55555555-5555-4555-8555-555555555555'
    `);
    expect(matchingReview.rows).toEqual([{
      request_state: "cancelled",
      completed_at: expect.any(Date),
      deduplication_key: null,
    }]);

    const finalizedAvailability = await client.query<{
      state: string;
      template_count: number;
    }>(`
      select state, count(*)::int as template_count
      from communication_templates
      where category = 'convention_campaign'
      group by state
      order by state
    `);
    expect(finalizedAvailability.rows).toEqual([
      { state: "active", template_count: 7 },
    ]);

    await ensureConventionCampaignTemplateSeed(database as never);
    const afterSecondRun = await client.query<{ template_count: number; request_count: number }>(`
      select
        (select count(*)::int from communication_templates) as template_count,
        (select count(*)::int from boss_work_requests) as request_count
    `);
    expect(afterSecondRun.rows).toEqual([{ template_count: 7, request_count: 2 }]);
  });

  it("keeps the finalized Gmail design and the agreed Early Bird addition", () => {
    const expectedHeadlines = [
      "LET’S PLAN",
      "LET’S CREATE",
      "LET’S MAKE",
      "LET’S TALK",
      "COME CATCH UP",
      "THE FUN GOING",
      "WHAT’S NEXT",
    ];

    for (const [index, template] of conventionCampaignTemplates.entries()) {
      expect(template.bodyTemplate).toContain(expectedHeadlines[index]);
      expect(template.bodyTemplate).toContain("#0f1729");
      expect(template.bodyTemplate).toContain("#ff0a8a");
      expect(template.bodyTemplate).toContain("25+");
      expect(template.bodyTemplate).toContain("500+");
      expect(template.bodyTemplate).toContain("PIRATE’S");
      expect(template.bodyTemplate).toContain("WARRIOR’S");
      expect(template.bodyTemplate.match(/Early Bird/g)).toHaveLength(1);
      expect(template.bodyTemplate).not.toMatch(/winter booking promo/i);
      expect(template.bodyTemplate).not.toMatch(/30 days from (this|your) email/i);
    }
  });
});
