import { summarizeInvoice } from "../invoices/invoice-calculations";
import type {
  InvoiceCalculationSource,
  InvoicePaymentSource,
} from "../invoices/invoice-types";
import type { Queryable, RunContext, ToolResult } from "./contracts";
import { result, blocked } from "./read-tools";
import { fingerprint } from "./action-store";
export type CommercialInvoice = InvoiceCalculationSource & {
  id: string;
  eventYear: number | null;
  payments: InvoicePaymentSource[];
  [key: string]: unknown;
};
export type CommercialContract = {
  id: string;
  eventYear: number | null;
  status: string;
  files: { kind: string; confirmedAt: string | null }[];
  [key: string]: unknown;
};
export function summarizeCommercialRecords(
  input: {
    eventYear: number;
    invoices: CommercialInvoice[];
    contracts: CommercialContract[];
  },
  today: Date,
) {
  const invoices = input.invoices
    .filter((i) => i.eventYear === input.eventYear)
    .map((i) => ({ ...i, ...summarizeInvoice(i, i.payments, today) }));
  const contracts = input.contracts
    .filter((c) => c.eventYear === input.eventYear)
    .map((c) => ({
      ...c,
      execution: [
        "superseded",
        "replaced",
        "cancelled",
        "declined",
        "expired",
      ].includes(c.status)
        ? "historical"
        : c.status === "completed"
          ? "recorded_complete"
          : "unconfirmed",
    }));
  const issued = invoices.filter(
    (i) => !["draft", "cancelled"].includes(i.status),
  );
  return {
    eventYear: input.eventYear,
    invoices,
    contracts,
    totals: {
      outstandingCents: issued.reduce((s, i) => s + i.remainingCents, 0),
      depositRemainingCents: issued.reduce(
        (s, i) => s + Math.max(0, i.depositCents - i.paidCents),
        0,
      ),
      recordedPaidCents: invoices.reduce((s, i) => s + i.paidCents, 0),
    },
    unclassified: {
      invoices: input.invoices.filter((i) => i.eventYear === null),
      contracts: input.contracts.filter((c) => c.eventYear === null),
    },
    historicalCount: [...input.invoices, ...input.contracts].filter(
      (i) => i.eventYear !== null && i.eventYear !== input.eventYear,
    ).length,
    limitations: [
      "Invoice amounts and due dates are not evidence that payment was received.",
      "Signature marks and uploaded signed files do not confirm execution until the canonical contract workflow records completion.",
      "Sample COIs do not prove current event-specific coverage.",
    ],
  };
}
export async function readCommercialRecords(
  db: Queryable,
  context: RunContext,
  input: { organizationId: string; eventYear: number },
): Promise<ToolResult> {
  if (!context.selection.organizationIds.includes(input.organizationId))
    return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
  const profile = (
    await db.query(
      "SELECT id,name FROM organizations WHERE id=$1 AND consolidated_into_id IS NULL",
      [input.organizationId],
    )
  ).rows[0];
  if (!profile) return blocked("ASSISTANT_PROFILE_NOT_FOUND");
  const invoices = (
    await db.query(
      `SELECT i.id,i.booking_id AS "bookingId",i.invoice_number AS "invoiceNumber",i.document_id AS "documentId",i.status,i.total_cents AS "totalCents",i.deposit_cents AS "depositCents",i.deposit_due_date::text AS "depositDueDate",i.balance_due_date::text AS "balanceDueDate",i.updated_at AS "updatedAt",(SELECT CASE WHEN count(DISTINCT event_year)=1 THEN min(event_year) ELSE NULL END FROM booking_opportunities o WHERE o.booking_id=i.booking_id AND o.organization_id=i.organization_id) AS "eventYear",coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'amountCents',p.amount_cents,'receivedDate',p.received_date,'voidedAt',p.voided_at,'method',p.method) ORDER BY p.received_date,p.id) FROM invoice_payments p WHERE p.invoice_id=i.id),'[]'::jsonb) AS payments FROM invoices i WHERE organization_id=$1 ORDER BY i.updated_at DESC,i.id LIMIT 201`,
      [input.organizationId],
    )
  ).rows as CommercialInvoice[];
  const contracts = (
    await db.query(
      `SELECT v.id,v.booking_id AS "bookingId",v.status,v.version_number AS "versionNumber",v.snapshot,v.updated_at AS "updatedAt",v.superseding_version_id AS "supersedingVersionId",(SELECT CASE WHEN count(DISTINCT event_year)=1 THEN min(event_year) ELSE NULL END FROM booking_opportunities o WHERE o.booking_id=v.booking_id AND o.organization_id=v.organization_id) AS "eventYear",coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'confirmedAt',f.confirmed_at,'revision',f.revision,'filename',f.original_filename,'sha256',f.sha256_hex) ORDER BY f.revision) FROM contract_files f WHERE f.contract_version_id=v.id),'[]'::jsonb) AS files FROM contract_versions v WHERE v.organization_id=$1 ORDER BY v.updated_at DESC,v.id LIMIT 201`,
      [input.organizationId],
    )
  ).rows as CommercialContract[];
  const agreements = (
    await db.query(
      `SELECT a.id,a.booking_id AS "bookingId",a.state AS status,a.updated_at AS "updatedAt",a.completed_at AS "completedAt",a.replaced_agreement_id AS "replacedAgreementId",(SELECT CASE WHEN count(DISTINCT event_year)=1 THEN min(event_year) ELSE NULL END FROM booking_opportunities o WHERE o.booking_id=a.booking_id AND o.organization_id=a.organization_id) AS "eventYear",'[]'::jsonb AS files FROM contract_agreements a WHERE a.organization_id=$1 ORDER BY a.updated_at DESC,a.id LIMIT 201`,
      [input.organizationId],
    )
  ).rows as CommercialContract[];
  if ([invoices, contracts, agreements].some((rows) => rows.length > 200))
    return {
      ...blocked("ASSISTANT_COMMERCIAL_HISTORY_LIMIT"),
      data: { organizationId: input.organizationId, complete: false },
    };
  for (const record of [...invoices, ...contracts, ...agreements])
    record.revision = new Date(record.updatedAt as string).toISOString();
  const data = {
    view: "commercial_records",
    scope:
      "All bookings for this customer in the stated event year; not limited to the selected booking.",
    profile,
    ...summarizeCommercialRecords(
      {
        eventYear: input.eventYear,
        invoices,
        contracts: [...contracts, ...agreements],
      },
      new Date(),
    ),
  };
  const unknown =
    data.unclassified.invoices.length + data.unclassified.contracts.length;
  return {
    ...result(data, [
      {
        id: input.organizationId + ":commercial",
        kind: "profile",
        recordId: input.organizationId,
        eventYear: input.eventYear,
        occurredAt: null,
        retrievedAt: new Date().toISOString(),
        version: fingerprint(data),
        complete: unknown === 0,
        text: JSON.stringify(data),
      },
    ]),
    status: unknown ? "partial" : "ok",
    code: unknown ? "ASSISTANT_EVENT_YEAR_UNCLASSIFIED" : null,
  };
}
