import { useState, type FormEvent } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ContactRound,
  Ellipsis,
  FolderOpen,
  House,
  Inbox,
  Mail,
  MapPinned,
  MessageSquare,
  Plus,
} from "lucide-react";
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
import {
  DemoDocuments,
  EmailInbox,
  EmailThreadScreen,
  ProfileDetailScreen,
  ProfilesDirectory,
  ScheduleScreen,
  type CrmWorkItem,
} from "./WholeCrmRouteScreens";
import { ScheduleRouteMap } from "./ScheduleRouteMap";

type Destination = { label: string; href: string };
type DestinationGroup = { label: string; items: Destination[] };
type Screen = "today" | "profiles" | "profile-detail" | "emails" | "email-thread" | "schedule" | "documents" | "unmodeled";
type BackTarget = { screen: Screen; route: string; label: string };
type ManualStop = { type: string; name: string; city: string };
type StopDraft = { type: string; name: string; city: string };

const workItems: CrmWorkItem[] = [
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

const primaryDestinations = [
  { href: "/today", label: "Today", icon: House },
  { href: "/profiles", label: "Profiles", icon: ContactRound },
  { href: "/emails", label: "Emails", icon: Inbox },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/business-documents", label: "Documents", icon: FolderOpen },
];

const workspaceDestinations: Destination[] = [
  { label: "Command Panel", href: "/command" },
  { label: "Marketing", href: "/marketing" },
  { label: "Legs & Operations", href: "/operations/legs" },
  { label: "Admin Tools · Settings", href: "/settings" },
];

const destinationGroups: DestinationGroup[] = [
  {
    label: "Booking tools",
    items: [
      { label: "Add a New Profile", href: "/event-profiles/new" },
      { label: "Emails needing review", href: "/emails?view=review" },
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
  { label: "Marketing tools", items: [{ label: "Design Studio", href: "/design-studio" }] },
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
  if (route.startsWith("/operations/") || route.startsWith("/manager-")) return "Legs & Operations";
  if (route.startsWith("/settings") || route.startsWith("/imports/")) return "Admin Tools";
  return "Booking";
}

function CrmPrimaryNavigation({ activeRoute, onNavigate }: { activeRoute: string; onNavigate: (destination: Destination) => void }) {
  return (
    <nav aria-label="Primary CRM navigation" className="grid w-full grid-cols-3 gap-1 pb-2 sm:flex">
      {primaryDestinations.map(({ href, label, icon: Icon }) => {
        const active = activeRoute === href || activeRoute.startsWith(`${href}/`);
        return (
          <Button
            aria-current={active ? "page" : undefined}
            className="w-full min-w-0 px-1 text-xs sm:w-auto sm:flex-1 sm:px-3 sm:text-sm"
            key={href}
            onClick={() => onNavigate({ href, label })}
            size="sm"
            variant={active ? "secondary" : "ghost"}
          >
            <Icon className="hidden h-4 w-4 shrink-0 md:block" />
            <span className="truncate">{label}</span>
          </Button>
        );
      })}
    </nav>
  );
}

function CrmMoreMenu({
  activeRoute,
  onNavigate,
}: {
  activeRoute: string;
  onNavigate: (destination: Destination) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="More CRM destinations and tools" size="sm" variant="ghost">
          <Ellipsis className="mr-1 h-4 w-4" />More <ChevronDown className="ml-1 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel>More workspaces</DropdownMenuLabel>
        {workspaceDestinations.map((item) => (
          <DropdownMenuItem key={item.href} onSelect={() => onNavigate(item)}>
            {activeRoute === item.href ? <Check className="mr-2 h-4 w-4 text-primary" /> : null}
            {item.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Other destinations · live CRM role rules apply</DropdownMenuLabel>
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

function getDefaultDraft(item: CrmWorkItem) {
  return item.id === "pine"
    ? "Could you confirm the festival dates and whether the August weekend is still being planned?"
    : `Thanks for getting in touch about ${item.event}. ${item.next}`;
}

function screenLabel(screen: Screen) {
  if (screen === "today") return "Today";
  if (screen === "profiles" || screen === "profile-detail") return "Profiles";
  if (screen === "emails" || screen === "email-thread") return "Emails";
  if (screen === "schedule") return "Schedule";
  if (screen === "documents") return "Documents";
  return "Destination";
}

export function WholeCrmSimplification() {
  const previewScreen: Screen = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("screen") === "schedule"
    ? "schedule"
    : "today";
  const [activeId, setActiveId] = useState(workItems[0]!.id);
  const [activeRoute, setActiveRoute] = useState(previewScreen === "schedule" ? "/schedule" : "/today");
  const [workspace, setWorkspace] = useState("Booking");
  const [screen, setScreen] = useState<Screen>(previewScreen);
  const [destinationLabel, setDestinationLabel] = useState("");
  const [backTarget, setBackTarget] = useState<BackTarget>({ screen: "today", route: "/today", label: "Today" });
  const [selectedLegs, setSelectedLegs] = useState<Record<string, string>>(() =>
    Object.fromEntries(workItems.map((item) => [item.id, item.assignedLeg ?? ""])),
  );
  const [replyOpenById, setReplyOpenById] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(workItems.map((item) => [item.id, getDefaultDraft(item)])),
  );
  const [preparedById, setPreparedById] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState("");
  const [completedById, setCompletedById] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [stopDrafts, setStopDrafts] = useState<Record<string, StopDraft>>({});
  const [savedStops, setSavedStops] = useState<Record<string, ManualStop[]>>({});
  const activeWork = workItems.find((item) => item.id === activeId) ?? workItems[0]!;
  const selectedLeg = selectedLegs[activeId] ?? "";
  const newestNote = noteOverrides[activeId] ?? activeWork.newestNote;
  const currentStopDraft = stopDrafts[activeId] ?? { type: "RV parks", name: "", city: "" };

  function selectWork(id: string) {
    if (!workItems.some((item) => item.id === id)) return;
    setActiveId(id);
    setFeedback("");
  }

  function openProfile(id: string) {
    selectWork(id);
    setActiveRoute("/profiles");
    setWorkspace("Booking");
    setScreen("profile-detail");
  }

  function openEmail(id: string) {
    selectWork(id);
    setActiveRoute("/emails");
    setWorkspace("Booking");
    setScreen("email-thread");
  }

  function navigate(destination: Destination) {
    const route = destination.href;
    const path = route.split("?")[0] ?? route;
    const primaryTarget: Partial<Record<string, Screen>> = {
      "/today": "today",
      "/profiles": "profiles",
      "/emails": "emails",
      "/schedule": "schedule",
      "/business-documents": "documents",
    };
    const nextScreen = route === "/emails?view=review" ? undefined : primaryTarget[path];
    setActiveRoute(route);
    setWorkspace(workspaceForRoute(path));
    setFeedback("");
    if (nextScreen) {
      setScreen(nextScreen);
      if (nextScreen === "profiles" || nextScreen === "emails" || nextScreen === "documents") setDestinationLabel("");
      return;
    }
    setBackTarget({ screen, route: activeRoute, label: screenLabel(screen) });
    setDestinationLabel(destination.label);
    setScreen("unmodeled");
  }

  function goBack() {
    setScreen(backTarget.screen);
    setActiveRoute(backTarget.route);
    setWorkspace(workspaceForRoute(backTarget.route));
    setDestinationLabel("");
  }

  function goToToday() {
    setActiveRoute("/today");
    setWorkspace("Booking");
    setScreen("today");
    setDestinationLabel("");
    setFeedback("");
  }

  function prepareReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreparedById((current) => ({ ...current, [activeId]: true }));
    setReplyOpenById((current) => ({ ...current, [activeId]: false }));
    setFeedback("Reply draft prepared locally. It was not sent or saved.");
  }

  function saveLocalNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = (noteDrafts[activeId] ?? "").trim();
    if (!note) return;
    setNoteOverrides((current) => ({ ...current, [activeId]: note }));
    setNoteDrafts((current) => ({ ...current, [activeId]: "" }));
    setFeedback("Note updated in this preview only.");
  }

  function addManualStop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = currentStopDraft;
    if (!draft.name.trim() || !draft.city.trim()) return;
    setSavedStops((current) => ({
      ...current,
      [activeId]: [...(current[activeId] ?? []), { ...draft, name: draft.name.trim(), city: draft.city.trim() }],
    }));
    setStopDrafts((current) => ({ ...current, [activeId]: { ...draft, name: "", city: "" } }));
    setFeedback("Manual stop added to this preview only.");
  }

  const screenBody = screen === "today" ? (
    <div className="mx-auto grid max-w-5xl content-start gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">{workspace} workspace · Tuesday, June 16, 2026</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">One selected record, one next action.</p>
        </div>
        <div className="grid w-full min-w-0 gap-1 sm:w-72">
          <Label htmlFor="selected-work">Selected work</Label>
          <Select onValueChange={selectWork} value={activeId}>
            <SelectTrigger className="min-w-0" id="selected-work"><SelectValue className="truncate" /></SelectTrigger>
            <SelectContent>{workItems.map((item) => <SelectItem key={item.id} value={item.id}>{item.event} · {item.kind}</SelectItem>)}</SelectContent>
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
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={completedById[activeId] ? "outline" : "secondary"}>{completedById[activeId] ? "Completed in preview" : activeWork.status}</Badge>
              <Button onClick={() => openProfile(activeId)} size="sm" variant="outline">Open profile</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <section aria-label="Selected record next action" className="rounded-lg border border-border bg-muted p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended next action</p>
            <p className="mt-1 text-lg font-semibold">{activeWork.next}</p>
            <p className="mt-2 text-sm text-muted-foreground">{activeWork.kind} · {activeWork.status}</p>
            {preparedById[activeId] ? <p className="mt-3 text-sm font-semibold" role="status">Reply draft ready in this preview. Nothing was sent.</p> : null}
            {replyOpenById[activeId] ? (
              <form className="mt-4 grid gap-2 border-t border-border pt-4" onSubmit={prepareReply}>
                <Label htmlFor="reply-draft">Reply draft</Label>
                <Textarea id="reply-draft" onChange={(event) => setDrafts((current) => ({ ...current, [activeId]: event.target.value }))} value={drafts[activeId] ?? ""} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" type="submit">Prepare draft</Button>
                  <Button onClick={() => setReplyOpenById((current) => ({ ...current, [activeId]: false }))} size="sm" type="button" variant="outline">Cancel</Button>
                </div>
              </form>
            ) : (
              <Button className="mt-4" onClick={() => setReplyOpenById((current) => ({ ...current, [activeId]: true }))} size="sm">
                <MessageSquare className="mr-1 h-4 w-4" />{preparedById[activeId] ? "Revise reply" : "Prepare reply"}
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
              <Select onValueChange={(value) => { setSelectedLegs((current) => ({ ...current, [activeId]: value })); setFeedback(`Assignment shown as ${value} for this preview only.`); }} value={selectedLeg}>
                <SelectTrigger id="assigned-leg"><SelectValue placeholder="No saved assignment" /></SelectTrigger>
                <SelectContent>{legs.map((leg) => <SelectItem key={leg} value={leg}>{leg}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Current: {selectedLeg || "No saved assignment"} · preview choice does not reassign a live booking leg.</p>
              <Button className="w-fit" onClick={() => navigate({ href: "/schedule", label: "Schedule" })} size="sm" variant="link">
                <MapPinned className="mr-1 h-4 w-4" />View route map
              </Button>
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
              <Button className="shrink-0" onClick={() => openEmail(activeId)} size="sm" variant="link">
                <Mail className="mr-1 h-4 w-4" />Open newest email
              </Button>
            </div>
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
                  <form className="grid gap-2" onSubmit={saveLocalNote}>
                    <Label htmlFor="note-draft">Add a note</Label>
                    <Textarea id="note-draft" onChange={(event) => setNoteDrafts((current) => ({ ...current, [activeId]: event.target.value }))} placeholder="Add a practical detail from the latest conversation" value={noteDrafts[activeId] ?? ""} />
                    <Button className="w-fit" disabled={!(noteDrafts[activeId] ?? "").trim()} size="sm" type="submit">Add note to preview</Button>
                  </form>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <p className="text-sm text-muted-foreground">{completedById[activeId] ? "Marked complete in this preview." : "Mark this next step complete when it is done."}</p>
                    <Button disabled={completedById[activeId]} onClick={() => { setCompletedById((current) => ({ ...current, [activeId]: true })); setFeedback("Marked complete in this preview only."); }} size="sm" variant="outline">
                      {completedById[activeId] ? "Completed" : "Mark complete"}
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
                    <Select onValueChange={(type) => setStopDrafts((current) => ({ ...current, [activeId]: { ...currentStopDraft, type } }))} value={currentStopDraft.type}>
                      <SelectTrigger aria-label="Stop category"><SelectValue /></SelectTrigger>
                      <SelectContent>{stopTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input id="manual-stop-name" onChange={(event) => setStopDrafts((current) => ({ ...current, [activeId]: { ...currentStopDraft, name: event.target.value } }))} placeholder="Stop name" value={currentStopDraft.name} />
                  </div>
                  <div className="flex gap-2">
                    <Input aria-label="Stop city and state" onChange={(event) => setStopDrafts((current) => ({ ...current, [activeId]: { ...currentStopDraft, city: event.target.value } }))} placeholder="City, state" value={currentStopDraft.city} />
                    <Button aria-label="Add manual stop" size="icon" type="submit"><Plus className="h-4 w-4" /></Button>
                  </div>
                  {(savedStops[activeId] ?? []).length ? (
                    <ul className="grid gap-2 border-t border-border pt-2">
                      {(savedStops[activeId] ?? []).map((stop, index) => (
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
    </div>
  ) : screen === "profiles" ? (
    <ProfilesDirectory onOpenProfile={openProfile} workItems={workItems} />
  ) : screen === "profile-detail" ? (
    <ProfileDetailScreen
      item={activeWork}
      note={newestNote}
      noteDraft={noteDrafts[activeId] ?? ""}
      onBack={() => { setScreen("profiles"); setActiveRoute("/profiles"); }}
      onNoteDraftChange={(value) => setNoteDrafts((current) => ({ ...current, [activeId]: value }))}
      onOpenEmail={() => openEmail(activeId)}
      onSaveNote={saveLocalNote}
    />
  ) : screen === "emails" ? (
    <EmailInbox onOpenEmail={openEmail} onOpenProfile={openProfile} workItems={workItems} />
  ) : screen === "email-thread" ? (
    <EmailThreadScreen item={activeWork} onBack={() => { setScreen("emails"); setActiveRoute("/emails"); }} onOpenProfile={() => openProfile(activeId)} />
  ) : screen === "schedule" ? (
    <div className="grid gap-4">
      <ScheduleRouteMap assignedLegs={selectedLegs} workItems={workItems} />
      <ScheduleScreen assignedLegs={selectedLegs} onOpenProfile={openProfile} workItems={workItems} />
    </div>
  ) : screen === "documents" ? (
    <DemoDocuments workItems={workItems} />
  ) : (
    <Card>
      <CardHeader>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Secondary destination · preview</p>
        <CardTitle className="mt-1">{destinationLabel}</CardTitle>
        <p className="text-sm text-muted-foreground">{activeRoute}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-lg border border-border bg-muted p-4">
          <p className="font-semibold">This destination is not yet modeled in this prototype.</p>
          <p className="mt-1 text-sm text-muted-foreground">You have left Today. No live CRM data is loaded and no backend action is available on this demo screen.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={goBack} size="sm" variant="outline">Back to {backTarget.label}</Button>
          <Button onClick={goToToday} size="sm">Go to Today</Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-3 pt-3 sm:px-6">
          <div className="flex items-center gap-3 pb-2">
            <img alt="Adventure Zone logo" className="h-8 w-20 shrink-0 object-contain sm:w-24" src="/__mockup/adventure-zone-logo.png" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">Festival workbench</p>
              <p className="truncate text-xs text-muted-foreground">Adventure Zone CRM</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <CrmMoreMenu activeRoute={activeRoute} onNavigate={navigate} />
              <Avatar className="h-8 w-8"><AvatarFallback>DS</AvatarFallback></Avatar>
              <span className="hidden text-sm font-semibold sm:inline">Des</span>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-border pt-2">
            <CrmPrimaryNavigation activeRoute={activeRoute} onNavigate={navigate} />
            <Badge className="mb-2 hidden shrink-0 sm:inline-flex" variant="outline">Preview only · no live sends or saves</Badge>
          </div>
        </div>
      </header>
      <main className="mx-auto min-h-dvh max-w-7xl px-3 py-4 pb-8 sm:px-6 sm:py-6">
        <div className="mb-4 sm:hidden"><Badge variant="outline">Preview only · no live sends or saves</Badge></div>
        {screenBody}
      </main>
    </div>
  );
}
