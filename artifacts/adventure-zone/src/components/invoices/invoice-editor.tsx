import { useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import type { BusinessDocumentProfileOption } from "@/lib/business-documents-api";
import type { InvoiceWorkspaceClient } from "@/features/invoices/invoice-types";

type DocumentClient = {
  upload(file: File, metadata: { displayName: string; category: "invoice" }): Promise<{ documentId?: string }>;
  deleteDocument(documentId: string): Promise<unknown>;
  searchProfiles(query: string): Promise<BusinessDocumentProfileOption[]>;
};

function cents(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : -1;
}

export function InvoiceEditor({
  api,
  documentApi,
  onCreated,
  onCancel,
}: {
  api: InvoiceWorkspaceClient;
  documentApi: DocumentClient;
  onCreated(): void;
  onCancel(): void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [profileQuery, setProfileQuery] = useState("");
  const [profiles, setProfiles] = useState<BusinessDocumentProfileOption[]>([]);
  const [profile, setProfile] = useState<BusinessDocumentProfileOption | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [total, setTotal] = useState("");
  const [deposit, setDeposit] = useState("0");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [depositDueDate, setDepositDueDate] = useState("");
  const [balanceDueDate, setBalanceDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function searchProfiles() {
    if (!profileQuery.trim()) return;
    try { setProfiles(await documentApi.searchProfiles(profileQuery.trim())); }
    catch { setError("Could not search profiles."); }
  }

  async function save() {
    if (!file || !profile || !invoiceNumber.trim() || cents(total) < 0 || cents(deposit) < 0) {
      setError("Choose a PDF and profile, then enter the invoice number and amounts.");
      return;
    }
    setBusy(true);
    setError("");
    let documentId: string | undefined;
    try {
      const upload = await documentApi.upload(file, { displayName: `${profile.name} · Invoice ${invoiceNumber.trim()}`, category: "invoice" });
      documentId = upload.documentId;
      if (!documentId) throw new Error("The invoice PDF did not finish uploading.");
      await api.create({
        organizationId: profile.id,
        documentId,
        invoiceNumber: invoiceNumber.trim(),
        status: "sent",
        totalCents: cents(total),
        depositCents: cents(deposit),
        issueDate,
        depositDueDate: depositDueDate || null,
        balanceDueDate: balanceDueDate || null,
      });
      onCreated();
    } catch (cause) {
      if (documentId) await documentApi.deleteDocument(documentId).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "Could not save the invoice.");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Add invoice" className="grid gap-4 rounded-xl border border-primary/30 bg-card p-4 shadow-sm">
    <div><h2 className="text-xl font-black">Add an invoice</h2><p className="text-sm text-muted-foreground">Upload the existing PDF and record its payment terms.</p></div>
    <label className="grid gap-1 text-sm font-semibold">Invoice PDF
      <input accept="application/pdf,.pdf" aria-label="Invoice PDF" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
    </label>
    <div className="grid gap-2">
      <label className="grid gap-1 text-sm font-semibold">Profile
        <div className="flex gap-2"><input aria-label="Profile" disabled={busy} onChange={(event) => { setProfileQuery(event.target.value); setProfile(null); }} placeholder="Search event or fair…" value={profile?.name ?? profileQuery} /><Button onClick={() => void searchProfiles()} type="button" variant="outline">Search</Button></div>
      </label>
      {profiles.length && !profile ? <div className="grid gap-1 rounded-lg border p-2">{profiles.map((item) => <button className="rounded-md p-2 text-left hover:bg-muted" key={item.id} onClick={() => { setProfile(item); setProfiles([]); }} type="button">{item.name}{item.city ? ` · ${item.city}, ${item.region ?? ""}` : ""}</button>)}</div> : null}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold">Invoice number<input aria-label="Invoice number" onChange={(event) => setInvoiceNumber(event.target.value)} value={invoiceNumber} /></label>
      <label className="grid gap-1 text-sm font-semibold">Issue date<input aria-label="Issue date" onChange={(event) => setIssueDate(event.target.value)} type="date" value={issueDate} /></label>
      <label className="grid gap-1 text-sm font-semibold">Total amount<input aria-label="Total amount" inputMode="decimal" onChange={(event) => setTotal(event.target.value)} placeholder="7500.00" value={total} /></label>
      <label className="grid gap-1 text-sm font-semibold">Deposit amount<input aria-label="Deposit amount" inputMode="decimal" onChange={(event) => setDeposit(event.target.value)} value={deposit} /></label>
      <label className="grid gap-1 text-sm font-semibold">Deposit due<input aria-label="Deposit due" onChange={(event) => setDepositDueDate(event.target.value)} type="date" value={depositDueDate} /></label>
      <label className="grid gap-1 text-sm font-semibold">Balance due<input aria-label="Balance due" onChange={(event) => setBalanceDueDate(event.target.value)} type="date" value={balanceDueDate} /></label>
    </div>
    {error ? <p className="text-sm font-semibold text-destructive" role="alert">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void save()} type="button">{busy ? "Saving…" : "Save invoice"}</Button><Button disabled={busy} onClick={onCancel} type="button" variant="outline">Cancel</Button></div>
  </section>;
}
