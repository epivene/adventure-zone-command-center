import { summarizeInvoice } from "../invoices/invoice-calculations";
import { sql } from "drizzle-orm";
import type { db as Database } from "@workspace/db";
import { officeAccounts } from "@workspace/db";
import { instantiateTemplate } from "../design-studio/template-instantiation-service";
import { ContractDraftService } from "../contracts/contract-draft-service";
import { DrizzleContractRepository } from "../contracts/contract-repository";
import { DrizzleContractSourceRepository } from "../contracts/contract-source-repository";
import { contractTemplateV1 } from "../contracts/contract-template-v1";
import { generateContractPdf } from "../contracts/contract-pdf-service";
import {
  ContractFileService,
  DrizzleContractFileMetadataStore,
} from "../contracts/contract-file-service";
import { GoogleCloudSourceDocumentObjectStorage } from "../business-sources/source-document-storage";
import {
  ContractLifecycleService,
  DrizzleContractLifecycleRepository,
} from "../contracts/contract-lifecycle-service";
import { InvoiceService } from "../invoices/invoice-service";
import { DrizzleInvoiceRepository } from "../invoices/invoice-repository";
import { isContractBuilderEnabled } from "../contracts/contract-feature-enabled";
import type { MutationAdapter } from "./action-executor";
import type {
  Queryable,
  ActionIntent,
  RunContext,
  ToolResult,
} from "./contracts";
import {
  commercialActionSchemas,
  parseCommercialAction,
  assertCommercialScope,
  type CommercialKind,
} from "./commercial-actions";
import { validateContractValues } from "../contracts/contract-validation";
import { fingerprint } from "./action-store";
const ownerStudioId = "0f17d4fb-b04f-4dda-907c-494b1aeb8881";
export const recordRevision = (row: any) =>
  row.revision != null
    ? String(row.revision)
    : new Date(row.updated_at ?? row.updatedAt).toISOString();
import { transactionQueries } from "./transaction-queries";
export { transactionQueries } from "./transaction-queries";
async function target(
  q: Queryable,
  context: RunContext,
  i: ActionIntent,
  lock = false,
) {
  const kind = i.kind as CommercialKind,
    args: any = parseCommercialAction(kind, i.arguments);
  if (context.actor.role !== "owner" || context.actor.id !== i.actorId)
    throw new Error("ASSISTANT_ACCESS_DENIED");
  if (kind.includes("contract") && !isContractBuilderEnabled())
    throw new Error("ASSISTANT_CONTRACT_BUILDER_DISABLED");
  const table =
    kind === "create_template_document"
      ? "design_templates"
      : kind === "start_contract_draft"
        ? "bookings"
        : kind === "register_invoice"
          ? "business_documents"
          : kind === "record_invoice_payment"
            ? "invoices"
            : kind === "confirm_signed_contract"
              ? "contract_versions"
              : "contract_drafts";
  const row = (
    await q.query(
      `SELECT * FROM ${table} WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [i.targetId],
    )
  ).rows[0];
  if (!row) throw new Error("ASSISTANT_RECORD_NOT_FOUND");
  if (!i.expectedRevision || recordRevision(row) !== i.expectedRevision)
    throw new Error("ASSISTANT_VERSION_CONFLICT");
  let bookingId = row.booking_id ?? args.bookingId ?? null;
  if (kind === "start_contract_draft") {
    if (i.targetId !== args.bookingId)
      throw new Error("ASSISTANT_BOOKING_MISMATCH");
    bookingId = i.targetId;
  }
  if (
    kind === "create_template_document" &&
    (i.targetId !== args.templateId ||
      row.state !== "active" ||
      !row.is_approved ||
      !["proposal", "contract", "blank", "brochure"].includes(row.type))
  )
    throw new Error("ASSISTANT_APPROVED_DOCUMENT_TEMPLATE_REQUIRED");
  const org =
    kind === "create_template_document" || kind === "register_invoice"
      ? args.organizationId
      : row.organization_id;
  let eventYear = args.eventYear;
  if (bookingId) {
    const booking = (
      await q.query(
        `SELECT b.organization_id,(SELECT CASE WHEN count(DISTINCT o.event_year)=1 THEN min(o.event_year) ELSE NULL END FROM booking_opportunities o WHERE o.booking_id=b.id AND o.organization_id=b.organization_id) AS event_year FROM bookings b WHERE b.id=$1`,
        [bookingId],
      )
    ).rows[0];
    if (!booking || booking.organization_id !== org)
      throw new Error("ASSISTANT_BOOKING_MISMATCH");
    eventYear = booking.event_year;
  } else if (kind !== "create_template_document")
    throw new Error("ASSISTANT_BOOKING_REQUIRED");
  if (context.selection.bookingId && bookingId !== context.selection.bookingId)
    throw new Error("ASSISTANT_BOOKING_MISMATCH");
  assertCommercialScope(
    context.selection,
    { organization_id: org, event_year: eventYear },
    args,
  );
  if (
    !(
      await q.query(
        "SELECT id FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",
        [org],
      )
    ).rows.length
  )
    throw new Error("ASSISTANT_PROFILE_NOT_FOUND");
  if (kind === "register_invoice") {
    if (
      i.targetId !== args.documentId ||
      row.category !== "invoice" ||
      row.lifecycle !== "active"
    )
      throw new Error("ASSISTANT_INVOICE_DOCUMENT_REQUIRED");
    if (
      !(
        await q.query(
          "SELECT id FROM business_document_links WHERE document_id=$1 AND (organization_id=$2 OR booking_id=$3)",
          [i.targetId, args.organizationId, bookingId],
        )
      ).rows.length
    )
      throw new Error("ASSISTANT_DOCUMENT_PROFILE_MISMATCH");
  }
  if (kind === "save_contract_draft" || kind === "generate_contract_pdf") {
    const values =
      kind === "save_contract_draft" ? args.values : row.values?.contract;
    if (
      !values ||
      values.organizationId !== org ||
      values.bookingId !== bookingId ||
      Number(String(values.eventStartDate).slice(0, 4)) !== args.eventYear
    )
      throw new Error("ASSISTANT_CONTRACT_CONTEXT_MISMATCH");
    if (!validateContractValues(values).ready)
      throw new Error("ASSISTANT_CONTRACT_FIELDS_INVALID");
  }
  if (kind === "save_contract_draft" || kind === "generate_contract_pdf") {
    if (row.finalized_at)
      throw new Error("ASSISTANT_CONTRACT_ALREADY_FINALIZED");
    const t = (
      await q.query("SELECT * FROM contract_templates WHERE id=$1", [
        row.template_id,
      ])
    ).rows[0];
    if (!t || t.state !== "active" || t.version !== contractTemplateV1.version)
      throw new Error("ASSISTANT_CURRENT_TEMPLATE_REQUIRED");
  }
  if (kind === "record_invoice_payment") {
    if (["draft", "cancelled"].includes(row.status))
      throw new Error("ASSISTANT_INVOICE_NOT_ISSUED");
    if (args.receivedDate > new Date().toISOString().slice(0, 10))
      throw new Error("ASSISTANT_PAYMENT_DATE_IN_FUTURE");
    const reference = `[assistant-receipt:${fingerprint(args.receiptReference.trim().toLowerCase())}]`;
    if (
      (
        await q.query(
          "SELECT id FROM invoice_payments WHERE invoice_id=$1 AND notes LIKE $2 AND voided_at IS NULL",
          [i.targetId, `%${reference}%`],
        )
      ).rows.length
    )
      throw new Error("ASSISTANT_PAYMENT_ALREADY_RECORDED");
  }
  if (kind === "confirm_signed_contract") {
    if (!["sent_for_signature", "partially_signed"].includes(row.status))
      throw new Error("ASSISTANT_CONTRACT_COMPLETION_INVALID");
    const file = (
      await q.query(
        "SELECT * FROM contract_files WHERE id=$1 AND contract_version_id=$2 AND kind='signed_completed'",
        [args.fileId, i.targetId],
      )
    ).rows[0];
    if (!file || file.sha256_hex !== args.fileSha256 || file.confirmed_at)
      throw new Error("ASSISTANT_SIGNED_FILE_CHANGED");
  }
  return { args, row, bookingId };
}
export async function commercialActionPreview(
  read: Queryable,
  context: RunContext,
  intent: ActionIntent,
) {
  if (!(intent.kind in commercialActionSchemas)) return null;
  try {
    const { row, args, bookingId } = await target(read, context, intent);
    const profile = (
      await read.query("SELECT name FROM organizations WHERE id=$1", [
        args.organizationId,
      ])
    ).rows[0];
    const money = (cents: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
    let title = intent.kind.replaceAll("_", " "),
      summary = `${profile.name} · Event year ${args.eventYear}${bookingId ? ` · Booking ${bookingId}` : ""}`,
      reviewHref = `/profiles/${args.organizationId}`;
    if (intent.kind === "record_invoice_payment") {
      const payments = (
        await read.query(
          'SELECT amount_cents AS "amountCents",voided_at AS "voidedAt" FROM invoice_payments WHERE invoice_id=$1',
          [intent.targetId],
        )
      ).rows;
      const invoice = {
        status: row.status,
        totalCents: row.total_cents,
        depositCents: row.deposit_cents,
        depositDueDate:
          row.deposit_due_date instanceof Date
            ? row.deposit_due_date.toISOString().slice(0, 10)
            : row.deposit_due_date,
        balanceDueDate:
          row.balance_due_date instanceof Date
            ? row.balance_due_date.toISOString().slice(0, 10)
            : row.balance_due_date,
      };
      const before = summarizeInvoice(invoice, payments, new Date());
      const after = summarizeInvoice(
        invoice,
        [...payments, { amountCents: args.amountCents, voidedAt: null }],
        new Date(),
      );
      title = `Payment · ${row.invoice_number}`;
      summary += `\nRecorded payments: ${money(before.paidCents)} → ${money(after.paidCents)}\nBalance: ${money(before.remainingCents)} → ${money(after.remainingCents)}\nStatus: ${before.effectiveStatus} → ${after.effectiveStatus}`;
    } else if (intent.kind === "confirm_signed_contract") {
      const file = (
        await read.query(
          "SELECT original_filename,revision FROM contract_files WHERE id=$1",
          [args.fileId],
        )
      ).rows[0];
      title = `Confirm contract version ${row.version_number}`;
      summary += `\nFile: ${file.original_filename} · Signed file revision ${file.revision}\nStatus: ${row.status} → completed\nSHA-256: ${args.fileSha256}`;
      reviewHref = `/contracts/${intent.targetId}/handoff`;
    } else if (
      ["save_contract_draft", "generate_contract_pdf"].includes(intent.kind)
    )
      reviewHref = `/contracts/drafts/${intent.targetId}`;
    return {
      available: true,
      title,
      summary,
      reviewHref,
      revision: intent.expectedRevision,
    };
  } catch {
    return {
      available: false,
      title: "Action needs refreshed information",
      summary:
        "The record or selected context changed, or required information is missing. Ask the assistant to prepare a new action.",
      reviewHref: null,
      revision: intent.expectedRevision,
    };
  }
}
export function commercialAdapters(
  database: typeof Database,
  read: Queryable,
): Record<string, MutationAdapter> {
  const adapters: Record<string, MutationAdapter> = {};
  for (const kind of Object.keys(commercialActionSchemas) as CommercialKind[]) {
    adapters[kind] = {
      validate: async (c, i) => {
        await target(read, c, i);
      },
      reconcile: async (c, i) => {
        const r = (
          await read.query(
            "SELECT result FROM assistant_workspace_mutation_results WHERE action_id=$1 AND actor_id=$2",
            [i.id, c.actor.id],
          )
        ).rows[0];
        return (
          r?.result ?? {
            status: "uncertain",
            data: { actionId: i.id },
            evidence: [],
            receipts: [],
            code: "ASSISTANT_ACTION_RECONCILIATION_REQUIRED",
          }
        );
      },
      apply: async (c, i) => {
        if (kind === "confirm_signed_contract") {
          let output: ToolResult | undefined;
          const repository = new DrizzleContractLifecycleRepository(
            database,
            async (tx, work) => {
              const q = transactionQueries(tx);
              await q.query(
                "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
                [i.id],
              );
              const prior = (
                await q.query(
                  "SELECT result FROM assistant_workspace_mutation_results WHERE action_id=$1 AND actor_id=$2",
                  [i.id, c.actor.id],
                )
              ).rows[0];
              if (prior) {
                output = prior.result;
                return prior.result.data.record;
              }
              const { args } = await target(q, c, i, true);
              if (c.signal.aborted) throw new Error("ASSISTANT_CANCELLED");
              const saved = await work();
              output = {
                status: "ok",
                data: {
                  record: saved,
                  organizationId: args.organizationId,
                  eventYear: args.eventYear,
                },
                evidence: [],
                receipts: [
                  {
                    kind,
                    id: i.targetId,
                    href: `/contracts/${i.targetId}/handoff`,
                    verifiedAt: new Date().toISOString(),
                  },
                ],
                code: null,
              };
              await q.query(
                "INSERT INTO assistant_workspace_mutation_results(action_id,actor_id,result) VALUES($1,$2,$3::jsonb)",
                [i.id, c.actor.id, JSON.stringify(output)],
              );
              return saved;
            },
          );
          const args: any = parseCommercialAction(kind, i.arguments);
          await new ContractLifecycleService(repository).confirmSignedFile({
            contractVersionId: i.targetId,
            fileId: args.fileId,
            actorId: c.actor.id,
          });
          if (!output) throw new Error("ASSISTANT_RECEIPT_MISSING");
          return output;
        }
        return database.transaction(async (tx) => {
          const q = transactionQueries(tx);
          await q.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [i.id],
          );
          const prior = (
            await q.query(
              "SELECT result FROM assistant_workspace_mutation_results WHERE action_id=$1 AND actor_id=$2",
              [i.id, c.actor.id],
            )
          ).rows[0];
          if (prior) return prior.result as ToolResult;
          const { args, row } = await target(q, c, i, true);
          if (c.signal.aborted) throw new Error("ASSISTANT_CANCELLED");
          const db = tx as unknown as typeof Database;
          let saved: any,
            href = `/profiles/${args.organizationId}`;
          if (kind === "create_template_document") {
            await tx
              .insert(officeAccounts)
              .values({
                id: ownerStudioId,
                loginName: "__owner_design_studio__",
                displayName: "Adventure Zone Owner",
                role: "office_coordinator",
                passwordHash: "owner-studio-login-disabled",
                passwordSalt: "owner-studio-login-disabled",
                enabled: false,
                sessionVersion: 1,
              })
              .onConflictDoNothing();
            saved = await instantiateTemplate(db, {
              accountId: ownerStudioId,
              templateId: args.templateId,
              organizationId: args.organizationId,
              bookingId: args.bookingId,
              documentYear: args.eventYear,
            });
            href = `/design-studio/${saved.id}`;
          } else if (
            kind === "register_invoice" ||
            kind === "record_invoice_payment"
          ) {
            const invoices = new InvoiceService(
              new DrizzleInvoiceRepository(db),
            );
            if (kind === "register_invoice") {
              const { eventYear: _, ...fields } = args;
              saved = await invoices.create(
                { ...fields, status: "draft" },
                c.actor.id,
              );
            } else
              saved = await invoices.recordPayment(
                i.targetId,
                {
                  amountCents: args.amountCents,
                  receivedDate: args.receivedDate,
                  method: args.method,
                  notes: `${args.receiptReference}\n[assistant-receipt:${fingerprint(args.receiptReference.trim().toLowerCase())}]`,
                },
                c.actor.id,
              );
          } else {
            const drafts = new ContractDraftService({
              repository: new DrizzleContractRepository(db),
              sources: new DrizzleContractSourceRepository(db),
              templates: {
                active: async () => {
                  const t = (
                    await q.query(
                      "SELECT * FROM contract_templates WHERE stable_key=$1 AND state='active'",
                      [contractTemplateV1.stableKey],
                    )
                  ).rows[0];
                  if (!t || t.version !== contractTemplateV1.version)
                    throw new Error("ASSISTANT_CURRENT_TEMPLATE_REQUIRED");
                  return {
                    ...contractTemplateV1,
                    id: t.id,
                    state: "active" as const,
                  };
                },
              },
              generatePdf: generateContractPdf,
              files: new ContractFileService(
                new DrizzleContractFileMetadataStore(db),
                new GoogleCloudSourceDocumentObjectStorage(),
              ),
            });
            if (kind === "start_contract_draft")
              saved = await drafts.start({
                bookingId: args.bookingId,
                actorId: c.actor.id,
              });
            else if (kind === "save_contract_draft")
              saved = await drafts.save({
                draftId: i.targetId,
                expectedRevision: row.revision,
                values: args.values,
                actorId: c.actor.id,
              });
            else
              saved = await drafts.finalize({
                draftId: i.targetId,
                actorId: c.actor.id,
              });
            const draftId =
              saved.draft?.id ??
              (kind === "generate_contract_pdf" ? i.targetId : saved.id);
            href =
              kind === "generate_contract_pdf"
                ? `/contracts/${saved.version.id}/handoff`
                : `/contracts/drafts/${draftId}`;
          }
          const id =
            saved.id ?? saved.draft?.id ?? saved.version?.id ?? i.targetId;
          const output: ToolResult = {
            status: "ok",
            data: {
              record: saved,
              organizationId: args.organizationId,
              eventYear: args.eventYear,
            },
            evidence: [],
            receipts: [
              { kind, id, href, verifiedAt: new Date().toISOString() },
            ],
            code: null,
          };
          await q.query(
            "INSERT INTO assistant_workspace_mutation_results(action_id,actor_id,result) VALUES($1,$2,$3::jsonb)",
            [i.id, c.actor.id, JSON.stringify(output)],
          );
          return output;
        });
      },
    };
  }
  return adapters;
}
