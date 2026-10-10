import { useState, type FormEvent } from "react";
import { Check, ChevronDown, Mail, MapPinned, MessageSquare, Plus } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/avz-crm/components/ui/accordion";
import { Avatar, AvatarFallback } from "@workspace/avz-crm/components/ui/avatar";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";

type WorkItem = {
  id: string;
  event: string;
  kind: string;
  person: string;
  initials: string;
  city: string;
  state: string;
  when: string;
  next: string;
  status: string;
  suggestedLeg: string;
  assignedLeg?: string;
  contactRole: string;
  lastContact: string;
  relationshipHistory: string;
  editionDetails: string;
  newestNote: string;
  emailSubject: string;
  emailBody: string;
  emailDate: string;
};

type Destination = { label: string; href: string };
type DestinationGroup = { label: string; items: Destination[] };

const workItems: WorkItem[] = [
  {
    id: "pine",
    event: "Pine County Festival",
    kind: "New lead · reply due",
    person: "Avery Cole",
    initials: "AC",
    city: "Stillwater",
    state: "MN",
    when: "Aug 7–8, 2027 · estimated",
    next: "Reply to the inquiry and confirm the 2027 festival dates.",
    status: "Needs a reply",
    suggestedLeg: "North Route",
    assignedLeg: "Central Circuit",
    contactRole: "Event coordinator",
    lastContact: "Jun 9, 2026",
    relationshipHistory: "4-year relationship · last season’s load-in was smooth; the committee is planning a return.",
    editionDetails: "Pine County Fairgrounds · outdoor site · vendor load-in from 7:00 AM. Crew entrance off 3rd Street; check in at the blue gate.",
    newestNote: "Avery expects the committee to lock the weekend after the county meeting. Asked us to check back Friday.",
    emailSubject: "Pine County Festival dates for next year",
    emailBody: "We are beginning to plan next summer and expect to confirm the August weekend after our county meeting. Could you share your availability?",
    emailDate: "Jun 16, 2026",
  },
  {
    id: "riverside",
    event: "Riverside Arts Festival",
    kind: "Post-event follow-up",
    person: "Morgan Bell",
    initials: "MB",
    city: "Hudson",
    state: "WI",
    when: "Sep 12–13, 2025 · past event",
    next: "Ask Morgan how the event went and whether next season is taking shape.",
    status: "Follow-up due today",
    suggestedLeg: "Central Circuit",
    contactRole: "Festival director",
    lastContact: "Jun 9, 2026",
    relationshipHistory: "2-year relationship · proposal sent; reconnect after the 2025 event before discussing next season.",
    editionDetails: "Riverside Park · Hudson riverfront grounds · organizer access through the north service gate.",
    newestNote: "Morgan asked us to follow up after the festival and reconnect about next season’s dates.",
    emailSubject: "Riverside Arts Festival · proposal follow-up",
    emailBody: "Thanks for sending the proposal. We will review after the festival weekend and talk through next year’s dates.",
    emailDate: "Jun 9, 2026",
  },
  {
    id: "maple",
    event: "Maple Grove Community Fair",
    kind: "Return call",
    person: "Jamie Larson",
    initials: "JL",
    city: "Maple Grove",
    state: "MN",
    when: "Jul 18–19, 2026 · confirmed",
    next: "Return Jamie’s call about setup and arrival timing.",
    status: "Call at 11:00 AM",
    suggestedLeg: "North Route",
    assignedLeg: "North Route",
    contactRole: "Fair coordinator",
    lastContact: "Jun 12, 2026",
    relationshipHistory: "3-year relationship · regular summer booking; arrival timing still needs a call-back.",
    editionDetails: "Maple Grove Town Green · confirmed for 2026 · check in at the service entrance before unloading.",
    newestNote: "Jamie called to ask whether the crew can arrive before the public gate opens.",
    emailSubject: "Maple Grove Community Fair arrival timing",
    emailBody: "Could you call me about the crew arrival window and setup access for July?",
    emailDate: "Jun 15, 2026",
  },
];

const legs = ["North Route", "Central Circuit", "Coastal Loop"];
const stopTypes = ["RV parks", "Walmart", "Mechanic / tire shop", "Oil change", "Hardware", "Bathrooms", "Gas station"];

const workspaceDestinations: Destination[] = [
  { label: "Command Panel", href: "/command" },
  { label: "Booking · Today", href: "/today" },
  { label: "Marketing", href: "/marketing" },
  { label: "Operations · Leg management", href: "/operations/legs" },
  { label: "Admin Tools · Settings", href: "/settings" },
];

const destinationGroups: DestinationGroup[] = [
  {
    label: "Booking tools",
    items: [
      { label: "Profiles", href: "/profiles" },
      { label: "Add a New Profile", href: "/event-profiles/new" },
      { label: "Emails", href: "/emails" },
      { label: "Emails needing review", href: "/emails?view=review" },
      { label: "Schedule & Routes", href: "/schedule" },
      { label: "Documents", href: "/business-documents" },
      { label: "Contracts & Invoices", href: "/invoices-contracts" },
      { label: "Dave Requests", href: "/dave-requests" },
      { label: "Calls", href: "/calls/workspace" },
      { label: "New caller", href: "/calls/workspace?mode=add" },
      { label: "Voicemail", href: "/calls/voicemail" },
      { label: "Website Inquiries", href: "/website-inquiries" },
      { label: "Contacts", href: "/contacts" },
      { label: "Add a New Contact", href: "/contacts/new" },
      { label: "Boss Access", href: "/boss-access" },
      { label: "Research Sources", href: "/research-sources" },
      { label: "Needs Answer", href: "/needs-answer" },
    ],
  },
  {
    label: "Operations tools",
    items: [
      { label: "Communications", href: "/manager-communications" },
      { label: "Finances", href: "/manager-finance" },
      { label: "Crew", href: "/manager-crew" },
      { label: "Reviews & incidents", href: "/manager-aftermath" },
      { label: "Route issues", href: "/manager-issues" },
    ],
  },
  {
    label: "Marketing tools",
    items: [{ label: "Design Studio", href: "/design-studio" }],
  },
  {
    label: "Admin & tools",
    items: [
      { label: "Assistant workspace", href: "/assistant/workspace" },
      { label: "Paper notes", href: "/settings/paper-notes" },
      { label: "ACT! import", href: "/settings/act-migration" },
      { label: "ACT Recovery", href: "/settings/act-recovery" },
      { label: "Attendance history", href: "/imports/attendance-history" },
      { label: "Business sources", href: "/settings/business-sources" },
      { label: "Certificates of insurance", href: "/settings/coi" },
      { label: "Packages & resources", href: "/settings/packages-resources" },
      { label: "Call scripts", href: "/settings/call-scripts" },
      { label: "Email templates", href: "/settings/communication-templates" },
      { label: "Google Workspace", href: "/settings/google-workspace" },
    ],
  },
];

function workspaceForRoute(route: string) {
  if (route === "/command") return "Command Panel";
  if (route === "/marketing" || route === "/design-studio") return "Marketing";
  if (route.startsWith("/operations/") || route.startsWith("/manager-")) return "Operations";
  if (route.startsWith("/settings") || route.startsWith("/imports/")) return "Admin Tools";
  return "Booking";
}

function CrmNavigation({
  activeRoute,
  workspace,
  onNavigate,
}: {
  activeRoute: string;
  workspace: string;
  onNavigate: (destination: Destination) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`Open CRM navigation. Current workspace: ${workspace}`} size="sm" variant="outline">
          {workspace} <ChevronDown className="ml-1 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaceDestinations.map((item) => (
          <DropdownMenuItem key={item.href} onSelect={() => onNavigate(item)}>
            {activeRoute === item.href ? <Check className="mr-2 h-4 w-4 text-primary" /> : null}
            {item.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>All destinations · CRM roles still apply</DropdownMenuLabel>
        {destinationGroups.map((group) => (
          <DropdownMenuSub key={group.label}>
            <DropdownMenuSubTrigger>{group.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {group.items.map((item) => (
                <DropdownMenuItem key={`${group.label}:${item.href}`} onSelect={() => onNavigate(item)}>
                  {activeRoute === item.href ? <Check className="mr-2 h-4 w-4 text-primary" /> : null}
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WholeCrmSimplification() {
  const [activeId, setActiveId] = useState(workItems[0]!.id);
  const [activeRoute, setActiveRoute] = useState("/today");
  const [workspace, setWorkspace] = useState("Booking");
  const [assignedLeg, setAssignedLeg] = useState(workItems[0]!.assignedLeg ?? "");
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState("Could you confirm the festival dates and whether the August weekend is still being planned?");
  const [prepared, setPrepared] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [emailOpen, setEmailOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [stopType, setStopType] = useState("RV parks");
  const [stopName, setStopName] = useState("");
  const [stopCity, setStopCity] = useState("");
  const [savedStops, setSavedStops] = useState<Array<{ type: string; name: string; city: string }>>([]);
  const activeWork = workItems.find((item) => item.id === activeId) ?? workItems[0]!;
  const newestNote = noteOverrides[activeId] ?? activeWork.newestNote;

  function selectWork(id: string) {
    const item = workItems.find((work) => work.id === id);
    if (!item) return;
    setActiveId(id);
    setAssignedLeg(item.assignedLeg ?? "");
    setDraft(`Thanks for getting in touch about ${item.event}. ${item.next}`);
    setPrepared(false);
    setReplyOpen(false);
    setEmailOpen(false);
    setNoteDraft("");
    setFeedback("");
  }

  function navigate(destination: Destination) {
    setActiveRoute(destination.href);
    setWorkspace(workspaceForRoute(destination.href));
    setFeedback(`${destination.label} · ${destination.href} · prototype navigation only.`);
  }

  function prepareReply() {
    setPrepared(true);
    setReplyOpen(false);
    setFeedback("Reply draft prepared locally. It was not sent or saved.");
  }

  function addManualStop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stopName.trim() || !stopCity.trim()) return;
    setSavedStops((current) => [...current, { type: stopType, name: stopName.trim(), city: stopCity.trim() }]);
    setFeedback("Manual stop added to this preview only.");
    setStopName("");
    setStopCity("");
  }

  function addLocalNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!noteDraft.trim()) return;
    setNoteOverrides((current) => ({ ...current, [activeId]: noteDraft.trim() }));
    setNoteDraft("");
    setFeedback("Note updated in this preview only.");
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img alt="Adventure Zone logo" className="h-8 w-20 shrink-0 object-contain sm:w-24" src="/__mockup/adventure-zone-logo.png" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">Festival workbench</p>
              <p className="truncate text-xs text-muted-foreground">Adventure Zone CRM</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CrmNavigation activeRoute={activeRoute} onNavigate={navigate} workspace={workspace} />
            <Avatar className="h-8 w-8"><AvatarFallback>DS</AvatarFallback></Avatar>
            <span className="hidden text-sm font-semibold sm:inline">Des</span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl content-start gap-4 px-3 py-4 pb-8 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">{workspace} workspace · Tuesday, June 16, 2026</p>
              <Badge variant="outline">Local preview</Badge>
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1>
            <p className="mt-1 text-sm text-muted-foreground">One selected record, one next action.</p>
          </div>
          <div className="grid w-full min-w-0 gap-1 sm:w-72">
            <Label htmlFor="selected-work">Selected work</Label>
            <Select onValueChange={selectWork} value={activeId}>
              <SelectTrigger className="min-w-0" id="selected-work"><SelectValue className="truncate" /></SelectTrigger>
              <SelectContent>
                {workItems.map((item) => <SelectItem key={item.id} value={item.id}>{item.event} · {item.kind}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {feedback ? <p aria-live="polite" className="text-xs text-muted-foreground">{feedback}</p> : null}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar className="h-11 w-11"><AvatarFallback>{activeWork.initials}</AvatarFallback></Avatar>
                <div className="min-w-0">
                  <CardTitle>{activeWork.event}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{activeWork.city}, {activeWork.state} · {activeWork.person}, {activeWork.contactRole}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{activeWork.when}</p>
                </div>
              </div>
              <Badge variant={completed[activeId] ? "outline" : "secondary"}>{completed[activeId] ? "Completed in preview" : activeWork.status}</Badge>
            </div>
          </CardHeader>

          <CardContent className="grid gap-4">
            <section aria-label="Selected record next action" className="rounded-lg border border-border bg-muted p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended next action</p>
              <p className="mt-1 text-lg font-semibold">{activeWork.next}</p>
              <p className="mt-2 text-sm text-muted-foreground">{activeWork.kind} · {activeWork.status}</p>
              {prepared ? <p className="mt-3 text-sm font-semibold" role="status">Reply draft ready in this preview. Nothing was sent.</p> : null}
              {replyOpen ? (
                <form className="mt-4 grid gap-2 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); prepareReply(); }}>
                  <Label htmlFor="reply-draft">Reply draft</Label>
                  <Textarea id="reply-draft" onChange={(event) => setDraft(event.target.value)} value={draft} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" type="submit">Prepare draft</Button>
                    <Button onClick={() => setReplyOpen(false)} size="sm" type="button" variant="outline">Cancel</Button>
                  </div>
                </form>
              ) : (
                <Button className="mt-4" onClick={() => setReplyOpen(true)} size="sm">
                  <MessageSquare className="mr-1 h-4 w-4" />{prepared ? "Revise reply" : "Prepare reply"}
                </Button>
              )}
            </section>

            <section aria-label="Suggested and assigned travel leg" className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested leg · Des</p>
                <p className="mt-1 font-semibold">{activeWork.suggestedLeg}</p>
                <p className="mt-1 text-xs text-muted-foreground">Planning suggestion from the event’s dates and location.</p>
              </div>
              <div className="grid content-start gap-1">
                <Label htmlFor="assigned-leg">Current booking assignment · Boss</Label>
                <Select onValueChange={(value) => { setAssignedLeg(value); setFeedback(`Assignment shown as ${value} for this preview only.`); }} value={assignedLeg}>
                  <SelectTrigger id="assigned-leg"><SelectValue placeholder="No saved assignment" /></SelectTrigger>
                  <SelectContent>{legs.map((leg) => <SelectItem key={leg} value={leg}>{leg}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Current: {assignedLeg || "No saved assignment"} · preview choice does not reassign a live booking leg.</p>
              </div>
            </section>

            <section aria-label="Latest relationship activity" className="grid gap-3 rounded-lg border border-border p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Newest organizer note</p>
                <p className="mt-1 text-sm font-semibold">{newestNote}</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Newest email · {activeWork.emailDate}</p>
                  <p className="truncate text-sm text-muted-foreground">{activeWork.emailSubject}</p>
                </div>
                <Button className="shrink-0" onClick={() => setEmailOpen((current) => !current)} size="sm" variant="link">
                  <Mail className="mr-1 h-4 w-4" />{emailOpen ? "Close email preview" : "Open newest email"}
                </Button>
              </div>
              {emailOpen ? (
                <div className="rounded-md bg-muted p-3 text-sm">
                  <p className="font-semibold">From {activeWork.person} · {activeWork.contactRole}</p>
                  <p className="mt-1">{activeWork.emailBody}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Preview only · the full email history remains in Emails.</p>
                </div>
              ) : null}
            </section>

            <Accordion className="grid gap-2" type="multiple">
              <AccordionItem className="rounded-lg border border-border px-4" value="organizer-and-edition">
                <AccordionTrigger>Organizer history &amp; this event year</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organizer relationship</p>
                      <p className="mt-1 text-sm font-semibold">{activeWork.person} · {activeWork.contactRole}</p>
                      <p className="text-sm text-muted-foreground">Last contacted {activeWork.lastContact}</p>
                      <p className="mt-2 text-sm text-muted-foreground">{activeWork.relationshipHistory}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Edition details</p>
                      <p className="mt-1 text-sm font-semibold">{activeWork.when}</p>
                      <p className="mt-2 text-sm text-muted-foreground">{activeWork.editionDetails}</p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="rounded-lg border border-border px-4" value="record-tools">
                <AccordionTrigger>Other record tools</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-4">
                    <form className="grid gap-2" onSubmit={addLocalNote}>
                      <Label htmlFor="note-draft">Add a note</Label>
                      <Textarea id="note-draft" onChange={(event) => setNoteDraft(event.target.value)} placeholder="Add a practical detail from the latest conversation" value={noteDraft} />
                      <Button className="w-fit" disabled={!noteDraft.trim()} size="sm" type="submit">Add note to preview</Button>
                    </form>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <p className="text-sm text-muted-foreground">{completed[activeId] ? "Marked complete in this preview." : "Mark this next step complete when it is done."}</p>
                      <Button disabled={completed[activeId]} onClick={() => { setCompleted((current) => ({ ...current, [activeId]: true })); setFeedback("Marked complete in this preview only."); }} size="sm" variant="outline">
                        {completed[activeId] ? "Completed" : "Mark complete"}
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="rounded-lg border border-border px-4" value="crew-stops">
                <AccordionTrigger>Saved crew directions &amp; manual stops</AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted-foreground">{activeWork.editionDetails}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Stops are added manually. No nearby-search or map provider is connected.</p>
                  <form className="mt-3 grid gap-2 border-t border-border pt-3" onSubmit={addManualStop}>
                    <Label htmlFor="manual-stop-name">Add a manual stop</Label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select onValueChange={setStopType} value={stopType}>
                        <SelectTrigger aria-label="Stop category"><SelectValue /></SelectTrigger>
                        <SelectContent>{stopTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input id="manual-stop-name" onChange={(event) => setStopName(event.target.value)} placeholder="Stop name" value={stopName} />
                    </div>
                    <div className="flex gap-2">
                      <Input aria-label="Stop city and state" onChange={(event) => setStopCity(event.target.value)} placeholder="City, state" value={stopCity} />
                      <Button aria-label="Add manual stop" size="icon" type="submit"><Plus className="h-4 w-4" /></Button>
                    </div>
                    {savedStops.length ? (
                      <ul className="grid gap-2 border-t border-border pt-2">
                        {savedStops.map((stop, index) => (
                          <li className="flex items-center gap-2 text-sm" key={`${stop.name}-${index}`}>
                            <MapPinned className="h-4 w-4 shrink-0 text-primary" />
                            <span className="font-semibold">{stop.name}</span>
                            <span className="text-muted-foreground">{stop.type} · {stop.city}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </form>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
