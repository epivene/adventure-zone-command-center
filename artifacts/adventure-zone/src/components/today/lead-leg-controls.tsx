import { useEffect, useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { apiPost } from "@/lib/auth-token";
import type { LegAssignmentView } from "@/components/bookings/leg-assignment-panel";

export function LeadLegControls({ bookingId, assignment, legs, onSaved, onBusyChange }: {
  bookingId: string; assignment: LegAssignmentView; legs: { id: string; name: string; archivedAt?: unknown }[];
  onSaved(assignment: LegAssignmentView): Promise<void>; onBusyChange(value: boolean): void;
}) {
  const [choice, setChoice] = useState(assignment.assignedLegId ?? assignment.suggestedLegId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setChoice(assignment.assignedLegId ?? assignment.suggestedLegId ?? ""); }, [assignment.assignedLegId, assignment.suggestedLegId]);
  const activeLegs = legs.filter(leg => !leg.archivedAt);
  async function save(legId: string) {
    if (busy || !legId) return;
    setBusy(true); onBusyChange(true); setError(null); setNotice(null);
    try {
      const value = await apiPost<{ legAssignment: LegAssignmentView }>(`/bookings/${bookingId}/lead-leg`, { travelLegId: legId, expectedTravelLegId: assignment.assignedLegId });
      setNotice("Leg assignment saved.");
      try { await onSaved(value.legAssignment); }
      catch { setNotice("Leg assignment saved. Refresh to update the rest of the queue."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this assignment."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <div className="grid gap-3">
    {assignment.suggestedLegId && assignment.suggestedLegId !== assignment.assignedLegId && activeLegs.some(leg => leg.id === assignment.suggestedLegId)
      ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void save(assignment.suggestedLegId!)}>Use suggested leg</Button> : null}
    <div className="grid gap-1"><Label htmlFor="selected-lead-leg">Or choose another active leg</Label>
      <Select value={choice} disabled={busy} onValueChange={setChoice}><SelectTrigger id="selected-lead-leg"><SelectValue placeholder="Choose a leg" /></SelectTrigger><SelectContent>{activeLegs.map(leg => <SelectItem key={leg.id} value={leg.id}>{leg.name}</SelectItem>)}</SelectContent></Select>
    </div>
    <Button size="sm" className="w-fit" disabled={busy || !choice || choice === assignment.assignedLegId} onClick={() => void save(choice)}>{busy ? "Saving…" : "Save chosen leg"}</Button>
    {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <p className="text-xs text-muted-foreground">Manual choices are saved and are not replaced automatically by later recommendations.</p>
  </div>;
}
