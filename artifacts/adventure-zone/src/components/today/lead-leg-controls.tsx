import { useEffect, useState } from "react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { apiPost } from "@/lib/auth-token";
import type { LegAssignmentAlternativeView, LegAssignmentView } from "@/components/bookings/leg-assignment-panel";

export function LeadLegControls({ bookingId, assignment, legs, alternatives, onSaved, onBusyChange }: {
  bookingId: string; assignment: LegAssignmentView | null; legs: { id: string; name: string; archivedAt?: unknown }[];
  alternatives?: LegAssignmentAlternativeView[];
  onSaved(assignment: LegAssignmentView): Promise<void>; onBusyChange(value: boolean): void;
}) {
  const [choice, setChoice] = useState(assignment?.assignedLegId ?? assignment?.suggestedLegId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setChoice(assignment?.assignedLegId ?? assignment?.suggestedLegId ?? ""); }, [assignment?.assignedLegId, assignment?.suggestedLegId]);
  const activeLegs = legs.filter(leg => !leg.archivedAt);
  async function save(legId: string) {
    if (busy || !legId) return;
    setBusy(true); onBusyChange(true); setError(null); setNotice(null);
    try {
      const value = await apiPost<{ legAssignment: LegAssignmentView }>(`/bookings/${bookingId}/lead-leg`, { travelLegId: legId, expectedTravelLegId: assignment?.assignedLegId ?? null });
      setNotice("Leg assignment saved.");
      try { await onSaved(value.legAssignment); }
      catch { setNotice("Leg assignment saved. Refresh to update the rest of the queue."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this assignment."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  const driveLabel = (minutes: number | null) => {
    if (minutes === null) return "not available";
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  };
  return <div className="grid gap-3">
    {alternatives?.length ? <section className="grid gap-2" aria-label="Active leg comparisons">
      <h3 className="text-sm font-semibold">Compare active legs</h3>
      <ul className="grid gap-2">
        {alternatives.map(alternative => {
          const isCurrent = assignment?.assignedLegId === alternative.legId;
          const isSuggested = assignment?.source !== "manual" && assignment?.suggestedLegId === alternative.legId;
          return <li key={alternative.legId} className="grid gap-1 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{alternative.legName}</span>
              {isCurrent ? <Badge variant="outline">Current assignment</Badge> : null}
              {isSuggested ? <Badge>Recommended</Badge> : null}
              {alternative.priorYearMatch ? <Badge variant="secondary">Handled last year</Badge> : null}
              {alternative.warning ? <Badge variant="secondary">{alternative.warning === "major_travel_concern" ? "Major travel concern" : "Long travel"}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {alternative.confirmedEventCount} confirmed {alternative.confirmedEventCount === 1 ? "event" : "events"} this season
              {" · "}Travel: {driveLabel(alternative.previousStopDriveMinutes)} before, {driveLabel(alternative.nextStopDriveMinutes)} after
            </p>
            <p className="text-sm">{alternative.eligible ? alternative.reason : `Needs review: ${alternative.reason}`}</p>
          </li>;
        })}
      </ul>
    </section> : alternatives ? <p className="text-sm text-muted-foreground">No active-leg route comparisons are available.</p> : null}
    {assignment?.suggestedLegId && assignment.suggestedLegId !== assignment.assignedLegId && activeLegs.some(leg => leg.id === assignment.suggestedLegId)
      ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void save(assignment.suggestedLegId!)}>Use suggested leg</Button> : null}
    <div className="grid gap-1"><Label htmlFor="selected-lead-leg">Or choose another active leg</Label>
      <Select value={choice} disabled={busy} onValueChange={setChoice}><SelectTrigger id="selected-lead-leg"><SelectValue placeholder="Choose a leg" /></SelectTrigger><SelectContent>{activeLegs.map(leg => <SelectItem key={leg.id} value={leg.id}>{leg.name}</SelectItem>)}</SelectContent></Select>
    </div>
    <Button size="sm" className="w-fit" disabled={busy || !choice || choice === assignment?.assignedLegId} onClick={() => void save(choice)}>{busy ? "Saving…" : "Save chosen leg"}</Button>
    {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <p className="text-xs text-muted-foreground">Manual choices are saved and are not replaced automatically by later recommendations.</p>
  </div>;
}
