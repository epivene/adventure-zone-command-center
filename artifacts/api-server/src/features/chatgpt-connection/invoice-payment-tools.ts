import { randomUUID } from "node:crypto";
import { z } from "zod";
import { nextStatus } from "../invoices/invoice-calculations";
import { BusinessDocumentStorage } from "../business-documents/business-document-storage";
import { activeConnection, ConnectionError, inputHash, requireConnectionScope, type ConnectionDatabase, type ConnectionPrincipal, type MutationKey, type SqlQuery } from "./contracts";
import { OperationStore } from "./operation-store";

const identity = z.object({ profileId: z.string().uuid(), invoiceId: z.string().uuid() }).strict();
export const recordPaymentInput = identity.extend({
  expectedRevision: z.string().length(64),
  amountCents: z.number().int().positive().max(2147483647),
  receivedDate: z.string().date(),
  method: z.enum(["check", "cash", "bank_transfer", "card", "other"]),
  reference: z.string().trim().min(1).max(100).regex(/^[^\r\n]+$/),
  notes: z.string().trim().min(1).max(700),
}).strict();
export const uploadPaymentImageInput = identity.extend({
  paymentId: z.string().uuid(),
  filename: z.string().trim().min(1).max(180).regex(/^[^/\\\x00-\x1f]+\.(png|jpe?g)$/i),
  mimeType: z.enum(["image/png", "image/jpeg"]),
  // Four MiB decoded; never take a filesystem path or fetch an arbitrary URL.
  base64: z.string().min(4).max(5592408),
}).strict();

export function paymentImageBytes(input: z.infer<typeof uploadPaymentImageInput>) {
  if (input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))
    throw new ConnectionError("PAYMENT_IMAGE_INVALID");
  const bytes = Buffer.from(input.base64, "base64");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!bytes.length || bytes.length > 4 * 1024 * 1024 || bytes.toString("base64") !== input.base64 ||
    (input.mimeType === "image/png" ? !png || !/\.png$/i.test(input.filename) : !jpeg || !/\.jpe?g$/i.test(input.filename)))
    throw new ConnectionError("PAYMENT_IMAGE_INVALID");
  return bytes;
}

async function invoiceState(tx: SqlQuery, input: z.infer<typeof identity>, lock = false) {
  const invoice = (await tx.query(`SELECT i.* FROM invoices i JOIN organizations o ON o.id=i.organization_id
    WHERE i.id=$1 AND i.organization_id=$2 AND o.consolidated_into_id IS NULL${lock ? " FOR UPDATE OF i" : ""}`,
  [input.invoiceId, input.profileId])).rows[0];
  if (!invoice) throw new ConnectionError("INVOICE_PROFILE_MISMATCH", 404);
  const payments = (await tx.query("SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY id", [input.invoiceId])).rows;
  // Hash the full ledger, including voids; a timestamp alone misses concurrent payment edits.
  const serialized: {invoice:Record<string,any>;payments:Record<string,any>[]} = JSON.parse(JSON.stringify({invoice,payments}));
  return { ...serialized, revision: inputHash(serialized) };
}
function actor(p: ConnectionPrincipal) { return `chatgpt:${p.ownerId}:${p.connectionId}`; }
async function receipt(tx: SqlQuery, profileId: string, recordId: string, value: unknown) {
  const savedAt = new Date((await tx.query("SELECT now() AS saved_at")).rows[0].saved_at).toISOString();
  const serialized=JSON.parse(JSON.stringify(value));
  return { operationId: randomUUID(), recordId, href: `/profiles/${profileId}`, revision: inputHash(serialized), savedAt, value:serialized };
}

export class ConnectionInvoicePayments {
  constructor(private db: ConnectionDatabase, private storage: Pick<BusinessDocumentStorage, "putIfAbsent"> = new BusinessDocumentStorage()) {}

  async read(p: ConnectionPrincipal, raw: z.infer<typeof identity>) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    const input = identity.parse(raw);
    const state = await invoiceState(this.db, input);
    const images = (await this.db.query(`SELECT d.id,d.display_name,s.metadata FROM business_document_sources s
      JOIN business_documents d ON d.id=s.document_id WHERE s.source_kind='manual'
      AND s.source_account_key='connector-payment-image' AND s.metadata->>'invoiceId'=$1
      AND d.lifecycle='active' ORDER BY d.created_at`, [input.invoiceId])).rows;
    return { ...state, images, bankClearance: "not_tracked", instruction: "Payments record receipt, not bank clearance. Verify invoice/profile and existing payments before recording. No reminder is completed." };
  }

  async record(p: ConnectionPrincipal, key: MutationKey, raw: z.infer<typeof recordPaymentInput>) {
    requireConnectionScope(p, "crm:append");
    const input = recordPaymentInput.parse(raw);
    return new OperationStore(this.db).perform(p, "record_invoice_payment", key, input, async tx => {
      const state = await invoiceState(tx, input, true);
      if (state.revision !== input.expectedRevision) throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      if (["cancelled", "draft"].includes(state.invoice.status)) throw new ConnectionError("INVOICE_PAYMENT_STATUS_BLOCKED", 409);
      // Conservative cross-client duplicate guard, including older app-entered payments.
      if (state.payments.some(row => !row.voided_at && row.amount_cents === input.amountCents &&
        String(row.received_date).slice(0,10) === input.receivedDate))
        throw new ConnectionError("INVOICE_PAYMENT_DUPLICATE_CANDIDATE", 409);
      const reference = `Reference: ${input.reference}`;
      if (state.payments.some(row => !row.voided_at && row.method === input.method &&
        String(row.notes ?? "").split("\n").includes(reference)))
        throw new ConnectionError("INVOICE_PAYMENT_DUPLICATE_CANDIDATE", 409);
      const id = randomUUID();
      const payment = (await tx.query(`INSERT INTO invoice_payments(id,invoice_id,amount_cents,received_date,method,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [id,input.invoiceId,input.amountCents,input.receivedDate,input.method,
        `${reference}\n${input.notes}\nReceipt recorded; bank clearance not verified.`,actor(p)])).rows[0];
      const status = nextStatus({ status:state.invoice.status, totalCents:state.invoice.total_cents, depositCents:state.invoice.deposit_cents,
        depositDueDate:state.invoice.deposit_due_date??null,balanceDueDate:state.invoice.balance_due_date??null },
        [...state.payments,payment].map(row => ({amountCents:row.amount_cents,voidedAt:row.voided_at})));
      await tx.query("UPDATE invoices SET status=$2,paid_at=CASE WHEN $2='paid' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1", [input.invoiceId,status]);
      await tx.query(`INSERT INTO audit_entries(entity_type,entity_id,action,"before","after") VALUES('invoice_payment',$1,'created',NULL,$2::jsonb)`, [id,JSON.stringify(payment)]);
      return receipt(tx,input.profileId,id,{payment,invoiceId:input.invoiceId,status,bankClearance:"not_verified"});
    });
  }

  async upload(p: ConnectionPrincipal, key: MutationKey, raw: z.infer<typeof uploadPaymentImageInput>) {
    requireConnectionScope(p, "crm:append");
    const input = uploadPaymentImageInput.parse(raw);
    const bytes = paymentImageBytes(input);
    await activeConnection(this.db,p);
    const preflight = await invoiceState(this.db,input);
    if (!preflight.payments.some(row => row.id === input.paymentId && !row.voided_at)) throw new ConnectionError("INVOICE_PAYMENT_UNAVAILABLE",404);
    // No DB transaction/lock is held during cloud storage. Content-addressed blobs
    // are private and reusable after a retry; never delete a shared blob on failure.
    const blob = await this.storage.putIfAbsent(bytes,input.mimeType);
    const {base64: _bytes,...metadata} = input;
    return new OperationStore(this.db).perform(p,"upload_payment_image",key,{...metadata,sha256:blob.sha256Hex},async tx => {
      const state = await invoiceState(tx,input,true);
      if (!state.payments.some(row => row.id === input.paymentId && !row.voided_at)) throw new ConnectionError("INVOICE_PAYMENT_UNAVAILABLE",404);
      const externalId = `${input.invoiceId}:${input.paymentId}:${blob.sha256Hex}`;
      const prior = (await tx.query(`SELECT document_id FROM business_document_sources WHERE source_kind='manual'
        AND source_account_key='connector-payment-image' AND external_id=$1`,[externalId])).rows[0];
      if (prior) return receipt(tx,input.profileId,prior.document_id,{documentId:prior.document_id,paymentId:input.paymentId,created:false});
      const inserted = (await tx.query(`INSERT INTO business_document_blobs(sha256_hex,storage_key,mime_type,size_bytes) VALUES($1,$2,$3,$4)
        ON CONFLICT(sha256_hex) DO NOTHING RETURNING id`,[blob.sha256Hex,blob.storageKey,blob.mimeType,blob.sizeBytes])).rows[0];
      const stored = inserted ?? (await tx.query("SELECT id FROM business_document_blobs WHERE sha256_hex=$1 AND validation_state='accepted'",[blob.sha256Hex])).rows[0];
      if (!stored) throw new ConnectionError("PAYMENT_IMAGE_QUARANTINED",409);
      const documentId=randomUUID(),versionId=randomUUID();
      await tx.query(`INSERT INTO business_documents(id,display_name,original_filename,category,review_state,visibility,notes,created_by)
        VALUES($1,$2,$3,'deposit_receipt','accepted','owner',$4,$5)`,[documentId,`${state.invoice.invoice_number} — payment receipt`,input.filename,
        `Invoice ${state.invoice.invoice_number}; payment ${input.paymentId}. Receipt image; not evidence of bank clearance.`,actor(p)]);
      await tx.query("INSERT INTO business_document_versions(id,document_id,blob_id,version_number,original_filename,created_by) VALUES($1,$2,$3,1,$4,$5)",[versionId,documentId,stored.id,input.filename,actor(p)]);
      await tx.query("UPDATE business_documents SET current_version_id=$2 WHERE id=$1",[documentId,versionId]);
      await tx.query(`INSERT INTO business_document_links(document_id,target_kind,organization_id,confirmation_mode,created_by)
        VALUES($1,'profile',$2,'manual',$3)`,[documentId,input.profileId,actor(p)]);
      await tx.query(`INSERT INTO business_document_sources(document_id,source_kind,source_account_key,external_id,metadata)
        VALUES($1,'manual','connector-payment-image',$2,$3::jsonb)`,[documentId,externalId,JSON.stringify({...metadata,connectionId:p.connectionId,sha256:blob.sha256Hex})]);
      await tx.query("INSERT INTO business_document_audit_events(document_id,action,actor,metadata) VALUES($1,'payment_receipt_uploaded',$2,$3::jsonb)",[documentId,actor(p),JSON.stringify({invoiceId:input.invoiceId,paymentId:input.paymentId})]);
      return receipt(tx,input.profileId,documentId,{documentId,paymentId:input.paymentId,sha256:blob.sha256Hex,sizeBytes:blob.sizeBytes,created:true});
    });
  }
}

export function invoicePaymentTools(s: ConnectionInvoicePayments | undefined,p:ConnectionPrincipal) {
  const service=()=>{if(!s)throw new Error("INVOICE_PAYMENTS_UNAVAILABLE");return s;};
  const requestKey=z.string().trim().min(1).max(200);
  return [
    {name:"read_invoice_payment_context",scope:"crm:read" as const,readOnly:true,schema:identity,
      description:"Read one profile-matched invoice, all payments and attached receipt images, with exact ledger revision. Use list_app_records section=invoices to find IDs. Receipt is not bank clearance. No writes.",call:(a:any)=>service().read(p,a)},
    {name:"record_invoice_payment",scope:"crm:append" as const,readOnly:false,schema:recordPaymentInput.extend({requestKey}).strict(),
      description:"Record an owner-authorized received invoice payment in cents. First read_invoice_payment_context and verify profile, invoice, amount, receipt date, method, check/reference and prior ledger; supply expectedRevision. Reuse requestKey for identical retries. Records receipt only, never bank clearance or movement of money. Updates invoice paid/deposit balance through existing calculations; never completes reminders, changes rules, sends mail, or deletes history. Duplicate candidates and stale revisions require review, not a new retry key.",
      call:({requestKey,...a}:any)=>service().record(p,{requestKey},a)},
    {name:"upload_payment_image",scope:"crm:append" as const,readOnly:false,schema:uploadPaymentImageInput.extend({requestKey}).strict(),
      description:"Attach the owner's actual PNG/JPEG check/receipt image (up to 4 MiB) to an existing profile-matched invoice payment, in the private owner-only document library. Supply exact file bytes as canonical base64 from an accessible attachment, never recreate an image or infer bytes. If the client cannot access/transfer attachment bytes, request the original file or use the app's upload UI; do not claim upload. Same requestKey/content retries are safe. Retains originals; no email, bank clearance, reminder completion, or external URL fetching.",
      call:({requestKey,...a}:any)=>service().upload(p,{requestKey},a)},
  ];
}
