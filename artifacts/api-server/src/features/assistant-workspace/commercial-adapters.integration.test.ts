import { readCurrentContractDraft } from "./commercial-tools";
import { readCommercialRecords } from "./commercial-evidence";
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  commercialAdapters,
  commercialActionPreview,
} from "./commercial-adapters";
import { ActionExecutor } from "./action-executor";
import { ActionStore } from "./action-store";
import { ConversationStore } from "./conversation-store";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import {
  emptySelection,
  type RunContext,
  type ActionIntent,
} from "./contracts";
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  await db.exec(`
 CREATE TABLE organizations(id uuid PRIMARY KEY,name text,consolidated_into_id uuid);
 CREATE TABLE bookings(id uuid PRIMARY KEY,organization_id uuid,name text);
 CREATE TABLE booking_opportunities(id uuid DEFAULT gen_random_uuid(),booking_id uuid,organization_id uuid,event_year integer);
 CREATE TABLE business_documents(id uuid PRIMARY KEY,display_name text);
 CREATE TABLE invoices(id uuid PRIMARY KEY,organization_id uuid,booking_id uuid,document_id uuid,invoice_number text,status text,currency text,total_cents integer,deposit_cents integer,issue_date date,deposit_due_date date,balance_due_date date,sent_at timestamptz,paid_at timestamptz,notes text,created_by text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),cancelled_at timestamptz);
 CREATE TABLE invoice_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),invoice_id uuid,amount_cents integer,received_date date,method text,notes text,created_by text,created_at timestamptz DEFAULT now(),voided_at timestamptz,voided_by text);
 CREATE TABLE audit_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb,reverses_entry_id uuid,created_at timestamptz DEFAULT now());
 `);
}, 30000);
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});
async function setup() {
  const org = randomUUID(),
    booking = randomUUID(),
    doc = randomUUID(),
    invoice = randomUUID();
  await db.query("INSERT INTO organizations VALUES($1,'Test customer',NULL)", [
    org,
  ]);
  await db.query("INSERT INTO bookings VALUES($1,$2,'2027 event')", [
    booking,
    org,
  ]);
  await db.query(
    "INSERT INTO booking_opportunities(booking_id,organization_id,event_year) VALUES($1,$2,2027)",
    [booking, org],
  );
  await db.query("INSERT INTO business_documents VALUES($1,'Invoice')", [doc]);
  await db.query(
    "INSERT INTO invoices(id,organization_id,booking_id,document_id,invoice_number,status,currency,total_cents,deposit_cents,issue_date,deposit_due_date,balance_due_date,created_by) VALUES($1,$2,$3,$4,'TEST-2027-001','sent','USD',765000,382500,'2026-09-22','2026-10-01','2027-07-23','owner')",
    [invoice, org, booking, doc],
  );
  const revision = new Date(
    (
      await db.query<any>("SELECT updated_at FROM invoices WHERE id=$1", [
        invoice,
      ])
    ).rows[0].updated_at,
  ).toISOString();
  const conversations = new ConversationStore(db),
    actions = new ActionStore(db);
  const c = await conversations.create("owner", "Payment");
  const m = await conversations.append("owner", c.id, "record", {
    role: "user",
    text: "Record reviewed payment",
  });
  const intent: ActionIntent = {
    id: randomUUID(),
    actorId: "owner",
    conversationId: c.id,
    sourceMessageId: m.id,
    kind: "record_invoice_payment",
    targetId: invoice,
    expectedRevision: revision,
    connectionId: null,
    arguments: {
      organizationId: org,
      eventYear: 2027,
      amountCents: 382500,
      receivedDate: "2026-09-24",
      method: "check",
      receiptReference: "Bank receipt TEST-1",
    },
  };
  const context: RunContext = {
    actor: { id: "owner", role: "owner", connectionId: null },
    conversationId: c.id,
    runId: randomUUID(),
    selection: { ...emptySelection(), organizationIds: [org], eventYear: 2027 },
    signal: new AbortController().signal,
    grants: [
      {
        actorId: "owner",
        sourceMessageId: m.id,
        actionKind: intent.kind,
        targetIds: [invoice],
        revision,
        connectionId: null,
      },
    ],
  };
  const executor = new ActionExecutor(
    "owner",
    actions,
    commercialAdapters(drizzle(db) as any, db),
  );
  return { context, intent, executor, invoice };
}
it("records one actual payment with a replayable receipt through existing invoice service", async () => {
  const s = await setup();
  const out = await s.executor.execute(s.context, s.intent);
  expect(out.status).toBe("ok");
  expect((out.data as any).record).toMatchObject({
    paidCents: 382500,
    remainingCents: 382500,
    status: "deposit_paid",
  });
  expect((await s.executor.execute(s.context, s.intent)).receipts).toEqual(
    out.receipts,
  );
  expect(
    (await db.query<any>("SELECT count(*)::int AS n FROM invoice_payments"))
      .rows[0].n,
  ).toBe(1);
});
it("rolls back payment and receipt together when the canonical audit fails", async () => {
  const s = await setup();
  await db.exec(
    "ALTER TABLE audit_entries ADD CONSTRAINT fail_created CHECK(action<>'created')",
  );
  expect((await s.executor.execute(s.context, s.intent)).status).toBe(
    "uncertain",
  );
  expect(
    (await db.query<any>("SELECT count(*)::int AS n FROM invoice_payments"))
      .rows[0].n,
  ).toBe(0);
  expect(
    (
      await db.query<any>(
        "SELECT count(*)::int AS n FROM assistant_workspace_mutation_results",
      )
    ).rows[0].n,
  ).toBe(0);
});
it("rejects a different selected booking and a changed invoice before recording payment", async () => {
  const s = await setup();
  s.context.selection.bookingId = randomUUID();
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_",
  );
  expect(
    (await db.query<any>("SELECT count(*)::int AS n FROM invoice_payments"))
      .rows[0].n,
  ).toBe(0);
  s.context.selection.bookingId = null;
  s.intent = { ...s.intent, id: randomUUID(), expectedRevision: "stale" };
  s.context.grants[0].revision = "stale";
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_",
  );
});
it("rejects a repeated receipt on a new action after refreshing the invoice revision", async () => {
  const s = await setup();
  expect((await s.executor.execute(s.context, s.intent)).status).toBe("ok");
  s.intent = {
    ...s.intent,
    id: randomUUID(),
    expectedRevision: new Date(
      (
        await db.query<any>("SELECT updated_at FROM invoices WHERE id=$1", [
          s.invoice,
        ])
      ).rows[0].updated_at,
    ).toISOString(),
  };
  s.context.grants[0].revision = s.intent.expectedRevision;
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_",
  );
  expect(
    (await db.query<any>("SELECT count(*)::int AS n FROM invoice_payments"))
      .rows[0].n,
  ).toBe(1);
});

it("validates stored PDF fields against the reviewed customer, booking and year", async () => {
  const s = await setup();
  vi.stubEnv("CONTRACT_BUILDER_ENABLED", "true");
  const args: any = s.intent.arguments,
    draft = randomUUID();
  await db.exec(
    "CREATE TABLE contract_drafts(id uuid,organization_id uuid,booking_id uuid,revision integer,values jsonb)",
  );
  const booking = (
    await db.query<any>("SELECT booking_id FROM invoices WHERE id=$1", [
      s.invoice,
    ])
  ).rows[0].booking_id;
  await db.query("INSERT INTO contract_drafts VALUES($1,$2,$3,1,$4::jsonb)", [
    draft,
    args.organizationId,
    booking,
    JSON.stringify({
      contract: {
        organizationId: args.organizationId,
        bookingId: booking,
        eventStartDate: "2028-07-23",
      },
    }),
  ]);
  const intent: ActionIntent = {
    ...s.intent,
    id: randomUUID(),
    kind: "generate_contract_pdf",
    targetId: draft,
    expectedRevision: "1",
    arguments: { organizationId: args.organizationId, eventYear: 2027 },
  };
  s.context.grants = [
    {
      actorId: "owner",
      sourceMessageId: intent.sourceMessageId,
      actionKind: intent.kind,
      targetIds: [draft],
      revision: "1",
      connectionId: null,
    },
  ];
  await expect(s.executor.execute(s.context, intent)).rejects.toThrow(
    "ASSISTANT_CONTRACT_CONTEXT_MISMATCH",
  );
});
it("reads canonical event-year invoice facts using the production SQL", async () => {
  const s = await setup();
  await db.exec(`CREATE TABLE contract_versions(id uuid,booking_id uuid,organization_id uuid,status text,version_number integer,snapshot jsonb,updated_at timestamptz,superseding_version_id uuid);
 CREATE TABLE contract_files(id uuid,contract_version_id uuid,kind text,confirmed_at timestamptz,revision integer,original_filename text,sha256_hex text);
 CREATE TABLE contract_agreements(id uuid,booking_id uuid,organization_id uuid,state text,updated_at timestamptz,completed_at timestamptz,replaced_agreement_id uuid);`);
  const result = await readCommercialRecords(db, s.context, {
    organizationId: (s.intent.arguments as any).organizationId,
    eventYear: 2027,
  });
  expect(result.status).toBe("ok");
  expect((result.data as any).totals).toEqual({
    outstandingCents: 765000,
    depositRemainingCents: 382500,
    recordedPaidCents: 0,
  });
  expect((result.data as any).invoices[0].revision).toBe(
    s.intent.expectedRevision,
  );
});

it("previews the exact invoice revision and rejects stale financial previews", async () => {
  const s = await setup();
  const preview = await commercialActionPreview(db, s.context, s.intent);
  expect(preview).toMatchObject({
    available: true,
    title: "Payment · TEST-2027-001",
    revision: s.intent.expectedRevision,
  });
  expect(preview?.summary).toContain("Recorded payments: $0.00 → $3,825.00");
  expect(preview?.summary).toContain("Balance: $7,650.00 → $3,825.00");
  expect(
    (
      await commercialActionPreview(db, s.context, {
        ...s.intent,
        expectedRevision: "stale",
      })
    )?.available,
  ).toBe(false);
});
it("blocks current draft reads across bookings and event years for the same customer", async () => {
  const s = await setup(),
    draft = randomUUID(),
    args: any = s.intent.arguments;
  const booking = (
    await db.query<any>("SELECT booking_id FROM invoices WHERE id=$1", [
      s.invoice,
    ])
  ).rows[0].booking_id;
  await db.exec(
    "CREATE TABLE contract_drafts(id uuid,organization_id uuid,booking_id uuid,revision integer,values jsonb)",
  );
  await db.query("INSERT INTO contract_drafts VALUES($1,$2,$3,1,'{}')", [
    draft,
    args.organizationId,
    booking,
  ]);
  s.context.selection.bookingId = randomUUID();
  expect((await readCurrentContractDraft(db, s.context, draft)).code).toBe(
    "ASSISTANT_BOOKING_MISMATCH",
  );
  s.context.selection.bookingId = booking;
  s.context.selection.eventYear = 2028;
  expect((await readCurrentContractDraft(db, s.context, draft)).code).toBe(
    "ASSISTANT_EVENT_YEAR_MISMATCH",
  );
  s.context.selection.eventYear = 2027;
  expect((await readCurrentContractDraft(db, s.context, draft)).status).toBe(
    "ok",
  );
});
