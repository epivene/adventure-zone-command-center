import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/avz-crm/components/ui/select";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@workspace/avz-crm/components/ui/radio-group";
import { leadDecisionFixture, todayWorkFixture, type SourceDecision, type SourceWorkItem } from "./CurrentTodayFlow";

type DailyWork = {
  id: string;
  name: string;
  kind: string;
  reason: string;
  due: string;
  location: string;
  followUpStatus: string;
  assignedLegId?: string;
  suggestedLegId?: string;
  decision?: SourceDecision;
  source?: SourceWorkItem;
};

const dailyQueue: DailyWork[] = [
  {
    id: leadDecisionFixture[0]!.id,
    name: leadDecisionFixture[0]!.name,
    kind: "Lead follow-up",
    reason: "No next reminder is scheduled",
    due: "Today",
    location: `${leadDecisionFixture[0]!.city}, ${leadDecisionFixture[0]!.region}`,
    followUpStatus: "No reminder scheduled",
    assignedLegId: "central",
    suggestedLegId: leadDecisionFixture[0]!.suggestedLegId ?? undefined,
    decision: leadDecisionFixture[0],
  },
  {
    id: todayWorkFixture.calls[0]!.id,
    name: todayWorkFixture.calls[0]!.eventName,
    kind: "Return call",
    reason: todayWorkFixture.calls[0]!.reason,
    due: "11:00 AM",
    location: `${todayWorkFixture.calls[0]!.city}, ${todayWorkFixture.calls[0]!.region}`,
    followUpStatus: "Call due today",
    source: todayWorkFixture.calls[0],
  },
  {
    id: todayWorkFixture.booking[0]!.id,
    name: todayWorkFixture.booking[0]!.eventName,
    kind: "Booking work",
    reason: todayWorkFixture.booking[0]!.reason,
    due: "3:00 PM",
    location: `${todayWorkFixture.booking[0]!.city}, ${todayWorkFixture.booking[0]!.region}`,
    followUpStatus: "Booking work due today",
    assignedLegId: "coastal",
    suggestedLegId: "central",
    source: todayWorkFixture.booking[0],
  },
  {
    id: todayWorkFixture.replies[1]!.id,
    name: todayWorkFixture.replies[1]!.eventName,
    kind: "Reply",
    reason: todayWorkFixture.replies[1]!.reason,
    due: "10:30 AM",
    location: `${todayWorkFixture.replies[1]!.city}, ${todayWorkFixture.replies[1]!.region}`,
    followUpStatus: "Reply due today",
    source: todayWorkFixture.replies[1],
  },
];

const travelLegs = [
  { id: "north", name: "North Route" },
  { id: "central", name: "Central Circuit" },
  { id: "coastal", name: "Coastal Loop" },
];

function SimplifiedQueue({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Your work</CardTitle>
        <Badge variant="outline">4 open</Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <RadioGroup aria-label="Select work item" className="gap-0" onValueChange={onSelect} value={activeId}>
          {dailyQueue.map((item) => (
            <div className="flex items-start gap-3 border-t border-border py-3" key={item.id}>
              <RadioGroupItem className="mt-1" id={`work-${item.id}`} value={item.id} />
              <Label className="grid min-w-0 flex-1 cursor-pointer gap-1" htmlFor={`work-${item.id}`}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{item.name}</span>
                  {activeId === item.id ? <Badge variant="secondary">Next</Badge> : null}
                  <span className="text-xs text-muted-foreground">{item.due}</span>
                </span>
                <span className="text-sm text-muted-foreground">{item.kind} · {item.reason}</span>
                <span className="text-xs text-muted-foreground">{item.location}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

export function SimplifiedTodayFlow() {
  const [activeId, setActiveId] = useState(dailyQueue[0]!.id);
  const [assignedLegId, setAssignedLegId] = useState(dailyQueue[0]!.assignedLegId ?? "");
  const [legFeedback, setLegFeedback] = useState<string | null>(null);
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [followUpKind, setFollowUpKind] = useState("email");
  const [followUpDate, setFollowUpDate] = useState("2026-06-17");
  const [followUpNote, setFollowUpNote] = useState("Check whether the event committee has confirmed its dates.");
  const [followUpPreview, setFollowUpPreview] = useState<{ summary: string; note: string } | null>(null);
  const activeWork = dailyQueue.find((item) => item.id === activeId) ?? dailyQueue[0]!;
  const suggestedLeg = travelLegs.find((leg) => leg.id === activeWork.suggestedLegId);
  const assignedLeg = travelLegs.find((leg) => leg.id === assignedLegId);

  function selectWorkItem(id: string) {
    const nextWork = dailyQueue.find((item) => item.id === id);
    setActiveId(id);
    setAssignedLegId(nextWork?.assignedLegId ?? "");
    setLegFeedback(null);
    setFollowUpPreview(null);
    setShowFollowUpForm(false);
  }

  function schedulePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formattedDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
      .format(new Date(`${followUpDate}T12:00:00`));
    setFollowUpPreview({
      summary: `${followUpKind === "email" ? "Email" : followUpKind === "call" ? "Call" : "Web contact"} · ${formattedDate}`,
      note: followUpNote,
    });
    setShowFollowUpForm(false);
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto grid max-w-6xl gap-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">Command Center</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1>
            <p className="mt-1 text-sm text-muted-foreground">Tuesday · June 16, 2026</p>
          </div>
          <Badge variant="secondary">2 follow-ups due today</Badge>
        </header>

        <Alert>
          <AlertTitle>Prototype preview</AlertTitle>
          <AlertDescription>Queue selection, leg changes, and follow-up reminders are local previews only. Nothing is saved to the CRM.</AlertDescription>
        </Alert>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="grid content-start gap-3" aria-label="Daily work queue">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold">One queue, one next step</h2>
              <p className="text-sm text-muted-foreground">Overdue first · due today next</p>
            </div>
            <SimplifiedQueue activeId={activeId} onSelect={selectWorkItem} />
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <div>
                  <p className="font-semibold">Waiting &amp; scheduled</p>
                  <p className="text-sm text-muted-foreground">{todayWorkFixture.waiting.length} waiting · {todayWorkFixture.later.length} later</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setLegFeedback("Waiting and scheduled work is previewed in the source queue.")}>View later work</Button>
              </CardContent>
            </Card>
          </section>

          <section className="grid content-start gap-3" aria-label="Selected follow-up">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">Next step</h2>
              <Badge>Selected work</Badge>
            </div>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>{activeWork.name}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{activeWork.location} · {activeWork.kind}</p>
                  </div>
                  <Badge variant="secondary">{followUpPreview ? "Preview reminder set" : activeWork.followUpStatus}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 pt-0">
                <div className="rounded-lg border border-border bg-muted p-4">
                  <p className="font-semibold">Follow-up path</p>
                  <p className="mt-1 text-sm text-muted-foreground">{activeWork.reason}</p>
                  {followUpPreview ? (
                    <>
                      <p className="mt-3 text-sm font-semibold" role="status">Preview reminder: {followUpPreview.summary}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{followUpPreview.note}</p>
                    </>
                  ) : activeWork.followUpStatus === "No reminder scheduled" ? (
                    <p className="mt-3 text-sm text-muted-foreground">No future reminder is on this booking.</p>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">This work item already has a clear due time in the queue.</p>
                  )}
                  {showFollowUpForm ? (
                    <form className="mt-4 grid gap-3 border-t border-border pt-4" onSubmit={schedulePreview}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="grid gap-1">
                          <Label htmlFor="follow-up-kind">Contact method</Label>
                          <Select value={followUpKind} onValueChange={setFollowUpKind}>
                            <SelectTrigger id="follow-up-kind" aria-label="Contact method">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="call">Call</SelectItem>
                              <SelectItem value="web">Web contact</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-1">
                          <Label htmlFor="follow-up-date">Reminder date</Label>
                          <Input required id="follow-up-date" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
                        </div>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="follow-up-note">Note</Label>
                        <Textarea id="follow-up-note" required value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" size="sm">Add preview reminder</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setShowFollowUpForm(false)}>Cancel</Button>
                      </div>
                    </form>
                  ) : (
                    <Button className="mt-4" onClick={() => setShowFollowUpForm(true)}>Schedule follow-up</Button>
                  )}
                </div>

                {activeWork.assignedLegId || activeWork.suggestedLegId ? <div className="grid gap-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">Leg assignment</p>
                      <p className="text-sm text-muted-foreground">Booking · AZ-2026-0418 · Boss view</p>
                    </div>
                    <Badge variant="outline">Existing assignment</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested leg</p>
                      <p className="mt-1 font-semibold">{suggestedLeg?.name ?? "Needs leg assignment"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Based on saved event dates and location · Medium confidence</p>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="assigned-leg">Assigned leg · Boss</Label>
                      <Select
                        value={assignedLegId}
                        onValueChange={(value) => {
                          setAssignedLegId(value);
                          const nextLeg = travelLegs.find((leg) => leg.id === value);
                          setLegFeedback(`Preview only · Assigned leg shown as ${nextLeg?.name ?? "unassigned"}.`);
                        }}
                      >
                        <SelectTrigger id="assigned-leg" aria-label="Assigned leg">
                          <SelectValue placeholder="Choose assigned leg" />
                        </SelectTrigger>
                        <SelectContent>
                          {travelLegs.map((leg) => <SelectItem key={leg.id} value={leg.id}>{leg.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Current display: {assignedLeg?.name ?? "No saved assignment"}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">The suggested route remains visible beside the current assignment; changing this preview does not save or overwrite a CRM record.</p>
                  {legFeedback ? <p className="text-sm font-semibold" role="status">{legFeedback}</p> : null}
                </div> : null}

                <p className="text-sm text-muted-foreground">Contact: Jamie Larson · Event coordinator · Last contacted Jun 9</p>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}
