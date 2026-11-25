import { useEffect, useRef, useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import { Checkbox } from "@workspace/avz-crm/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/avz-crm/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import {
  ALLOWED_MIME, CATEGORIES, ENTRY_TYPES, MAX_FILE_BYTES, METHODS, centsToInput, createRecord, describeError, downloadFile,
  labelOf, parseMoneyToCents, updateRecord, uploadFile, viewFile, ApiError,
  type Category, type EntryType, type PaymentMethod, type TaxRecord, type TaxRecordInput,
} from "@/features/agent-tax/client";
import { BookingPicker } from "./BookingPicker";
import { RemoveFileDialog } from "./ConfirmDialogs";

interface Props { open: boolean; record: TaxRecord | null; defaultYear: number; onClose: () => void; onSaved: () => void }

function init(r: TaxRecord | null, year: number) {
  return {
    title: r?.title ?? "", entryType: (r?.entryType ?? "expense") as EntryType, amount: centsToInput(r?.amountCents ?? null),
    date: r?.recordDate ?? "", year: String(r?.taxYear ?? year), category: (r?.category ?? "other") as Category,
    method: (r?.paymentMethod ?? "other") as PaymentMethod, counterparty: r?.counterparty ?? "", notes: r?.notes ?? "",
    bookingId: r?.bookingId ?? null, bookingLabel: r?.bookingLabel ?? null,
  };
}

export function RecordFormDialog({ open, record, defaultYear, onClose, onSaved }: Props) {
  const [f, setF] = useState(() => init(record, defaultYear));
  const [current, setCurrent] = useState<TaxRecord | null>(record);
  const [file, setFile] = useState<File | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [fileMsg, setFileMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setF(init(record, defaultYear)); setCurrent(record); setFile(null); setConfirmReplace(false);
    setErrors({}); setFormError(null); setPartial(false); setFileMsg(null);
  }, [open, record, defaultYear]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const money = f.entryType !== "document";
  const hasFile = !!current?.fileName;
  const payLinked = !!(current?.payItemId || current?.hasPayAllocations);

  function pickFile(next: File | null) {
    setFileMsg(null); setConfirmReplace(false);
    if (next && (!ALLOWED_MIME.includes(next.type) || next.size > MAX_FILE_BYTES || next.size === 0)) {
      setFile(null); if (fileRef.current) fileRef.current.value = "";
      setFileMsg("Attach a PDF, JPEG, PNG or WEBP file up to 15 MB.");
      return;
    }
    setFile(next);
  }

  function validate(): TaxRecordInput | null {
    const e: Record<string, string> = {};
    const title = f.title.trim();
    if (!title) e.title = "Title is required.";
    let amountCents: number | null = null;
    if (f.amount.trim() !== "") {
      amountCents = parseMoneyToCents(f.amount);
      if (amountCents === null) e.amount = "Enter a non-negative amount with up to 2 decimals.";
    } else if (money) e.amount = "Amount is required.";
    if (money && !f.date) e.date = "Date is required.";
    if (f.date && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) e.date = "Enter a valid date.";
    const year = Number(f.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) e.year = "Enter a valid tax year.";
    else if (f.date && Number(f.date.slice(0, 4)) !== year) e.year = "Tax year must match the date.";
    if (file && hasFile && !confirmReplace) e.file = "Confirm replacing the current attachment.";
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      title, entryType: f.entryType, amountCents, recordDate: f.date || null, taxYear: year, category: f.category,
      paymentMethod: f.method, counterparty: f.counterparty.trim() || null, notes: f.notes.trim() || null, bookingId: f.bookingId,
    };
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    setFormError(null);
    // After a partial save the entry exists: retry only the upload.
    let saved = partial ? current : null;
    const input = partial ? ({} as TaxRecordInput) : validate();
    if (!input) return;
    if (partial && !file) { setFormError("Choose the file to retry."); return; }
    setBusy(true);
    try {
      if (!saved) {
        saved = current ? await updateRecord(current.id, input, current.revision) : await createRecord(input);
        setCurrent(saved);
      }
      if (file) {
        try {
          saved = await uploadFile(saved.id, file, saved.revision);
          setCurrent(saved);
        } catch (err) {
          setPartial(true);
          setFormError(`The entry was saved, but the attachment did not upload: ${describeError(err)} Retry the upload below; the entry will not be duplicated.`);
          onSaved();
          return;
        }
      }
      onSaved(); onClose();
    } catch (err) {
      setFormError(describeError(err) + (err instanceof ApiError && err.status === 409 ? "" : ""));
    } finally { setBusy(false); }
  }

  async function runFile(fn: () => Promise<void>) {
    setFileMsg(null);
    try { await fn(); } catch (err) { setFileMsg(describeError(err)); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{record ? "Edit entry" : "New entry"}</DialogTitle>
          <DialogDescription>{payLinked ? "This income is applied to earned pay. Amount, date, year, type and payment method are locked. For income applied from Records, unlink it from each week in Pay owed to me before correcting these fields. For payments created under Pay owed to me, delete the income with confirmation and record it again. " : ""}Private to the owner. Do not enter Social Security or account numbers. Nothing is saved until you press Save.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {formError ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>{partial ? "Partially saved" : "Could not save"}</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <fieldset disabled={partial || busy} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="tax-title">Title</Label>
              <Input id="tax-title" value={f.title} onChange={(e) => set("title", e.target.value)} aria-invalid={!!errors.title} />
              {errors.title ? <p className="text-sm text-destructive">{errors.title}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select disabled={payLinked} value={f.entryType} onValueChange={(v) => set("entryType", v as EntryType)}>
                  <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
                  <SelectContent>{ENTRY_TYPES.map((t) => <SelectItem key={t} value={t}>{labelOf(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tax-amount">Amount (USD){money ? "" : " optional"}</Label>
                <Input id="tax-amount" disabled={payLinked} inputMode="decimal" placeholder="0.00" value={f.amount} onChange={(e) => set("amount", e.target.value)} aria-invalid={!!errors.amount} />
                {errors.amount ? <p className="text-sm text-destructive">{errors.amount}</p> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tax-date">Date{money ? "" : " optional"}</Label>
                <Input id="tax-date" disabled={payLinked} type="date" value={f.date} onChange={(e) => { const d = e.target.value; setF((p) => ({ ...p, date: d, year: d ? d.slice(0, 4) : p.year })); }} aria-invalid={!!errors.date} />
                {errors.date ? <p className="text-sm text-destructive">{errors.date}</p> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tax-year">Tax year</Label>
                <Input id="tax-year" inputMode="numeric" value={f.year} onChange={(e) => set("year", e.target.value)} readOnly={payLinked || (money && !!f.date)} aria-invalid={!!errors.year} />
                {errors.year ? <p className="text-sm text-destructive">{errors.year}</p> : null}
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={f.category} onValueChange={(v) => set("category", v as Category)}>
                  <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((t) => <SelectItem key={t} value={t}>{labelOf(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Payment method</Label>
                <Select disabled={payLinked} value={f.method} onValueChange={(v) => set("method", v as PaymentMethod)}>
                  <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map((t) => <SelectItem key={t} value={t}>{labelOf(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tax-cp">Counterparty (optional)</Label>
              <Input id="tax-cp" value={f.counterparty} onChange={(e) => set("counterparty", e.target.value)} />
            </div>
            <BookingPicker value={f.bookingId} label={f.bookingLabel} onChange={(id, label) => setF((p) => ({ ...p, bookingId: id, bookingLabel: label }))} />
            <div className="grid gap-2">
              <Label htmlFor="tax-notes">Notes (optional)</Label>
              <Textarea id="tax-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </fieldset>

          <div className="grid gap-2 rounded-md border border-border p-3">
            <Label htmlFor="tax-file">Receipt or document (optional)</Label>
            {hasFile && current ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="break-all font-medium text-foreground">{current.fileName}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => runFile(() => viewFile(current))}>View</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => runFile(() => downloadFile(current))}>Download</Button>
                <Button type="button" variant="outline" size="sm" disabled={busy || partial} onClick={() => setRemoving(true)}>Remove</Button>
              </div>
            ) : null}
            <Input id="tax-file" ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            <p className="text-sm text-muted-foreground">PDF, JPEG, PNG or WEBP, up to 15 MB.</p>
            {file && hasFile && !partial ? (
              <div className="flex items-center gap-2">
                <Checkbox id="tax-replace" checked={confirmReplace} onCheckedChange={(c) => setConfirmReplace(c === true)} />
                <Label htmlFor="tax-replace">Replace the current attachment with this file</Label>
              </div>
            ) : null}
            {errors.file ? <p className="text-sm text-destructive">{errors.file}</p> : null}
            {fileMsg ? <p className="text-sm text-destructive" role="alert">{fileMsg}</p> : null}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{partial ? "Close" : "Cancel"}</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving" : partial ? "Retry upload" : "Save"}</Button>
          </DialogFooter>
        </form>
        {current ? (
          <RemoveFileDialog
            record={removing ? current : null}
            onCancel={() => setRemoving(false)}
            onRemoved={(r) => { setCurrent(r); setRemoving(false); onSaved(); }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
