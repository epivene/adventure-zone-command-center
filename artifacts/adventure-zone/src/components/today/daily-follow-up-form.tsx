import { useRef, useState, type FormEvent } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { createFollowUpAction, editFollowUpAction } from "@/actions/follow-ups";
import { FOLLOW_UP_KINDS } from "@/features/follow-ups/follow-up-kinds";
import { businessDateKey, parseBusinessDate } from "@/lib/business-date";
import type { DailyWork } from "@/features/today/daily-work";

export function DailyFollowUpForm({ work, onSaved, onCancel, onBusyChange }: {
  work: DailyWork; onSaved(): Promise<void>; onCancel(): void; onBusyChange(busy: boolean): void;
}) {
  const [kind, setKind] = useState(work.followUp?.kind ?? "email");
  const [due, setDue] = useState(work.followUp ? businessDateKey(work.followUp.dueAt) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    const dueAt = parseBusinessDate(due);
    if (busy.current || !dueAt) return;
    busy.current = true;
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      const result = work.followUp
        ? await editFollowUpAction({ followUpId: work.followUp.id, kind, dueAt, completed: false, outcome: null })
        : await createFollowUpAction({ organizationId: work.organizationId!, contactId: work.contactId, bookingId: work.bookingId, kind, dueAt });
      if (!result.ok) { setError(result.error); return; }
      window.dispatchEvent(new Event("follow-ups-changed"));
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the reminder.");
    } finally {
      busy.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }
  return <form onSubmit={save} className="grid gap-3 border-t border-border pt-4">
    <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1">
        <Label htmlFor="daily-follow-up-kind">Contact method</Label>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger id="daily-follow-up-kind"><SelectValue /></SelectTrigger>
          <SelectContent>{FOLLOW_UP_KINDS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            {!FOLLOW_UP_KINDS.some(item => item.value === kind) ? <SelectItem value={kind}>{kind.replaceAll("_", " ")}</SelectItem> : null}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="daily-follow-up-date">Reminder date</Label>
        <Input id="daily-follow-up-date" type="date" required value={due} onChange={event => setDue(event.target.value)} />
      </div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={saving || !parseBusinessDate(due)}>{saving ? "Saving…" : "Save follow-up"}</Button>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
    </div>
  </form>;
}
