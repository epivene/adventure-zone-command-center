import { afterEach, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { ConnectionInvoicePayments, invoicePaymentTools, paymentImageBytes, uploadPaymentImageInput } from "./invoice-payment-tools";
import type { ConnectionPrincipal } from "./contracts";

let db:PGlite,s:ConnectionInvoicePayments,p:ConnectionPrincipal,profileId:string,invoiceId:string;
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=","base64");
beforeEach(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE TABLE organizations(id uuid PRIMARY KEY,consolidated_into_id uuid);
    CREATE TABLE invoices(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations(id),invoice_number text,status text,total_cents integer,deposit_cents integer,paid_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE invoice_payments(id uuid PRIMARY KEY,invoice_id uuid REFERENCES invoices(id),amount_cents integer,received_date date,method text,notes text,created_by text,created_at timestamptz DEFAULT now(),voided_at timestamptz);
    CREATE TABLE audit_entries(entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);
    CREATE TABLE chatgpt_connections(id uuid PRIMARY KEY,owner_id text,client_id text,scopes jsonb,revoked_at timestamptz,last_used_at timestamptz);
    CREATE TABLE chatgpt_operations(id uuid PRIMARY KEY,connection_id uuid,operation text,request_key text,input_hash text,receipt jsonb,UNIQUE(connection_id,operation,request_key));
    CREATE TABLE business_documents(id uuid PRIMARY KEY,display_name text,original_filename text,category text,review_state text,visibility text,notes text,created_by text,current_version_id uuid,lifecycle text DEFAULT 'active',created_at timestamptz DEFAULT now());
    CREATE TABLE business_document_blobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sha256_hex text UNIQUE,storage_key text,mime_type text,size_bytes integer,validation_state text DEFAULT 'accepted');
    CREATE TABLE business_document_versions(id uuid PRIMARY KEY,document_id uuid REFERENCES business_documents(id),blob_id uuid REFERENCES business_document_blobs(id),version_number integer,original_filename text,created_by text);
    CREATE TABLE business_document_links(document_id uuid REFERENCES business_documents(id),target_kind text,organization_id uuid REFERENCES organizations(id),confirmation_mode text,created_by text);
    CREATE TABLE business_document_sources(document_id uuid REFERENCES business_documents(id),source_kind text,source_account_key text,external_id text,metadata jsonb,UNIQUE(source_kind,source_account_key,external_id));
    CREATE TABLE business_document_audit_events(document_id uuid REFERENCES business_documents(id),action text,actor text,metadata jsonb);
  `);
  profileId=randomUUID();invoiceId=randomUUID();p={ownerId:"owner",clientId:"client",connectionId:randomUUID(),scopes:["crm:read","crm:append"]};
  await db.query("INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,$2,$3,$4)",[p.connectionId,p.ownerId,p.clientId,JSON.stringify(p.scopes)]);
  await db.query("INSERT INTO organizations(id) VALUES($1)",[profileId]);
  await db.query("INSERT INTO invoices(id,organization_id,invoice_number,status,total_cents,deposit_cents) VALUES($1,$2,'TEST-001','deposit_due',576000,288000)",[invoiceId,profileId]);
  s=new ConnectionInvoicePayments(db,{putIfAbsent:async(bytes,mimeType)=>({sha256Hex:createHash("sha256").update(bytes).digest("hex"),storageKey:"private/test",sizeBytes:bytes.length,mimeType})});
});
afterEach(async()=>{await db.close();});
const identity=()=>({profileId,invoiceId});
const input=async()=>({...identity(),expectedRevision:(await s.read(p,identity())).revision,amountCents:288000,receivedDate:"2026-10-16",method:"check" as const,reference:"5238",notes:"Owner confirmed receipt."});
const image=(paymentId:string)=>({...identity(),paymentId,filename:"check.png",mimeType:"image/png" as const,base64:png.toString("base64")});

it("records a deposit atomically, returns a receipt and replays identical requests without duplication",async()=>{
  const a=await input();const result=await s.record(p,{requestKey:"receipt"},a);
  expect(await s.record(p,{requestKey:"receipt"},a)).toEqual(result);
  const state=await s.read(p,identity());
  expect(state.invoice.status).toBe("deposit_paid");expect(state.invoice.paid_at).toBeNull();
  expect(state.payments).toHaveLength(1);expect(state.payments[0].notes).toContain("bank clearance not verified");
  expect((await db.query("SELECT * FROM audit_entries")).rows).toHaveLength(1);
  await expect(s.record(p,{requestKey:"receipt"},{...a,amountCents:1})).rejects.toMatchObject({code:"CONNECTION_REQUEST_CONFLICT"});
});
it("blocks stale reads, wrong profiles, cancelled invoices and duplicate payments under different keys",async()=>{
  const a=await input();await s.record(p,{requestKey:"first"},a);
  await expect(s.record(p,{requestKey:"stale"},a)).rejects.toMatchObject({code:"CONNECTION_STALE_REVISION"});
  await expect(s.record(p,{requestKey:"duplicate"},await input())).rejects.toMatchObject({code:"INVOICE_PAYMENT_DUPLICATE_CANDIDATE"});
  await expect(s.record(p,{requestKey:"wrong"},{...a,profileId:randomUUID()})).rejects.toMatchObject({code:"INVOICE_PROFILE_MISMATCH"});
  await db.query("UPDATE invoices SET status='cancelled'");
  await expect(s.record(p,{requestKey:"cancelled"},await input())).rejects.toMatchObject({code:"INVOICE_PAYMENT_STATUS_BLOCKED"});
  expect((await db.query("SELECT * FROM invoice_payments")).rows).toHaveLength(1);
});
it("rolls back payment, invoice and operation when audit fails",async()=>{
  await db.exec("ALTER TABLE audit_entries ADD CONSTRAINT fail CHECK(action <> 'created')");
  await expect(s.record(p,{requestKey:"fail"},await input())).rejects.toThrow();
  expect((await db.query("SELECT * FROM invoice_payments")).rows).toHaveLength(0);
  expect((await db.query("SELECT * FROM chatgpt_operations")).rows).toHaveLength(0);
  expect((await s.read(p,identity())).invoice.status).toBe("deposit_due");
});
it("attaches a private image without changing the payment; same content is deduplicated across keys",async()=>{
  const payment=await s.record(p,{requestKey:"payment"},await input());
  const before=(await s.read(p,identity())).payments;
  const a=image(payment.recordId);const uploaded=await s.upload(p,{requestKey:"image"},a);
  expect(await s.upload(p,{requestKey:"image"},a)).toEqual(uploaded);
  const duplicate=await s.upload(p,{requestKey:"other"},a);expect(duplicate.recordId).toBe(uploaded.recordId);
  const state=await s.read(p,identity());expect(state.payments).toEqual(before);expect(state.images).toHaveLength(1);
  const document=(await db.query<{visibility:string;category:string}>("SELECT * FROM business_documents")).rows[0];
  expect(document.visibility).toBe("owner");expect(document.category).toBe("deposit_receipt");
  expect((await db.query<{organization_id:string}>("SELECT * FROM business_document_links")).rows[0].organization_id).toBe(profileId);
  expect(JSON.stringify(uploaded)).not.toContain("private/test");expect(JSON.stringify(uploaded)).not.toContain(a.base64);
});
it("rejects missing or voided payments, bad files, revoked connections and missing write scope",async()=>{
  const a=await input();
  await expect(s.record({...p,scopes:["crm:read"]},{requestKey:"scope"},a)).rejects.toMatchObject({status:403});
  await expect(s.upload(p,{requestKey:"missing"},image(randomUUID()))).rejects.toMatchObject({code:"INVOICE_PAYMENT_UNAVAILABLE"});
  expect(()=>paymentImageBytes({...image(randomUUID()),base64:Buffer.from("not an image").toString("base64")})).toThrow();
  expect(()=>uploadPaymentImageInput.parse({...image(randomUUID()),filename:"../check.png"})).toThrow();
  expect(()=>paymentImageBytes({...image(randomUUID()),mimeType:"image/jpeg"})).toThrow();
  const payment=await s.record(p,{requestKey:"pay"},a);await db.query("UPDATE invoice_payments SET voided_at=now()");
  await expect(s.upload(p,{requestKey:"void"},image(payment.recordId))).rejects.toMatchObject({code:"INVOICE_PAYMENT_UNAVAILABLE"});
  await db.query("UPDATE chatgpt_connections SET revoked_at=now()");
  await expect(s.read(p,identity())).rejects.toMatchObject({code:"CONNECTION_REVOKED"});
});
it("storage failure creates no document and does not hold a transaction or change a payment",async()=>{
  const payment=await s.record(p,{requestKey:"pay"},await input());
  const before=(await s.read(p,identity())).payments;
  const broken=new ConnectionInvoicePayments(db,{putIfAbsent:async()=>{throw Error("storage unavailable");}});
  await expect(broken.upload(p,{requestKey:"image"},image(payment.recordId))).rejects.toThrow("storage unavailable");
  expect((await db.query("SELECT * FROM business_documents")).rows).toHaveLength(0);
  expect((await s.read(p,identity())).payments).toEqual(before);
});
it("exposes only read, record and image tools, with the intended scopes",()=>{
  expect(invoicePaymentTools(s,p).map(t=>[t.name,t.scope,t.readOnly])).toEqual([
    ["read_invoice_payment_context","crm:read",true],["record_invoice_payment","crm:append",false],["upload_payment_image","crm:append",false]]);
});
it("handles the maximum image size and rejects oversized or noncanonical base64",()=>{
  const bytes=Buffer.alloc(4*1024*1024);png.copy(bytes);
  expect(paymentImageBytes({...image(randomUUID()),base64:bytes.toString("base64")})).toHaveLength(bytes.length);
  expect(()=>paymentImageBytes({...image(randomUUID()),base64:Buffer.concat([bytes,Buffer.from([0])]).toString("base64")})).toThrow();
  expect(()=>paymentImageBytes({...image(randomUUID()),base64:"!!!!"})).toThrow();
});
it("blocks the same check reference on a different date and rejects same-day manual payment duplicates",async()=>{
  await s.record(p,{requestKey:"pay"},await input());
  await expect(s.record(p,{requestKey:"later"},{...await input(),receivedDate:"2026-10-17"})).rejects.toMatchObject({code:"INVOICE_PAYMENT_DUPLICATE_CANDIDATE"});
  await db.query("UPDATE invoice_payments SET notes='Entered manually'");
  await expect(s.record(p,{requestKey:"manual"},await input())).rejects.toMatchObject({code:"INVOICE_PAYMENT_DUPLICATE_CANDIDATE"});
});
it("rolls back document metadata if audit fails, while preserving the payment and reusable blob",async()=>{
  const payment=await s.record(p,{requestKey:"pay"},await input());
  await db.exec("ALTER TABLE business_document_audit_events ADD CONSTRAINT fail CHECK(action <> 'payment_receipt_uploaded')");
  await expect(s.upload(p,{requestKey:"image"},image(payment.recordId))).rejects.toThrow();
  for(const table of ["business_documents","business_document_versions","business_document_links","business_document_sources"])
    expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
  expect((await s.read(p,identity())).payments).toHaveLength(1);
  await db.exec("ALTER TABLE business_document_audit_events DROP CONSTRAINT fail");
  await s.upload(p,{requestKey:"image"},image(payment.recordId));
  expect((await s.read(p,identity())).images).toHaveLength(1);
});
