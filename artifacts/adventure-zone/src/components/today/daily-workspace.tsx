import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@workspace/avz-crm/components/ui/radio-group";
import { Checkbox } from "@workspace/avz-crm/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@workspace/avz-crm/components/ui/dropdown-menu";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { FollowUpControls } from "@/components/follow-ups/follow-up-controls";
import { deleteFollowUpAction, editFollowUpAction } from "@/actions/follow-ups";
import { buildDailyWork, type DailyDecision, type DailyWork } from "@/features/today/daily-work";
import type { MasterTodayQueue } from "@/features/today/master-work-types";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";
import { BUSINESS_TIME_ZONE, classifyBusinessDueDate } from "@/lib/business-date";
import { clearTodayReturnContext, readTodayReturnContext, saveTodayReturnContext } from "@/features/today/today-return-context";
import { callWorkspaceHref, eventProfileHref } from "./next-call-card";
import { DailyFollowUpForm } from "./daily-follow-up-form";
import { apiGet } from "@/lib/auth-token";
import type { LegAssignmentAlternativeView, LegAssignmentView } from "@/components/bookings/leg-assignment-panel";
import { LeadLegControls } from "./lead-leg-controls";

const OPEN_LEAD_STATUSES = new Set(["new_lead", "researching", "contact_due", "contacted", "interested", "possible", "unlikely", "quote_sent", "pending_decision"]);
type WorkView = "all" | "attention" | "confirmed";

function workStatus(item: DailyWork) {
  return item.decision?.status ?? item.master?.opportunityStatus ?? "";
}

function isConfirmedWork(item: DailyWork) {
  const status = workStatus(item).toLowerCase();
  return ["confirmed", "booked", "won", "completed"].includes(status);
}

function needsAttention(item: DailyWork) {
  if (!item.dueAt) return true;
  const dueAt = new Date(item.dueAt);
  return !Number.isFinite(dueAt.getTime()) || classifyBusinessDueDate(dueAt, new Date()) !== "future";
}

function dueLabel(work: DailyWork) {
  if (!work.dueAt) return "Needs a next step";
  const date = new Date(work.dueAt);
  if (!Number.isFinite(date.getTime())) return "Date needs review";
  const due = classifyBusinessDueDate(date, new Date());
  return `${due === "overdue" ? "Overdue · " : due === "today" ? "Today · " : ""}${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(date)}`;
}
function leadDate(work: DailyWork) {
  const value = work.decision?.startsAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: BUSINESS_TIME_ZONE }).format(date) : null;
}

export function DailyWorkspace({ queue, followUps, decisions, travelLegs, callingEnabled, onChanged, onClear, onSnooze, busy, leadsOnly = false }: {
  queue: MasterTodayQueue; followUps: FollowUpSummary[]; decisions: DailyDecision[];
  travelLegs: { id: string; name: string }[]; callingEnabled: boolean;
  onChanged(): Promise<void>; onClear(ids: string[]): Promise<void>; onSnooze(ids: string[]): Promise<void>; busy: boolean; leadsOnly?: boolean;
}) {
  const { open, later } = buildDailyWork(queue, followUps, decisions);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);
  const [workView, setWorkView] = useState<WorkView>("all");
  const [search, setSearch] = useState("");
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(8);
  const [bookingLeg, setBookingLeg] = useState<{ bookingId: string; assignment: LegAssignmentView | null; alternatives: LegAssignmentAlternativeView[]; legs: { id: string; name: string; archivedAt?: unknown }[] } | null>(null);
  const [legError, setLegError] = useState(false);
  const [legBusy, setLegBusy] = useState(false);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const context = readTodayReturnContext();
    if (context?.workItemId) {
      setActiveId(context.workItemId);
      setShowLater(context.filter === "later");
      requestAnimationFrame(() => window.scrollTo({ top: context.scrollY }));
    }
    clearTodayReturnContext();
  }, []);
  const visible = showLater ? [...open, ...later] : open;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredWork = visible.filter(item => {
    const status = workStatus(item);
    const matchesView = workView === "all"
      || (workView === "attention" && needsAttention(item))
      || (workView === "confirmed" && isConfirmedWork(item));
    const matchesSearch = !normalizedSearch
      || [item.name, item.kind, item.reason, item.location, status]
        .filter(Boolean)
        .some(value => value.toLowerCase().includes(normalizedSearch));
    return matchesView && matchesSearch;
  });
  const work = filteredWork.find(item => item.id === activeId) ?? filteredWork[0];
  const availableViews = [
    { value: "all" as const, label: leadsOnly ? "All leads" : "All work", count: visible.length },
    { value: "attention" as const, label: "Needs attention", count: visible.filter(needsAttention).length },
    ...(!leadsOnly ? [{ value: "confirmed" as const, label: "Confirmed", count: visible.filter(isConfirmedWork).length }] : []),
  ];
  const locked = busy || formBusy || legBusy;
  const validSelected = selected.filter(id => decisions.some(decision => decision.id === id));
  const loadedLeg = bookingLeg?.bookingId === work?.bookingId ? bookingLeg : null;
  const assignment = loadedLeg?.assignment ?? work?.decision?.legAssignment;
  const canCorrectLeg = !!work?.decision && OPEN_LEAD_STATUSES.has(work.decision.status);
  useEffect(() => {
    let cancelled = false;
    setLegError(false);
    if (!work?.bookingId) return;
    const bookingId = work.bookingId;
    apiGet<{ legAssignment: LegAssignmentView | null; legAlternatives?: LegAssignmentAlternativeView[]; allTravelLegs: { id: string; name: string; archivedAt?: unknown }[] }>(`/bookings/${bookingId}`)
      .then(detail => { if (!cancelled) setBookingLeg({ bookingId, assignment: detail.legAssignment, alternatives: detail.legAlternatives ?? [], legs: detail.allTravelLegs ?? [] }); })
      .catch(() => { if (!cancelled) setLegError(true); });
    return () => { cancelled = true; };
  }, [work?.bookingId, work?.decision?.legAssignment]);
  const legName = (id: string | null | undefined) => id ? [...travelLegs, ...(loadedLeg?.legs ?? [])].find(leg => leg.id === id)?.name ?? "Unknown leg" : "Unassigned";
  const renderedWork = filteredWork.slice(0, visibleCount);
  // Keep a restored/selected item visible even when it is beyond the first page.
  if (work && !renderedWork.some(item => item.id === work.id)) renderedWork.push(work);
  const isConversation = !!work?.master?.threadId && ["reply", "draft", "review"].includes(work.master.kind);
  const profileHref = work ? eventProfileHref({ organizationId: work.organizationId, contactId: work.contactId, bookingId: work.bookingId }) ?? work.href : "/profiles";
  function remember() {
    if (work) saveTodayReturnContext({ filter: showLater ? "later" : "active", workItemId: work.id, scrollY: window.scrollY });
  }
  async function bulk(action: (ids: string[]) => Promise<void>) {
    await action(validSelected);
    setSelected([]);
  }
  return <div className="grid gap-5 lg:grid-cols-2">
    <section className="grid content-start gap-3" aria-label="Daily work queue">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">Today's work</h2>
        <p className="text-sm text-muted-foreground">Select a record to see its next step</p>
      </div>
      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{leadsOnly ? "Open leads" : "Your work"}</CardTitle><Badge variant="outline">{open.length} open</Badge>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3">
            <div aria-label="Work views" className="flex flex-wrap gap-1" role="group">
              {availableViews.map(({ value, label, count }) => (
                <Button
                  aria-pressed={workView === value}
                  data-testid={`button-work-view-${value}`}
                  key={value}
                  onClick={() => setWorkView(value)}
                  size="sm"
                  variant={workView === value ? "secondary" : "ghost"}
                >
                  {label}<span aria-label={`${count} ${count === 1 ? "record" : "records"}`} className="ml-1 text-xs">{count}</span>
                </Button>
              ))}
            </div>
            <Input
              aria-label="Search work"
              data-testid="input-work-search"
              onChange={event => setSearch(event.target.value)}
              placeholder="Search event, location, or status"
              value={search}
            />
          </div>
          {decisions.length ? <Button size="sm" variant="ghost" aria-label="Manage next steps" disabled={locked} onClick={() => { setManage(value => !value); setSelected([]); }}>{manage ? "Done managing" : "Manage next steps"}</Button> : null}
          {manage ? <div className="grid gap-3 rounded-lg border border-border p-3">
            <p className="text-sm text-muted-foreground">Manage bookings without a future reminder.</p>
            {decisions.map(decision => <div key={decision.id} className="flex items-center gap-2">
              <Checkbox id={`manage-${decision.id}`} aria-label={`Select ${decision.name}`} checked={validSelected.includes(decision.id)} disabled={locked}
                onCheckedChange={checked => setSelected(current => checked ? [...current, decision.id] : current.filter(id => id !== decision.id))} />
              <Label htmlFor={`manage-${decision.id}`}>{decision.name}</Label>
            </div>)}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={locked || !validSelected.length} onClick={() => void bulk(onClear)}>Clear selected</Button>
              <Button size="sm" variant="outline" disabled={locked || !validSelected.length} onClick={() => void bulk(onSnooze)}>Snooze selected 1 week</Button>
            </div>
          </div> : filteredWork.length ? <RadioGroup aria-label="Select work item" value={work?.id ?? ""} onValueChange={id => { if (!locked) { setActiveId(id); setFormOpen(false); } }} className="gap-0">
            {renderedWork.map(item => <div className="flex items-start gap-3 border-t border-border py-3" key={item.id} data-testid={`row-work-${item.id}`} data-work-item-id={item.id}>
              <RadioGroupItem id={`daily-${item.id}`} value={item.id} disabled={locked} className="mt-1" />
              <Label htmlFor={`daily-${item.id}`} className="grid min-w-0 flex-1 cursor-pointer gap-1">
                <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{item.name}</span><span className="text-xs text-muted-foreground">{dueLabel(item)}</span></span>
                <span className="text-sm text-muted-foreground">{item.kind} · {item.reason}</span>
                {workStatus(item) ? <Badge className="w-fit" variant={isConfirmedWork(item) ? "outline" : "secondary"}>{workStatus(item).replaceAll("_", " ")}</Badge> : null}
                {item.location ? <span className="text-xs text-muted-foreground">{item.location}</span> : null}
                {leadDate(item) ? <span className="text-xs text-muted-foreground">Event: {leadDate(item)}</span> : null}
                {item.decision?.legAssignment ? <span className="text-xs font-semibold text-primary">{item.decision.legAssignment.suggestedLegId ? `${item.decision.legAssignment.source === "manual" ? "Assigned leg" : "Suggested leg"}: ${legName(item.decision.legAssignment.suggestedLegId)}` : "Needs leg assignment"}</span> : null}
              </Label>
            </div>)}
          </RadioGroup> : visible.length ? <p className="text-sm text-muted-foreground">No records match this view. Try another view or clear your search.</p> : <p className="text-sm text-muted-foreground">Nothing needs action right now.</p>}
          {!manage && filteredWork.length > 8 ? <Button size="sm" variant="ghost" disabled={locked} onClick={() => setVisibleCount(value => value >= filteredWork.length ? 8 : value + 8)}>{visibleCount >= filteredWork.length ? "Show less" : `Show more (${filteredWork.length - visibleCount} remaining)`}</Button> : null}
        </CardContent>
      </Card>
      <Card><CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="font-semibold">Waiting &amp; scheduled</p><p className="text-sm text-muted-foreground">{later.length} loaded items</p></div>
        <Button size="sm" variant="outline" disabled={locked} aria-expanded={showLater} onClick={() => { setShowLater(value => !value); setFormOpen(false); }}>{showLater ? "Hide later work" : "View later work"}</Button>
      </CardContent></Card>
    </section>
    <section className="grid content-start gap-3" aria-label="Selected next step">
      <h2 className="text-xl font-bold">Next step</h2>
      <Card className="min-w-0">
        {work ? <>
          <CardHeader><CardTitle>{work.name}</CardTitle><p className="text-sm text-muted-foreground">{[work.location, leadDate(work), work.kind].filter(Boolean).join(" · ")}</p></CardHeader>
          <CardContent className="grid gap-4">
            {work.bookingId ? <section aria-label="Leg assignment" className="grid gap-3 rounded-lg border border-border p-4">
              <p className="font-semibold">{canCorrectLeg ? "Suggested leg" : "Leg assignment"}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="text-xs font-semibold uppercase text-muted-foreground">Recommendation</p><p className="font-semibold">{assignment?.suggestedLegId ? legName(assignment.suggestedLegId) : "No safe suggestion"}</p></div>
                <div><p className="text-xs font-semibold uppercase text-muted-foreground">Current assignment</p><p className="font-semibold">{assignment ? legName(assignment.assignedLegId) : "Unassigned"}</p></div>
              </div>
              {assignment ? <p className="text-sm text-muted-foreground">{assignment.explanation} · {assignment.confidence} confidence</p> : <p className="text-sm text-muted-foreground">{canCorrectLeg ? (legError ? "Could not load a recommendation. You can still choose an active leg, or review the booking." : "No leg recommendation is available yet. You can still choose an active leg.") : (legError ? "Could not load the saved assignment. Open the booking to review it." : "Open the booking to review its saved assignment.")}</p>}
              {assignment?.warning ? <Badge variant="secondary">{assignment.warning === "major_travel_concern" ? "Major travel concern" : "Long travel"}</Badge> : null}
              {canCorrectLeg
                ? <LeadLegControls key={work.bookingId} bookingId={work.bookingId} assignment={assignment ?? null} alternatives={loadedLeg?.alternatives} legs={loadedLeg?.legs ?? travelLegs} onBusyChange={setLegBusy} onSaved={async saved => {
                    setBookingLeg({ bookingId: work.bookingId!, assignment: saved, alternatives: loadedLeg?.alternatives ?? [], legs: loadedLeg?.legs ?? travelLegs });
                    await onChanged();
                  }} /> : null}
              <Button asChild variant="outline" size="sm"><Link onClick={remember} href={`/bookings/${work.bookingId}/edit`}>Review assignment</Link></Button>
            </section> : null}
            <div className="grid gap-3 rounded-lg border border-border bg-muted p-4">
              <p className="font-semibold">Follow-up path</p>
              <p className="text-sm text-muted-foreground">{work.reason}</p>
              <p className="text-sm font-semibold">{dueLabel(work)}</p>
              {work.decision?.copilot?.headline ? <p className="text-sm text-muted-foreground">{work.decision.copilot.headline}</p> : null}
              {formOpen ? <DailyFollowUpForm key={work.id} work={work} onBusyChange={setFormBusy} onCancel={() => setFormOpen(false)} onSaved={async () => {
                // A saved reminder must not be re-submitted if only the refresh fails.
                try { await onChanged(); } finally { setFormOpen(false); }
              }} /> :
                <div className="flex flex-wrap gap-2">
                  {work.decision && !work.followUp && work.organizationId && !isConversation ? <Button disabled={locked} onClick={() => setFormOpen(true)}>Schedule follow-up</Button> :
                    <Button asChild><Link onClick={remember} href={work.followUp?.kind === "call" && callingEnabled ? callWorkspaceHref(work.followUp) : work.href}>{work.followUp?.kind === "call" && callingEnabled ? "Open call workspace" : isConversation ? "Open conversation" : "Open profile"}</Link></Button>}
                  {isConversation && work.decision && work.organizationId ? <Button variant="outline" disabled={locked} onClick={() => setFormOpen(true)}>Schedule follow-up</Button> : null}
                  {work.followUp ? <Button variant="outline" disabled={locked} onClick={() => setFormOpen(true)}>Reschedule</Button> : null}
                  {work.decision ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={locked} aria-label={`More actions for ${work.name}`}>More</Button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem asChild><Link onClick={remember} href={profileHref}>Open profile</Link></DropdownMenuItem>
                      <DropdownMenuItem disabled={locked} onSelect={() => void onSnooze([work.decision!.id])}>Snooze 1 week</DropdownMenuItem>
                      <DropdownMenuItem disabled={locked} onSelect={() => void onClear([work.decision!.id])}>No follow-up needed</DropdownMenuItem>
                    </DropdownMenuContent></DropdownMenu> : null}
                </div>}
              {work.followUp && !formOpen ? <FollowUpControls key={work.id} followUp={{ ...work.followUp, completedAt: null }}
                onEdit={async (id, input) => { const result = await editFollowUpAction({ followUpId: id, kind: input.kind, dueAt: new Date(input.dueAt), completed: false, outcome: null }); if (result.ok) await onChanged(); return result; }}
                onDismiss={async id => { const result = await editFollowUpAction({ followUpId: id, kind: work.followUp!.kind, dueAt: work.followUp!.dueAt, completed: true, outcome: "Dismissed" }); if (result.ok) await onChanged(); return result; }}
                onDelete={async id => { const result = await deleteFollowUpAction(id); if (result.ok) await onChanged(); return result; }}
              /> : null}
            </div>
          </CardContent>
        </> : <CardContent><p className="text-sm text-muted-foreground">Select waiting or scheduled work, or enjoy a clear queue.</p></CardContent>}
      </Card>
    </section>
  </div>;
}
