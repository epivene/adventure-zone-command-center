import { useState } from "react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Checkbox } from "@workspace/avz-crm/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";

export type SourceWorkItem = {
  id: string;
  eventName: string;
  kind: string;
  reason: string;
  dueAt: string | null;
  city: string;
  region: string;
};

export type SourceDecision = {
  id: string;
  name: string;
  status: string;
  city: string;
  region: string;
  planReason: "no_future_reminder" | "post_event";
  suggestedLegId: string | null;
  copilotHeadline: string | null;
};

export const todayWorkFixture: Record<"replies" | "calls" | "booking" | "waiting" | "later" | "completed", SourceWorkItem[]> = {
  replies: [
    { id: "mail-1", eventName: "Pine County Festival", kind: "reply", reason: "New inquiry from the event coordinator", dueAt: "2026-06-16T09:00:00", city: "Stillwater", region: "MN" },
    { id: "mail-2", eventName: "North Shore Summer Days", kind: "review", reason: "Review the latest booking details before replying", dueAt: "2026-06-16T10:30:00", city: "Duluth", region: "MN" },
  ],
  calls: [
    { id: "call-1", eventName: "Maple Grove Community Fair", kind: "callback", reason: "Return Jamie's call about availability", dueAt: "2026-06-16T11:00:00", city: "Maple Grove", region: "MN" },
    { id: "call-2", eventName: "Riverside Arts Festival", kind: "follow_up", reason: "Check in after sending the event proposal", dueAt: "2026-06-16T13:00:00", city: "Hudson", region: "WI" },
  ],
  booking: [
    { id: "booking-1", eventName: "Lakeside Harvest Celebration", kind: "booking", reason: "Confirm event dates and setup requirements", dueAt: "2026-06-16T15:00:00", city: "Alexandria", region: "MN" },
  ],
  waiting: [
    { id: "waiting-1", eventName: "West End School Carnival", kind: "reply", reason: "Waiting for the committee to confirm its date", dueAt: null, city: "St. Louis Park", region: "MN" },
  ],
  later: [
    { id: "later-1", eventName: "Oak Ridge Fall Fair", kind: "follow_up", reason: "Check in after the summer planning meeting", dueAt: "2026-06-23T09:00:00", city: "Eagan", region: "MN" },
  ],
  completed: [
    { id: "completed-1", eventName: "Riverbend Family Day", kind: "callback", reason: "Availability confirmed with the organizer", dueAt: "2026-06-16T08:45:00", city: "Stillwater", region: "MN" },
  ],
};

export const leadDecisionFixture: SourceDecision[] = [
  {
    id: "lead-1",
    name: "Pine County Festival",
    status: "New lead",
    city: "Stillwater",
    region: "MN",
    planReason: "no_future_reminder",
    suggestedLegId: "north",
    copilotHeadline: "Prior-year festival dates may help with planning",
  },
  {
    id: "lead-2",
    name: "Riverside Arts Festival",
    status: "Confirmed",
    city: "Hudson",
    region: "WI",
    planReason: "post_event",
    suggestedLegId: "central",
    copilotHeadline: null,
  },
];

const travelLegs = [
  { id: "north", name: "North Route" },
  { id: "central", name: "Central Circuit" },
  { id: "coastal", name: "Coastal Loop" },
];

function dateLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function GroupedWorkSection({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: SourceWorkItem[];
  onOpen: (item: SourceWorkItem) => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <Badge variant="outline">{items.length}</Badge>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length ? (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li className="flex items-start justify-between gap-3 py-3" key={item.id}>
                <div className="min-w-0">
                  <p className="font-semibold">{item.eventName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
                  {item.dueAt ? <p className="mt-1 text-xs text-muted-foreground">Due {dateLabel(item.dueAt)}</p> : null}
                </div>
                <Button className="shrink-0" size="sm" variant="link" onClick={() => onOpen(item)}>Open</Button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Nothing needs attention here.</p>}
      </CardContent>
    </Card>
  );
}

export function CurrentTodayFlow() {
  const [manageNextSteps, setManageNextSteps] = useState(false);
  const [selectedNextSteps, setSelectedNextSteps] = useState<string[]>([]);
  const [hiddenNextSteps, setHiddenNextSteps] = useState<string[]>([]);
  const [undoBookingIds, setUndoBookingIds] = useState<string[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activePinned, setActivePinned] = useState(false);
  const [activeUrgent, setActiveUrgent] = useState(false);
  const nextStepItems = leadDecisionFixture.filter((item) => !hiddenNextSteps.includes(item.id));

  function clearNextSteps(ids: string[]) {
    if (!ids.length) return;
    setHiddenNextSteps((current) => [...new Set([...current, ...ids])]);
    setUndoBookingIds(ids);
    setSelectedNextSteps([]);
    setMessage("Cleared from Today in this preview.");
  }

  function snoozeNextSteps(ids: string[]) {
    if (!ids.length) return;
    setHiddenNextSteps((current) => [...new Set([...current, ...ids])]);
    setUndoBookingIds([]);
    setSelectedNextSteps([]);
    setMessage("Snoozed for one week in this preview.");
  }

  function undoClear() {
    setHiddenNextSteps((current) => current.filter((id) => !undoBookingIds.includes(id)));
    setUndoBookingIds([]);
    setMessage("Restored to Today in this preview.");
  }

  function toggleSelection(id: string, checked: boolean) {
    setSelectedNextSteps((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto grid max-w-6xl gap-5 p-4 sm:p-6">
        <header className="border-b border-border pb-4">
          <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">Command Center</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tuesday · June 16, 2026</p>
        </header>

        <Alert>
          <AlertTitle>Prototype preview</AlertTitle>
          <AlertDescription>Extracted from the current Today and event-profile flow. Interactions are local only; nothing is saved to the CRM.</AlertDescription>
        </Alert>

        {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        {selectedProfile ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <p className="text-sm">Profile route preview: <span className="font-semibold">{selectedProfile}</span></p>
              <Button size="sm" variant="outline" onClick={() => setSelectedProfile(null)}>Close</Button>
            </CardContent>
          </Card>
        ) : null}

        <section aria-label="Booking master work queue" className="grid gap-4 lg:grid-cols-3">
          <GroupedWorkSection title="Replies" items={todayWorkFixture.replies} onOpen={(item) => setSelectedProfile(item.eventName)} />
          <GroupedWorkSection title="Calls & Follow-ups" items={todayWorkFixture.calls} onOpen={(item) => setSelectedProfile(item.eventName)} />
          <GroupedWorkSection title="Booking Work" items={todayWorkFixture.booking} onOpen={(item) => setSelectedProfile(item.eventName)} />
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">Waiting ({todayWorkFixture.waiting.length})</summary>
            <div className="mt-3"><GroupedWorkSection title="Waiting for a reply" items={todayWorkFixture.waiting} onOpen={(item) => setSelectedProfile(item.eventName)} /></div>
          </details>
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer font-semibold">Later ({todayWorkFixture.later.length})</summary>
            <div className="mt-3"><GroupedWorkSection title="Scheduled work" items={todayWorkFixture.later} onOpen={(item) => setSelectedProfile(item.eventName)} /></div>
          </details>
          <details className="rounded-xl border border-border bg-card p-4 sm:col-span-2">
            <summary className="cursor-pointer font-semibold">Manage work and reviewed drafts</summary>
            <div className="mt-3 grid gap-3">
              <details className="rounded-xl border border-border p-4">
                <summary className="cursor-pointer font-semibold">Ready to Send (1)</summary>
                <p className="mt-2 text-sm text-muted-foreground">0 new outreach · 0 follow-up · 1 reply</p>
                <p className="mt-3 font-semibold">North Shore Summer Days</p>
                <p className="text-sm text-muted-foreground">Casey Nguyen · Reply draft · Reviewed</p>
              </details>
              <details className="rounded-xl border border-border p-4">
                <summary className="cursor-pointer font-semibold">Active Queue</summary>
                <div className="mt-3 grid gap-3">
                  <div>
                    <p className="font-semibold">Lakeside Harvest Celebration</p>
                    <p className="text-sm text-muted-foreground">Alexandria, MN · Booking work · Confirm setup requirements</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setActivePinned((value) => !value); setMessage(`Pin ${activePinned ? "removed" : "added"} in this preview.`); }}>{activePinned ? "Unpin" : "Pin"}</Button>
                      <Button size="sm" variant="outline" onClick={() => { setActiveUrgent((value) => !value); setMessage(`Priority ${activeUrgent ? "returned to normal" : "marked urgent"} in this preview.`); }}>{activeUrgent ? "Normal priority" : "Urgent"}</Button>
                      <Button size="sm" variant="outline" onClick={() => setMessage("Snoozed for one day in this preview.")}>Snooze 1 day</Button>
                    </div>
                  </div>
                  <Button className="w-fit" size="sm" variant="outline" onClick={() => { setActivePinned(false); setActiveUrgent(false); setMessage("Reset to smart order in this preview."); }}>Reset to smart order</Button>
                </div>
              </details>
            </div>
          </details>
          <details className="rounded-xl border border-border bg-card p-4 sm:col-span-2">
            <summary className="cursor-pointer font-semibold">Completed today ({todayWorkFixture.completed.length})</summary>
            <div className="mt-3"><GroupedWorkSection title="Completed today" items={todayWorkFixture.completed} onOpen={(item) => setSelectedProfile(item.eventName)} /></div>
          </details>
        </div>

        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer font-semibold">Booking tools and decisions</summary>
          <div className="mt-4 grid gap-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Calls & follow-ups</CardTitle>
                <Badge variant="outline">2 due today</Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground">Call, email, or use the event website. Overdue items stay first.</p>
                <ul className="mt-3 divide-y divide-border">
                  {todayWorkFixture.calls.map((item) => (
                    <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={item.id}>
                      <div><p className="font-semibold">{item.eventName}</p><p className="text-sm text-muted-foreground">{item.reason}</p></div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSelectedProfile(item.eventName)}>Email</Button>
                        <Button size="sm" variant="outline" onClick={() => setSelectedProfile(item.eventName)}>Web contact</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <details className="rounded-xl border border-border bg-card p-4">
              <summary className="cursor-pointer font-semibold">Needs a decision ({nextStepItems.length})</summary>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground">Leads or past events with no future reminder scheduled.</p>
                {nextStepItems.length ? <Button size="sm" variant="link" onClick={() => { setManageNextSteps((value) => !value); setSelectedNextSteps([]); }}>{manageNextSteps ? "Done" : "Manage"}</Button> : null}
              </div>
              {undoBookingIds.length ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-secondary p-3 text-sm">
                  <span>Cleared from Today.</span>
                  <Button size="sm" variant="link" onClick={undoClear}>Undo</Button>
                </div>
              ) : null}
              {manageNextSteps && nextStepItems.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button disabled={!selectedNextSteps.length} size="sm" variant="outline" onClick={() => clearNextSteps(selectedNextSteps)}>Clear selected</Button>
                  <Button disabled={!selectedNextSteps.length} size="sm" variant="outline" onClick={() => snoozeNextSteps(selectedNextSteps)}>Snooze selected one week</Button>
                </div>
              ) : null}
              {nextStepItems.length ? (
                <ul className="mt-3 divide-y divide-border">
                  {nextStepItems.map((booking) => {
                    const suggestedLeg = travelLegs.find((leg) => leg.id === booking.suggestedLegId);
                    return (
                      <li className="flex items-start gap-3 py-3" key={booking.id}>
                        {manageNextSteps ? <Checkbox aria-label={`Select ${booking.name}`} checked={selectedNextSteps.includes(booking.id)} onCheckedChange={(checked) => toggleSelection(booking.id, checked === true)} /> : null}
                        <div className="min-w-0 flex-1">
                          <Button className="h-auto p-0" variant="link" onClick={() => setSelectedProfile(booking.name)}>{booking.name}</Button>
                          <p className="mt-1 text-sm text-muted-foreground">{booking.planReason === "post_event" ? "Past event · Needs follow-up decision" : `${booking.status} · Needs follow-up decision`}</p>
                          {suggestedLeg ? <p className="mt-1 text-xs font-semibold text-primary">Suggested leg: {suggestedLeg.name}</p> : booking.status === "New lead" ? <p className="mt-1 text-xs font-semibold text-muted-foreground">Leg suggestion needs dates and location</p> : null}
                          {booking.copilotHeadline ? <p className="mt-1 text-xs font-semibold text-primary">{booking.copilotHeadline}</p> : null}
                        </div>
                        {!manageNextSteps ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button aria-label={`More actions for ${booking.name}`} size="icon" variant="ghost">⋯</Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setSelectedProfile(booking.name)}>Open profile</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => snoozeNextSteps([booking.id])}>Snooze one week</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => clearNextSteps([booking.id])}>No follow-up needed</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="mt-4 text-sm text-muted-foreground">Nothing needs a next step right now.</p>}
            </details>
          </div>
        </details>
      </div>
    </main>
  );
}
