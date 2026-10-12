import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleHelp,
  ContactRound,
  FolderOpen,
  House,
  Inbox,
  Mail,
  MapPinned,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  StickyNote,
  UsersRound,
} from "lucide-react";
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
  type CrmWorkItem,
} from "./WholeCrmRouteScreens";
import { ScheduleRouteMap } from "./ScheduleRouteMap";
import { ScheduleScreen } from "./WholeCrmRouteScreens";

type Destination = { href: string; label: string };
type Screen = "today" | "profiles" | "profile-detail" | "emails" | "email-thread" | "schedule" | "documents" | "other";
type FilterView = "all" | "attention" | "confirmed";

const initialWork: CrmWorkItem[] = [
  {
    id: "pine",
    event: "Pine County Festival",
    kind: "New lead · reply due",
    person: "Avery Cole",
    initials: "AC",
    city: "Stillwater",
    state: "MN",
    when: "Aug 7–8, 2027 · estimated",
    next: "Reply to Avery and confirm the festival dates.",
    status: "Needs a reply",
    suggestedLeg: "North Route",
    assignedLeg: "Central Circuit",
    contactRole: "Event coordinator",
    lastContact: "Oct 12, 2026",
    relationshipHistory: "4-year relationship · last season’s load-in was smooth; the committee is planning a return.",
    editionDetails: "Pine County Fairgrounds · outdoor site · vendor load-in from 7:00 AM. Crew entrance off 3rd Street; check in at the blue gate.",
    newestNote: "Avery expects the committee to lock the 2027 weekend after Monday’s meeting. Asked us to check back Friday, Oct 16.",
    emailSubject: "Pine County Festival dates for next year",
    emailBody: "We are beginning to plan next summer and expect to confirm the August weekend after our county meeting. Could you share your availability?",
    emailDate: "Oct 12, 2026",
  },
  {
    id: "riverside",
    event: "Riverside Arts Festival",
    kind: "Post-event follow-up",
    person: "Morgan Bell",
    initials: "MB",
    city: "Hudson",
    state: "WI",
    when: "Sep 12–13, 2026 · past event",
    next: "Check in with Morgan about next season’s dates.",
    status: "Follow-up due",
    suggestedLeg: "Central Circuit",
    assignedLeg: "Central Circuit",
    contactRole: "Festival director",
    lastContact: "Oct 9, 2026",
    relationshipHistory: "2-year relationship · proposal sent; reconnect after the festival weekend before discussing next season.",
    editionDetails: "Riverside Park · Hudson riverfront grounds · organizer access through the north service gate.",
    newestNote: "Morgan asked us to follow up after the festival and reconnect about next season’s dates.",
    emailSubject: "Riverside Arts Festival · proposal follow-up",
    emailBody: "Thanks for sending the proposal. We will review after the festival weekend and talk through next year’s dates.",
    emailDate: "Oct 9, 2026",
  },
  {
    id: "maple",
    event: "Maple Grove Community Fair",
    kind: "Return call",
    person: "Jamie Larson",
    initials: "JL",
    city: "Maple Grove",
    state: "MN",
    when: "Jul 18–19, 2027 · confirmed",
    next: "Call Jamie about crew arrival and setup access.",
    status: "Confirmed",
    suggestedLeg: "North Route",
    assignedLeg: "North Route",
    contactRole: "Fair coordinator",
    lastContact: "Oct 10, 2026",
    relationshipHistory: "3-year relationship · regular summer booking; arrival timing still needs a call-back.",
    editionDetails: "Maple Grove Town Green · confirmed for 2026 · check in at the service entrance before unloading.",
    newestNote: "Jamie called to ask whether the crew can arrive before the public gate opens.",
    emailSubject: "Maple Grove Community Fair arrival timing",
    emailBody: "Could you call me about the crew arrival window and setup access for July?",
    emailDate: "Oct 10, 2026",
  },
];

const primaryNav = [
  { href: "/today", label: "Today", icon: House },
  { href: "/profiles", label: "Profiles", icon: ContactRound },
  { href: "/emails", label: "Emails", icon: Inbox },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/business-documents", label: "Documents", icon: FolderOpen },
];
const bookingTools = [
  { href: "/event-profiles/new", label: "Add a New Profile" },
  { href: "/emails?view=review", label: "Emails needing review" },
  { href: "/invoices-contracts", label: "Contracts & Invoices" },
  { href: "/dave-requests", label: "Dave Requests" },
  { href: "/calls/workspace", label: "Calls" },
  { href: "/calls/voicemail", label: "Voicemail" },
  { href: "/website-inquiries", label: "Website Inquiries" },
  { href: "/contacts", label: "Contacts" },
  { href: "/needs-answer", label: "Needs Answer" },
];
const operationsTools = [
  { href: "/operations/legs", label: "Leg management" },
  { href: "/manager-communications", label: "Communications" },
  { href: "/manager-crew", label: "Crew" },
  { href: "/manager-aftermath", label: "Reviews & incidents" },
  { href: "/manager-issues", label: "Route issues" },
];
const adminTools = [
  { href: "/command", label: "Command Panel" },
  { href: "/marketing", label: "Marketing" },
  { href: "/assistant/workspace", label: "Assistant workspace" },
  { href: "/settings", label: "Admin Tools · Settings" },
  { href: "/settings/business-sources", label: "Business sources" },
  { href: "/settings/communication-templates", label: "Email templates" },
];
const statusOptions = ["Needs a reply", "Follow-up due", "Confirmed", "Completed"];
const legs = ["North Route", "Central Circuit", "Coastal Loop"];
const suggestionContext: Record<string, string> = {
  pine: "The newest email asks for date confirmation, and the 2027 edition is still estimated.",
  riverside: "The 2026 event has passed, and Morgan asked to reconnect about next season.",
  maple: "The 2027 booking is confirmed, but the crew arrival question still needs a reply.",
};

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "Needs a reply") return "default";
  if (status === "Follow-up due") return "secondary";
  return "outline";
}

function WorkspaceNavigation({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (destination: Destination) => void;
}) {
  const activeHref = screen === "profile-detail" ? "/profiles" : screen === "email-thread" ? "/emails" : screen === "other" ? "" : screen === "documents" ? "/business-documents" : `/${screen}`;
  return (
    <>
      <aside className="hidden min-h-dvh w-60 shrink-0 flex-col bg-sidebar px-3 py-5 text-sidebar-foreground md:flex">
        <div className="mb-5 px-3">
          <p className="font-display text-lg uppercase tracking-wide">Adventure Zone</p>
          <p className="text-xs text-sidebar-foreground/70">Festival workbench</p>
        </div>
        <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">Workspace</p>
        <nav aria-label="CRM destinations" className="grid gap-1">
          {primaryNav.map(({ href, label, icon: Icon }) => {
            const active = activeHref === href;
            return (
              <Button
                aria-current={active ? "page" : undefined}
                className="justify-start"
                key={href}
                onClick={() => onNavigate({ href, label })}
                variant={active ? "secondary" : "ghost"}
              >
                <Icon className="mr-2 h-4 w-4" />{label}
              </Button>
            );
          })}
        </nav>
        <div className="mt-auto rounded-lg border border-sidebar-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">On the road</p>
          <p className="mt-1 text-sm font-semibold">3 event editions</p>
          <p className="text-xs text-sidebar-foreground/70">Across 2 current legs</p>
        </div>
      </aside>
    </>
  );
}

function MobileWorkspaceNavigation({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (destination: Destination) => void;
}) {
  const activeHref = screen === "profile-detail" ? "/profiles" : screen === "email-thread" ? "/emails" : screen === "other" ? "" : screen === "documents" ? "/business-documents" : `/${screen}`;
  return (
    <nav aria-label="CRM destinations" className="grid grid-cols-5 gap-1 border-b border-border bg-card p-2 md:hidden">
      {primaryNav.map(({ href, label, icon: Icon }) => {
        const active = activeHref === href;
        return (
          <Button
            aria-current={active ? "page" : undefined}
            className="flex-col gap-1 px-1 py-2"
            key={href}
            onClick={() => onNavigate({ href, label })}
            size="sm"
            variant={active ? "secondary" : "ghost"}
          >
            <Icon className="h-4 w-4" /><span className="text-xs">{label}</span>
          </Button>
        );
      })}
    </nav>
  );
}

function MoreDestinations({ onNavigate }: { onNavigate: (destination: Destination) => void }) {
  const groups = [
    { title: "Booking tools", items: bookingTools },
    { title: "Operations tools", items: operationsTools },
    { title: "Other workspaces & admin", items: adminTools },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Open all CRM destinations" size="sm" variant="outline"><MoreHorizontal className="mr-1 h-4 w-4" />More</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel>Other CRM destinations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {groups.map((group) => (
          <DropdownMenuSub key={group.title}>
            <DropdownMenuSubTrigger>{group.title}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {group.items.map((item) => <DropdownMenuItem key={item.href} onSelect={() => onNavigate(item)}>{item.label}</DropdownMenuItem>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BoardRows({
  items,
  activeId,
  completed,
  onSelect,
}: {
  items: CrmWorkItem[];
  activeId: string;
  completed: Record<string, boolean>;
  onSelect: (id: string) => void;
}) {
  const groups = [
    { label: "Needs attention", description: "Replies and follow-ups to move forward", records: items.filter((item) => item.status === "Needs a reply" || item.status === "Follow-up due") },
    { label: "Booked & planning", description: "Confirmed editions with an upcoming next step", records: items.filter((item) => item.status === "Confirmed") },
    { label: "Completed", description: "Wrapped up in this preview", records: items.filter((item) => item.status === "Completed") },
  ];
  return (
    <div className="grid gap-4">
      {groups.map((group) => group.records.length ? (
        <section aria-label={group.label} className="overflow-hidden rounded-lg border border-border bg-card" key={group.label}>
          <div className="flex items-center justify-between gap-2 bg-muted px-4 py-3">
            <div className="min-w-0">
              <h2 className="font-semibold">{group.label}</h2>
              <p className="text-xs text-muted-foreground">{group.description}</p>
            </div>
            <Badge variant="outline">{group.records.length}</Badge>
          </div>
          <div className="divide-y divide-border">
            {group.records.map((item) => {
              const selected = activeId === item.id;
              return (
                <Button
                  aria-current={selected ? "true" : undefined}
                  className="grid h-auto w-full gap-2 p-3 text-left sm:grid-cols-2 sm:items-center"
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  variant={selected ? "secondary" : "ghost"}
                >
                  <span className="flex min-w-0 items-start gap-3">
                    <Avatar className="mt-0.5 h-9 w-9 shrink-0"><AvatarFallback>{item.initials}</AvatarFallback></Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{item.event}</span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">{item.person} · {item.city}, {item.state}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{item.when}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 pl-12 sm:pl-0">
                    <Badge variant={completed[item.id] ? "outline" : statusVariant(item.status)}>{completed[item.id] ? "Completed" : item.status}</Badge>
                    <span className="hidden text-xs text-muted-foreground lg:inline">{item.kind}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        </section>
      ) : null)}
    </div>
  );
}

export function MondayCrmWorkspace() {
  const [records, setRecords] = useState(initialWork);
  const [activeId, setActiveId] = useState(initialWork[0]!.id);
  const [screen, setScreen] = useState<Screen>("today");
  const [activeRoute, setActiveRoute] = useState("/today");
  const [otherDestination, setOtherDestination] = useState("");
  const [filterView, setFilterView] = useState<FilterView>("all");
  const [search, setSearch] = useState("");
  const [replyDraft, setReplyDraft] = useState("Hi Avery, thanks for reaching out. We’re checking our 2027 calendar and will confirm availability after reviewing the August dates.");
  const [replyOpen, setReplyOpen] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [noteDraft, setNoteDraft] = useState("");
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [assignedLegs, setAssignedLegs] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialWork.map((item) => [item.id, item.assignedLeg ?? ""])),
  );
  const [showAiContext, setShowAiContext] = useState(false);
  const [feedback, setFeedback] = useState("");
  const activeWork = records.find((item) => item.id === activeId) ?? records[0]!;
  const latestNote = noteOverrides[activeId] ?? activeWork.newestNote;
  const shownRecords = records.filter((item) => {
    const matchesView = filterView === "all"
      || (filterView === "attention" && (item.status === "Needs a reply" || item.status === "Follow-up due"))
      || (filterView === "confirmed" && item.status === "Confirmed");
    return matchesView && `${item.event} ${item.person} ${item.city} ${item.status}`.toLowerCase().includes(search.trim().toLowerCase());
  });

  function navigate(destination: Destination) {
    const route = destination.href;
    const screenByPath: Record<string, Screen> = {
      "/today": "today",
      "/profiles": "profiles",
      "/emails": "emails",
      "/schedule": "schedule",
      "/business-documents": "documents",
    };
    const path = route.split("?")[0] ?? route;
    setActiveRoute(route);
    setFeedback("");
    if (path === "/emails" && route.includes("review")) {
      setScreen("emails");
      return;
    }
    const nextScreen = screenByPath[path];
    if (nextScreen) {
      setScreen(nextScreen);
      setOtherDestination("");
      return;
    }
    setOtherDestination(destination.label);
    setScreen("other");
  }

  function openProfile(id: string) {
    setActiveId(id);
    setScreen("profile-detail");
    setActiveRoute("/profiles");
  }

  function openEmail(id: string) {
    setActiveId(id);
    setScreen("email-thread");
    setActiveRoute("/emails");
  }

  function updateRecordStatus(status: string) {
    setRecords((current) => current.map((item) => item.id === activeId ? { ...item, status } : item));
    if (status === "Completed") setCompleted((current) => ({ ...current, [activeId]: true }));
    else setCompleted((current) => ({ ...current, [activeId]: false }));
    setFeedback(`Status changed to ${status} in this preview only.`);
  }

  function prepareReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPrepared(true);
    setReplyOpen(false);
    setFeedback("Reply draft prepared locally. It was not sent or saved.");
  }

  function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = noteDraft.trim();
    if (!value) return;
    setNoteOverrides((current) => ({ ...current, [activeId]: value }));
    setNoteDraft("");
    setFeedback("Note added to this preview only.");
  }

  const todayContent = (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">Booking workspace · Monday, October 12, 2026</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Today’s work</h1>
          <p className="mt-1 text-sm text-muted-foreground">One board for organizer relationships, event editions, and the next move.</p>
        </div>
        <Badge variant="outline">3 active records</Badge>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-label="Festival work board" className="grid content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Work views">
              {([
                ["all", "All work"],
                ["attention", "Needs attention"],
                ["confirmed", "Confirmed"],
              ] as const).map(([value, label]) => (
                <Button key={value} onClick={() => setFilterView(value)} size="sm" variant={filterView === value ? "secondary" : "ghost"}>{label}</Button>
              ))}
            </div>
            <div className="w-full sm:w-56">
              <Input aria-label="Search work records" onChange={(event) => setSearch(event.target.value)} placeholder="Search event or organizer" value={search} />
            </div>
          </div>
          {shownRecords.length ? (
            <BoardRows activeId={activeId} completed={completed} items={shownRecords} onSelect={(id) => { setActiveId(id); setFeedback(""); }} />
          ) : (
            <Card><CardContent className="grid gap-1 p-6 text-center"><p className="font-semibold">No records in this view</p><p className="text-sm text-muted-foreground">Try another view or clear your search.</p></CardContent></Card>
          )}
          <p className="text-xs text-muted-foreground">Grouped by current status · choose a row to see its next action and context.</p>
        </section>
        <section aria-label="Selected work details" className="grid content-start gap-3">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar className="h-10 w-10 shrink-0"><AvatarFallback>{activeWork.initials}</AvatarFallback></Avatar>
                  <div className="min-w-0">
                    <CardTitle className="text-lg">{activeWork.event}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{activeWork.person} · {activeWork.contactRole}</p>
                    <p className="text-xs text-muted-foreground">{activeWork.city}, {activeWork.state} · {activeWork.when}</p>
                  </div>
                </div>
                <Button onClick={() => openProfile(activeId)} size="sm" variant="outline">Profile</Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="rounded-lg border border-border bg-muted p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next action</p>
                  <Select onValueChange={updateRecordStatus} value={activeWork.status}>
                    <SelectTrigger aria-label="Change record status" className="h-8 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>{statusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <p className="mt-2 font-semibold">{activeWork.next}</p>
                <p className="mt-1 text-xs text-muted-foreground">{activeWork.kind}</p>
                {prepared ? <p className="mt-2 text-sm font-semibold" role="status">Draft ready here · nothing sent.</p> : null}
                {replyOpen ? (
                  <form className="mt-3 grid gap-2 border-t border-border pt-3" onSubmit={prepareReply}>
                    <Label htmlFor="reply-draft">Reply draft</Label>
                    <Textarea id="reply-draft" onChange={(event) => setReplyDraft(event.target.value)} value={replyDraft} />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" type="submit">Prepare draft</Button>
                      <Button onClick={() => setReplyOpen(false)} size="sm" type="button" variant="outline">Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <Button className="mt-3" onClick={() => setReplyOpen(true)} size="sm"><MessageSquare className="mr-2 h-4 w-4" />{prepared ? "Revise reply" : "Prepare reply"}</Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Des · suggested leg</p>
                  <p className="mt-1 font-semibold">{activeWork.suggestedLeg}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Planning suggestion from event dates and location.</p>
                </div>
                <div className="grid content-start gap-1 rounded-lg border border-border p-3">
                  <Label htmlFor="assigned-leg">Current booking leg · Boss</Label>
                  <Select onValueChange={(leg) => { setAssignedLegs((current) => ({ ...current, [activeId]: leg })); setFeedback(`Leg shown as ${leg} in this preview only.`); }} value={assignedLegs[activeId] ?? ""}>
                    <SelectTrigger id="assigned-leg"><SelectValue /></SelectTrigger>
                    <SelectContent>{legs.map((leg) => <SelectItem key={leg} value={leg}>{leg}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Current: {assignedLegs[activeId] || "Unassigned"}</p>
                  <Button className="w-fit px-0" onClick={() => navigate({ href: "/schedule", label: "Schedule" })} size="sm" variant="link"><MapPinned className="mr-1 h-4 w-4" />View schedule</Button>
                </div>
              </div>
              <div className="grid gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><StickyNote className="h-4 w-4" />Newest organizer note</p>
                  <p className="mt-1 text-sm">{latestNote}</p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Newest email · {activeWork.emailDate}</p>
                    <p className="truncate text-sm font-semibold">{activeWork.emailSubject}</p>
                  </div>
                  <Button onClick={() => openEmail(activeId)} size="sm" variant="outline"><Mail className="mr-1 h-4 w-4" />Open email</Button>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">AI work companion <Badge className="ml-1" variant="outline">Demo only</Badge></div>
                    <p className="mt-1 text-sm text-muted-foreground">{suggestionContext[activeWork.id] ?? "Based on this sample record’s current status and recent activity."}</p>
                    {showAiContext ? <p className="mt-2 text-xs text-muted-foreground">Example rationale only. No AI service is connected.</p> : null}
                  </div>
                  <Button aria-label="Explain AI suggestion" className="shrink-0" onClick={() => setShowAiContext((value) => !value)} size="icon" variant="ghost"><CircleHelp className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">{completed[activeId] ? "Marked complete in this preview." : "Finish the selected next step."}</p>
                <Button disabled={Boolean(completed[activeId])} onClick={() => { setCompleted((current) => ({ ...current, [activeId]: true })); setRecords((current) => current.map((item) => item.id === activeId ? { ...item, status: "Completed" } : item)); setFeedback("Marked complete in this preview only."); }} size="sm" variant="outline">
                  <Check className="mr-1 h-4 w-4" />{completed[activeId] ? "Completed" : "Mark complete"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Event year &amp; relationship</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organizer relationship</p><p className="mt-1 text-sm font-semibold">{activeWork.person} · {activeWork.contactRole}</p><p className="text-xs text-muted-foreground">Last contact {activeWork.lastContact}</p><p className="mt-2 text-sm text-muted-foreground">{activeWork.relationshipHistory}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">This event edition</p><p className="mt-1 text-sm font-semibold">{activeWork.when}</p><p className="mt-2 text-sm text-muted-foreground">{activeWork.editionDetails}</p></div>
              <form className="grid gap-2 border-t border-border pt-3 sm:col-span-2" onSubmit={saveNote}>
                <Label htmlFor="note-draft">Add a practical note</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id="note-draft" onChange={(event) => setNoteDraft(event.target.value)} placeholder="Details from the latest conversation" value={noteDraft} />
                  <Button disabled={!noteDraft.trim()} size="sm" type="submit">Add note</Button>
                </div>
              </form>
            </CardContent>
          </Card>
          {feedback ? <p aria-live="polite" className="text-xs text-muted-foreground">{feedback}</p> : null}
        </section>
      </div>
    </div>
  );

  let screenBody;
  if (screen === "today") screenBody = todayContent;
  else if (screen === "profiles") screenBody = <ProfilesDirectory onOpenProfile={openProfile} workItems={records} />;
  else if (screen === "profile-detail") screenBody = (
    <ProfileDetailScreen
      item={activeWork}
      note={latestNote}
      noteDraft={noteDraft}
      onBack={() => { setScreen("profiles"); setActiveRoute("/profiles"); }}
      onNoteDraftChange={setNoteDraft}
      onOpenEmail={() => openEmail(activeId)}
      onSaveNote={saveNote}
    />
  );
  else if (screen === "emails") screenBody = <EmailInbox onOpenEmail={openEmail} onOpenProfile={openProfile} workItems={records} />;
  else if (screen === "email-thread") screenBody = <EmailThreadScreen item={activeWork} onBack={() => { setScreen("emails"); setActiveRoute("/emails"); }} onOpenProfile={() => openProfile(activeId)} />;
  else if (screen === "schedule") screenBody = (
    <div className="grid gap-4">
      <ScheduleRouteMap assignedLegs={assignedLegs} workItems={records} />
      <ScheduleScreen assignedLegs={assignedLegs} onOpenProfile={openProfile} workItems={records} />
    </div>
  );
  else if (screen === "documents") screenBody = <DemoDocuments workItems={records} />;
  else screenBody = (
    <Card>
      <CardHeader>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Secondary destination · preview</p>
        <CardTitle>{otherDestination}</CardTitle>
        <p className="text-sm text-muted-foreground">{activeRoute}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-lg border border-border bg-muted p-4">
          <p className="font-semibold">This destination is available in the live CRM but is not modeled here.</p>
          <p className="mt-1 text-sm text-muted-foreground">This prototype uses sample content only. No live CRM data is loaded or changed.</p>
        </div>
        <Button className="w-fit" onClick={() => navigate({ href: "/today", label: "Today" })} size="sm"><ArrowRight className="mr-2 h-4 w-4" />Back to Today</Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="flex min-h-16 items-center justify-between gap-3 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><UsersRound className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-bold uppercase tracking-wide">Adventure Zone CRM</p>
              <p className="truncate text-xs text-muted-foreground">Festival workbench <span className="mx-1">·</span> Des’s workspace</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge className="hidden sm:inline-flex" variant="outline">Preview only · no live sends or saves</Badge>
            <MoreDestinations onNavigate={navigate} />
            <Avatar className="h-8 w-8"><AvatarFallback>DS</AvatarFallback></Avatar>
          </div>
        </div>
        <div className="border-t border-border bg-muted/60 px-3 py-1.5 text-center sm:hidden">
          <span className="text-xs text-muted-foreground">Preview only · no live sends or saves</span>
        </div>
      </header>
      <div className="flex min-h-dvh">
        <WorkspaceNavigation onNavigate={navigate} screen={screen} />
        <div className="min-w-0 flex-1">
          <div className="md:hidden"><MobileWorkspaceNavigation onNavigate={navigate} screen={screen} /></div>
          <main className="mx-auto min-h-dvh max-w-7xl px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
            {screenBody}
            {screen !== "today" ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">Festival sample data · this workspace is a preview only.</p>
                <Button onClick={() => navigate({ href: "/today", label: "Today" })} size="sm" variant="outline"><House className="mr-2 h-4 w-4" />Today</Button>
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
