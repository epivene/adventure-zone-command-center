import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@workspace/avz-crm/components/ui/alert";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/avz-crm/components/ui/dialog";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import {
  METHODS, centsToInput, describeError, formatCents, labelOf, parseMoneyToCents, recordPayment, type PayItem, type PaymentMethod,
} from "@/features/agent-tax/client";
import { MoneyField } from "./MoneyField";

interface Props { item: PayItem | null; onClose: () => void; onSaved: () => void }

export function PaymentDialog({ item, onClose, onSaved }: Props) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("venmo");
  const [counterparty, setCounterparty] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Same request id is reused on retries until success so a payment is never recorded twice.
  const requestId = useRef<string>("");
  const lastBody = useRef("");

  useEffect(() => {
    if (!item) return;
    setAmount(centsToInput(item.remainingCents)); setDate(""); setMethod("venmo"); setCounterparty(""); setNotes("");
    setErrors({}); setFormError(null); requestId.current = crypto.randomUUID(); lastBody.current = "";
  }, [item]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!item || busy) return;
    const e: Record<string, string> = {};
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) e.amount = "Enter an amount above zero with up to 2 decimals.";
    else if (cents > item.remainingCents) e.amount = `Cannot exceed the remaining ${formatCents(item.remainingCents)}.`;
    if (!date) e.date = "Payment date is required.";
    setErrors(e);
    if (Object.keys(e).length || cents === null) return;
    const input = { amountCents: cents, recordDate: date, paymentMethod: method, counterparty: counterparty.trim() || null, notes: notes.trim() || null };
    // If the user changed the payment after a failed attempt, it is a different request.
    const body = JSON.stringify(input);
    if (lastBody.current && lastBody.current !== body) requestId.current = crypto.randomUUID();
    lastBody.current = body;
    setBusy(true); setFormError(null);
    try {
      await recordPayment(item.id, input, item.revision, requestId.current);
      onSaved(); onClose();
    } catch (err) { setFormError(describeError(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment received</DialogTitle>
          <DialogDescription>
            {item?.title}: {formatCents(item?.remainingCents ?? 0)} remaining. This creates one received-income entry in Records. Do not enter it again as income.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {formError ? <Alert variant="destructive" role="alert"><AlertDescription>{formError}</AlertDescription></Alert> : null}
          <MoneyField id="payment-amount" label="Amount received (USD)" value={amount} onChange={setAmount} error={errors.amount} help="Partial payments are allowed." />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="payment-date">Date received</Label>
              <Input id="payment-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} />
              {errors.date ? <p className="text-sm text-destructive">{errors.date}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label>Payment method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{labelOf(m)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="payment-cp">Counterparty (optional)</Label>
            <Input id="payment-cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="payment-notes">Notes (optional)</Label>
            <Textarea id="payment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Recording" : "Record payment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
