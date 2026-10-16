import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@workspace/avz-crm/components/ui/alert";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/avz-crm/components/ui/dialog";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import {
  WEEKLY_CENTS, WEEKLY_TITLE, centsToInput, createPay, describeError, parseMoneyToCents, updatePay, type PayItem,
} from "@/features/agent-tax/client";
import { MoneyField } from "./MoneyField";

interface Props { open: boolean; item: PayItem | null; mode: "weekly" | "manual"; onClose: () => void; onSaved: () => void }

function init(item: PayItem | null, mode: "weekly" | "manual") {
  if (item) return { title: item.title, amount: centsToInput(item.amountCents), earned: item.earnedDate, due: item.dueDate ?? "", notes: item.notes ?? "" };
  return { title: mode === "weekly" ? WEEKLY_TITLE : "", amount: mode === "weekly" ? centsToInput(WEEKLY_CENTS) : "", earned: "", due: "", notes: "" };
}

export function PayItemDialog({ open, item, mode, onClose, onSaved }: Props) {
  const [f, setF] = useState(() => init(item, mode));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(init(item, mode)); setErrors({}); setFormError(null); } }, [open, item, mode]);
  const kind = item?.kind ?? mode;
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = "Title is required.";
    const cents = parseMoneyToCents(f.amount);
    if (cents === null || cents <= 0) e.amount = "Enter an amount above zero with up to 2 decimals.";
    if (!f.earned) e.earned = kind === "weekly" ? "Enter the week's earned date." : "Earned date is required.";
    if (item && cents !== null && cents < item.paidCents) e.amount = "Earned amount cannot be less than what is already paid.";
    setErrors(e);
    if (Object.keys(e).length || cents === null) return;
    const input = { title: f.title.trim(), kind, earnedDate: f.earned, dueDate: f.due || null, amountCents: cents, notes: f.notes.trim() || null };
    setBusy(true); setFormError(null);
    try {
      if (item) await updatePay(item.id, input, item.revision); else await createPay(input);
      onSaved(); onClose();
    } catch (err) { setFormError(describeError(err)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit pay owed" : kind === "weekly" ? "Add earned week" : "Add manual pay entry"}</DialogTitle>
          <DialogDescription>
            {kind === "weekly" ? "Weeks are only added when you add them. Default is $600.00; change it if this week differs." : "Any custom amount you are owed."} Unpaid pay is not counted as received income until you record a payment.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {formError ? <Alert variant="destructive" role="alert"><AlertDescription>{formError}</AlertDescription></Alert> : null}
          <div className="grid gap-2">
            <Label htmlFor="pay-title">Title</Label>
            <Input id="pay-title" value={f.title} onChange={(e) => set("title", e.target.value)} aria-invalid={!!errors.title} />
            {errors.title ? <p className="text-sm text-destructive">{errors.title}</p> : null}
          </div>
          <MoneyField id="pay-amount" label="Amount owed (USD)" value={f.amount} onChange={(v) => set("amount", v)} error={errors.amount} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pay-earned">{kind === "weekly" ? "Week earned date" : "Earned date"}</Label>
              <Input id="pay-earned" type="date" value={f.earned} onChange={(e) => set("earned", e.target.value)} aria-invalid={!!errors.earned} />
              {errors.earned ? <p className="text-sm text-destructive">{errors.earned}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pay-due">Due date (optional)</Label>
              <Input id="pay-due" type="date" value={f.due} onChange={(e) => set("due", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pay-notes">Notes (optional)</Label>
            <Textarea id="pay-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
