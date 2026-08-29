import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  StickyNote,
  Tag,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type ActivityKind = "note" | "call" | "email";
type Contact = {
  id: string;
  name: string;
  initials: string;
  role: string;
  email: string;
  phone: string;
  isPrimary?: boolean;
};
type Activity = {
  id: string;
  kind: ActivityKind;
  body: string;
  date: string;
  author: string;
};

const themeVars = {
  "--background": "88 21% 95%",
  "--foreground": "196 52% 18%",
  "--card": "84 33% 99%",
  "--card-foreground": "196 52% 18%",
  "--popover": "84 33% 99%",
  "--popover-foreground": "196 52% 18%",
  "--primary": "339 82% 45%",
  "--primary-foreground": "341 100% 98%",
  "--secondary": "340 81% 95%",
  "--secondary-foreground": "338 78% 31%",
  "--muted": "337 33% 95%",
  "--muted-foreground": "196 11% 49%",
  "--accent": "24 61% 57%",
  "--accent-foreground": "32 100% 98%",
  "--destructive": "4 40% 52%",
  "--destructive-foreground": "32 100% 98%",
  "--border": "148 16% 87%",
  "--input": "148 26% 82%",
  "--ring": "342 78% 59%",
  "--az-bg": "#f3f5f0",
  "--az-card": "#fbfcf8",
  "--az-fg": "#173b48",
  "--az-muted": "#71848a",
  "--az-border": "#d8e2dd",
  "--az-primary": "#d51352",
  "--az-primary-soft": "#fde7ef",
  "--az-terra": "#d4874f",
  "--az-sidebar": "#173b48",
  "--az-sidebar-soft": "#315b66",
} as CSSProperties;

const contacts: Contact[] = [
  {
    id: "maya",
    name: "Maya Chen",
    initials: "MC",
    role: "Guest Experience Director",
    phone: "(970) 555-0148",
    email: "maya@pineridgeadventure.com",
    isPrimary: true,
  },
  {
    id: "jon",
    name: "Jon Bell",
    initials: "JB",
    role: "Events Coordinator",
    phone: "(970) 555-0162",
    email: "jon@pineridgeadventure.com",
  },
];

const initialActivities: Activity[] = [
  {
    id: "activity-1",
    kind: "note",
    body: "Maya confirmed the new trail itinerary and asked us to hold the Saturday dinner slot for Summit Week.",
    date: "Apr 16",
    author: "Alex Morgan",
  },
  {
    id: "activity-2",
    kind: "call",
    body: "Reviewed capacity, transportation options, and the updated group deposit schedule.",
    date: "Apr 8",
    author: "Alex Morgan",
  },
  {
    id: "activity-3",
    kind: "email",
    body: "Sent the first draft of the fall retreat proposal for pricing review.",
    date: "Mar 28",
    author: "Alex Morgan",
  },
];

const events = [
  { name: "Summit Week 2025", status: "Confirmed", date: "Jul 18", detail: "48 guests · 3 nights" },
  { name: "Fall Family Retreat", status: "Inquiry", date: "Sep 5", detail: "Proposal requested" },
];

const emailThreads = [
  { subject: "Summit Week itinerary — final details", sender: "Maya Chen", date: "Apr 16", unread: true },
  { subject: "Fall retreat proposal and pricing", sender: "Jon Bell", date: "Apr 8", unread: false },
  { subject: "Transportation options for July", sender: "Maya Chen", date: "Mar 31", unread: false },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--az-muted)" }}>
      {children}
    </p>
  );
}

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  const iconStyle = kind === "call"
    ? { backgroundColor: "#faeee7", color: "var(--az-terra)" }
    : kind === "email"
      ? { backgroundColor: "var(--az-primary-soft)", color: "var(--az-primary)" }
      : { backgroundColor: "#e5efea", color: "#397064" };
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={iconStyle}>
      {kind === "call" ? <Phone className="h-4 w-4" /> : kind === "email" ? <Mail className="h-4 w-4" /> : <StickyNote className="h-4 w-4" />}
    </span>
  );
}

function MetricTile({
  icon,
  value,
  label,
  onClick,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="group flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm"
      onClick={onClick}
      style={{ backgroundColor: "var(--az-card)", borderColor: "var(--az-border)" }}
      type="button"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "#e5efea", color: "#397064" }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold tracking-tight" style={{ color: "var(--az-fg)" }}>{value}</span>
        <span className="mt-0.5 block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--az-muted)" }}>{label}</span>
      </span>
      <ChevronRight className="ml-auto h-4 w-4 opacity-0 transition group-hover:opacity-100" style={{ color: "var(--az-primary)" }} />
    </button>
  );
}

export function PolishedCRM() {
  const [tab, setTab] = useState("overview");
  const [activities, setActivities] = useState(initialActivities);
  const [search, setSearch] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [priority, setPriority] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [organizationName, setOrganizationName] = useState("Pine Ridge Adventure Lodge");
  const [draftName, setDraftName] = useState(organizationName);

  const filteredActivities = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return activities;
    return activities.filter((activity) => `${activity.kind} ${activity.body} ${activity.author}`.toLowerCase().includes(query));
  }, [activities, search]);

  const openTab = (value: string) => {
    setTab(value);
    window.setTimeout(() => document.getElementById(`crm-${value}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const addNote = () => {
    const body = noteBody.trim();
    if (!body) return;
    setActivities((current) => [{
      id: `activity-${Date.now()}`,
      kind: "note",
      body,
      date: "Just now",
      author: "Alex Morgan",
    }, ...current]);
    setNoteBody("");
    setNoteOpen(false);
    setTab("activity");
  };

  const saveOrganization = () => {
    const nextName = draftName.trim();
    if (!nextName) return;
    setOrganizationName(nextName);
    setEditOpen(false);
  };

  return (
    <main className="min-h-[100dvh]" style={{ ...themeVars, backgroundColor: "var(--az-bg)", color: "var(--az-fg)" }}>
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold" style={{ backgroundColor: "var(--az-sidebar)", color: "#f8f5ee" }}>AZ</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold" style={{ color: "var(--az-fg)" }}>Adventure Zone</p>
              <p className="truncate text-xs" style={{ color: "var(--az-muted)" }}>Relationships / Organizations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button className="hidden sm:inline-flex" onClick={() => setAssistantOpen(true)} size="sm" variant="outline">
              <Sparkles className="h-4 w-4" style={{ color: "var(--az-terra)" }} />
              Ask Assistant
            </Button>
            <Button aria-label="Mark organization as priority" onClick={() => setPriority((current) => !current)} size="icon" variant={priority ? "secondary" : "outline"}>
              <Tag className="h-4 w-4" />
            </Button>
            <Button aria-label="More organization actions" onClick={() => setPriority((current) => !current)} size="icon" variant="outline">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold" style={{ color: "var(--az-muted)" }}>
          <span>Organizations</span>
          <ChevronRight className="h-3.5 w-3.5" />
          <span style={{ color: "var(--az-fg)" }}>{organizationName}</span>
          {priority ? <Badge className="ml-1 rounded-full" variant="secondary"><Tag className="mr-1 h-3 w-3" />Priority</Badge> : null}
        </div>

        <Card className="mt-4 overflow-hidden" style={{ borderColor: "var(--az-border)", backgroundColor: "var(--az-card)" }}>
          <div className="h-1" style={{ backgroundColor: "var(--az-primary)" }} />
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-xl font-bold" style={{ backgroundColor: "#e5efea", color: "#397064" }}>PR</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "var(--az-fg)" }}>{organizationName}</h1>
                    <Badge className="rounded-full" variant="secondary"><Check className="mr-1 h-3 w-3" />Active</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" style={{ color: "var(--az-muted)" }}>
                    <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" style={{ color: "var(--az-primary)" }} />Estes Park, Colorado</span>
                    <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" style={{ color: "var(--az-primary)" }} />Verified details</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--az-fg)" }}>
                      <span className="inline-flex gap-0.5" style={{ color: "var(--az-terra)" }} aria-label="4.7 out of 5 stars">
                        {Array.from({ length: 5 }, (_, index) => <Star className="h-3.5 w-3.5" fill={index < 4 ? "currentColor" : "none"} key={index} />)}
                      </span>
                      4.7 <span className="font-normal" style={{ color: "var(--az-muted)" }}>from 12 ratings</span>
                    </span>
                    <a className="inline-flex items-center gap-1.5 font-semibold hover:underline" href="https://pineridgeadventure.com" rel="noreferrer noopener" style={{ color: "var(--az-primary)" }} target="_blank">
                      <ExternalLink className="h-3.5 w-3.5" /> Visit website
                    </a>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button onClick={() => { setDraftName(organizationName); setEditOpen(true); }} variant="outline">Edit profile</Button>
                <Button onClick={() => { setNoteOpen(true); setTab("activity"); }}><Plus className="h-4 w-4" />Add note</Button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 border-t pt-4 text-xs sm:grid-cols-3" style={{ borderColor: "var(--az-border)" }}>
              <div><span className="block font-semibold" style={{ color: "var(--az-muted)" }}>Address</span><span className="mt-1 block" style={{ color: "var(--az-fg)" }}>1420 Mountain View Drive, Estes Park, CO</span></div>
              <div><span className="block font-semibold" style={{ color: "var(--az-muted)" }}>Organization group</span><span className="mt-1 block" style={{ color: "var(--az-fg)" }}>Colorado Mountain Partners</span></div>
              <div><span className="block font-semibold" style={{ color: "var(--az-muted)" }}>Relationship started</span><span className="mt-1 block" style={{ color: "var(--az-fg)" }}>September 2022</span></div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <MetricTile icon={<UsersRound className="h-4 w-4" />} label="Contacts" onClick={() => openTab("contacts")} value={String(contacts.length)} />
          <MetricTile icon={<CalendarDays className="h-4 w-4" />} label="Upcoming events" onClick={() => openTab("events")} value={String(events.length)} />
          <MetricTile icon={<MessageSquare className="h-4 w-4" />} label="Email threads" onClick={() => openTab("emails")} value="8" />
        </div>

        <Tabs className="mt-5" onValueChange={setTab} value={tab}>
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0" style={{ borderColor: "var(--az-border)" }}>
            <TabsTrigger className="rounded-none border-b-2 border-transparent px-3 py-3 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="overview">Overview</TabsTrigger>
            <TabsTrigger className="rounded-none border-b-2 border-transparent px-3 py-3 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="contacts">Contacts <span className="ml-1.5 text-xs" style={{ color: "var(--az-muted)" }}>2</span></TabsTrigger>
            <TabsTrigger className="rounded-none border-b-2 border-transparent px-3 py-3 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="events">Events <span className="ml-1.5 text-xs" style={{ color: "var(--az-muted)" }}>2</span></TabsTrigger>
            <TabsTrigger className="rounded-none border-b-2 border-transparent px-3 py-3 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="activity">Activity</TabsTrigger>
            <TabsTrigger className="rounded-none border-b-2 border-transparent px-3 py-3 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value="emails">Emails</TabsTrigger>
          </TabsList>

          <TabsContent className="mt-5" id="crm-overview" value="overview">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(17rem,0.75fr)]">
              <div className="grid gap-5">
                <Card style={{ borderColor: "var(--az-sidebar-soft)", backgroundColor: "var(--az-sidebar)", color: "#f8f5ee" }}>
                  <CardContent className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <Eyebrow>Next action</Eyebrow>
                        <h2 className="mt-1 text-xl font-bold tracking-tight">Send fall retreat proposal</h2>
                        <p className="mt-1 text-sm" style={{ color: "#b9c9c4" }}>Keep the relationship moving while pricing is fresh.</p>
                      </div>
                      <Badge className="rounded-full border-0" style={{ backgroundColor: "#f6e8d9", color: "#995c3d" }}>Due May 2</Badge>
                    </div>
                    {followUpOpen ? (
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--az-sidebar-soft)" }}>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: "#dbe9e4", color: "#397064" }}>MC</span>
                          <span><span className="block text-xs" style={{ color: "#b9c9c4" }}>Assigned to</span><span className="font-semibold">Maya Chen</span></span>
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={() => setFollowUpOpen(false)} size="sm" variant="outline">Dismiss</Button>
                          <Button onClick={() => setFollowUpOpen(false)} size="sm"><Check className="h-4 w-4" />Complete</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 flex items-center gap-2 border-t pt-4 text-sm font-semibold" style={{ borderColor: "var(--az-sidebar-soft)", color: "#b9c9c4" }}><Check className="h-4 w-4" /> Follow-up completed</div>
                    )}
                  </CardContent>
                </Card>
                <Card style={{ borderColor: "var(--az-border)", backgroundColor: "var(--az-card)" }}>
                  <CardHeader className="flex-row items-start justify-between space-y-0 p-5 pb-0 sm:p-6 sm:pb-0">
                    <div><Eyebrow>Relationship activity</Eyebrow><CardTitle className="mt-1 text-xl" style={{ color: "var(--az-fg)" }}>Recent history</CardTitle></div>
                    <Button className="h-auto px-0" onClick={() => openTab("activity")} size="sm" variant="link">View all <ArrowRight className="h-3.5 w-3.5" /></Button>
                  </CardHeader>
                  <CardContent className="grid gap-4 p-5 sm:p-6">
                    {activities.slice(0, 3).map((activity) => (
                      <article className="flex gap-3" key={activity.id}>
                        <ActivityIcon kind={activity.kind} />
                        <div className="min-w-0 flex-1 border-b pb-4 last:border-0 last:pb-0" style={{ borderColor: "var(--az-border)" }}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--az-muted)" }}>{activity.kind}</span>
                            <time className="text-xs" style={{ color: "var(--az-muted)" }}>{activity.date}</time>
                          </div>
                          <p className="mt-1 text-sm leading-6" style={{ color: "#4d666d" }}>{activity.body}</p>
                          <p className="mt-2 text-xs font-semibold" style={{ color: "var(--az-muted)" }}>{activity.author}</p>
                        </div>
                      </article>
                    ))}
                  </CardContent>
                </Card>
              </div>
              <aside className="grid content-start gap-5">
                <Card style={{ borderColor: "var(--az-border)", backgroundColor: "var(--az-card)" }}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-3"><Eyebrow>Relationship health</Eyebrow><Badge className="rounded-full" variant="secondary">Good standing</Badge></div>
                    <div className="mt-4 flex items-end justify-between gap-3"><span className="text-3xl font-bold tracking-tight" style={{ color: "var(--az-fg)" }}>4.7 <span className="text-sm font-medium" style={{ color: "var(--az-muted)" }}>/ 5</span></span><span className="text-xs" style={{ color: "var(--az-muted)" }}>12 rated</span></div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#e5ebe5" }}><div className="h-full w-[94%] rounded-full" style={{ backgroundColor: "#397064" }} /></div>
                    <p className="mt-3 text-sm leading-5" style={{ color: "var(--az-muted)" }}>Strong partner for group stays. Keep response cadence steady through the fall proposal.</p>
                  </CardContent>
                </Card>
                <Card style={{ borderColor: "var(--az-border)", backgroundColor: "var(--az-card)" }}>
                  <CardHeader className="p-5 pb-0"><Eyebrow>Primary contact</Eyebrow><CardTitle className="mt-1 text-lg" style={{ color: "var(--az-fg)" }}>Maya Chen</CardTitle><p className="text-sm" style={{ color: "var(--az-muted)" }}>Guest Experience Director</p></CardHeader>
                  <CardContent className="grid gap-2 p-5">
                    <a className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted" href="tel:+19705550148" style={{ borderColor: "var(--az-border)", color: "var(--az-fg)" }}><Phone className="h-4 w-4" style={{ color: "var(--az-primary)" }} />(970) 555-0148</a>
                    <a className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted" href="mailto:maya@pineridgeadventure.com" style={{ borderColor: "var(--az-border)", color: "var(--az-fg)" }}><Mail className="h-4 w-4" style={{ color: "var(--az-primary)" }} />Email Maya</a>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </TabsContent>

          <TabsContent className="mt-5" id="crm-contacts" value="contacts">
            <Card style={{ borderColor: "var(--az-border)", backgroundColor: "var(--az-card)" }}>
              <CardHeader className="flex-row items-end justify-between space-y-0 p-5 pb-0 sm:p-6 sm:pb-0"><div><Eyebrow>People at this organization</Eyebrow><CardTitle className="mt-1 text-xl" style={{ color: "var(--az-fg)" }}>Contacts</CardTitle></div><Button onClick={() => setAssistantOpen(true)} size="sm"><Plus className="h-4 w-4" />Add contact</Button></CardHeader>
              <CardContent className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
                {contacts.map((contact) => <article className="rounded-xl border p-4" key={contact.id} style={{ borderColor: "var(--az-border)", backgroundColor: "#f8faf6" }}><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: "#e5efea", color: "#397064" }}>{contact.initials}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold" style={{ color: "var(--az-fg)" }}>{contact.name}</h3>{contact.isPrimary ? <Badge className="rounded-full text-xs" variant="secondary">Primary</Badge> : null}</div><p className="text-sm" style={{ color: "var(--az-muted)" }}>{contact.role}</p><div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex items-center gap-1.5 text-xs font-bold" href={`tel:${contact.phone}`} style={{ color: "var(--az-primary)" }}><Phone className="h-3.5 w-3.5" />Call</a><a className="inline-flex items-center gap-1.5 text-xs font-bold" href={`mailto:${contact.email}`} style={{ color: "var(--az-primary)" }}><Mail className="h-3.5 w-3.5" />Email</a></div></div></div></article>)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="mt-5" id="crm-events" value="events">
            <Card style={{ borderColor: "var(--az-border)", backgroundColor: "var(--az-card)" }}>
              <CardHeader className="flex-row items-end justify-between space-y-0 p-5 pb-0 sm:p-6 sm:pb-0"><div><Eyebrow>Bookings and opportunities</Eyebrow><CardTitle className="mt-1 text-xl" style={{ color: "var(--az-fg)" }}>Events</CardTitle></div><Button onClick={() => setAssistantOpen(true)} size="sm"><Plus className="h-4 w-4" />Add event</Button></CardHeader>
              <CardContent className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
                {events.map((event) => <button className="rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm" key={event.name} onClick={() => setAssistantOpen(true)} style={{ borderColor: "var(--az-border)", backgroundColor: "#f8faf6" }} type="button"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold" style={{ color: "var(--az-fg)" }}>{event.name}</h3><p className="mt-1 text-sm" style={{ color: "var(--az-muted)" }}>{event.detail}</p></div><Badge className="rounded-full" variant={event.status === "Confirmed" ? "secondary" : "outline"}>{event.status}</Badge></div><div className="mt-5 flex items-center gap-1.5 border-t pt-3 text-sm font-semibold" style={{ borderColor: "var(--az-border)", color: "var(--az-fg)" }}><CalendarDays className="h-4 w-4" style={{ color: "var(--az-primary)" }} />{event.date}, 2025</div></button>)}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="mt-5" id="crm-activity" value="activity">
            <Card style={{ borderColor: "var(--az-border)", backgroundColor: "var(--az-card)" }}>
              <CardHeader className="flex-row items-end justify-between space-y-0 p-5 pb-0 sm:p-6 sm:pb-0"><div><Eyebrow>Relationship history</Eyebrow><CardTitle className="mt-1 text-xl" style={{ color: "var(--az-fg)" }}>Activity</CardTitle></div><Button onClick={() => setNoteOpen(true)} size="sm"><Plus className="h-4 w-4" />Add note</Button></CardHeader>
              <CardContent className="p-5 sm:p-6">
                <div className="relative max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--az-muted)" }} /><Input aria-label="Search activity" className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search notes, calls, and outreach" value={search} /></div>
                <div className="mt-6 grid gap-5">{filteredActivities.length ? filteredActivities.map((activity) => <article className="flex gap-3" key={activity.id}><ActivityIcon kind={activity.kind} /><div className="min-w-0 flex-1 border-b pb-4" style={{ borderColor: "var(--az-border)" }}><div className="flex flex-wrap justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--az-muted)" }}>{activity.kind}</span><time className="text-xs" style={{ color: "var(--az-muted)" }}>{activity.date}</time></div><p className="mt-2 text-sm leading-6" style={{ color: "#4d666d" }}>{activity.body}</p><p className="mt-2 text-xs font-semibold" style={{ color: "var(--az-muted)" }}>Logged by {activity.author}</p></div></article>) : <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--az-border)", backgroundColor: "#f8faf6" }}><CircleAlert className="mx-auto h-6 w-6" style={{ color: "var(--az-muted)" }} /><p className="mt-2 text-sm font-bold" style={{ color: "var(--az-fg)" }}>No activity matches that search</p><p className="mt-1 text-sm" style={{ color: "var(--az-muted)" }}>Try a different keyword or clear the search.</p></div>}</div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="mt-5" id="crm-emails" value="emails">
            <Card style={{ borderColor: "var(--az-border)", backgroundColor: "var(--az-card)" }}>
              <CardHeader className="flex-row items-end justify-between space-y-0 p-5 pb-0 sm:p-6 sm:pb-0"><div><Eyebrow>Outreach history</Eyebrow><CardTitle className="mt-1 text-xl" style={{ color: "var(--az-fg)" }}>Email threads</CardTitle></div><Button onClick={() => setAssistantOpen(true)} size="sm"><Send className="h-4 w-4" />Compose email</Button></CardHeader>
              <CardContent className="grid gap-2 p-5 sm:p-6">{emailThreads.map((thread) => <button className="flex items-center gap-3 rounded-xl border p-4 text-left transition hover:bg-muted" key={thread.subject} onClick={() => setAssistantOpen(true)} style={{ borderColor: "var(--az-border)", backgroundColor: "#f8faf6" }} type="button"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: thread.unread ? "var(--az-terra)" : "#cbd8d2" }} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold" style={{ color: "var(--az-fg)" }}>{thread.subject}</span><span className="mt-1 block text-xs" style={{ color: "var(--az-muted)" }}>{thread.sender} · {thread.date}</span></span><ArrowRight className="h-4 w-4" style={{ color: "var(--az-primary)" }} /></button>)}</CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--az-muted)" }}>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />Mountain Time (MT)</span>
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Last synced today at 9:42 AM</span>
        </div>
      </div>

      <Dialog onOpenChange={setNoteOpen} open={noteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add relationship note</DialogTitle><DialogDescription>Capture the next useful detail for everyone working this relationship.</DialogDescription></DialogHeader>
          <Textarea autoFocus className="min-h-28" onChange={(event) => setNoteBody(event.target.value)} placeholder="What should the team remember?" value={noteBody} />
          <DialogFooter><Button onClick={() => { setNoteOpen(false); setNoteBody(""); }} variant="outline">Cancel</Button><Button disabled={!noteBody.trim()} onClick={addNote}><Check className="h-4 w-4" />Save note</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setEditOpen} open={editOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit organization</DialogTitle><DialogDescription>Keep the relationship record concise and easy to recognize.</DialogDescription></DialogHeader>
          <label className="grid gap-2 text-sm font-semibold" htmlFor="organization-name">Organization name<Input id="organization-name" onChange={(event) => setDraftName(event.target.value)} value={draftName} /></label>
          <DialogFooter><Button onClick={() => setEditOpen(false)} variant="outline">Cancel</Button><Button disabled={!draftName.trim()} onClick={saveOrganization}><Check className="h-4 w-4" />Save changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setAssistantOpen} open={assistantOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Relationship assistant</DialogTitle><DialogDescription>Suggested next steps for {organizationName}.</DialogDescription></DialogHeader>
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--az-border)", backgroundColor: "#f8faf6" }}><p className="text-sm font-semibold" style={{ color: "var(--az-fg)" }}>Keep the fall proposal moving</p><p className="mt-1 text-sm leading-6" style={{ color: "var(--az-muted)" }}>Maya is the best next contact. Review pricing, confirm transportation, then send the proposal before May 2.</p></div>
          <DialogFooter><Button onClick={() => { setAssistantOpen(false); setTab("activity"); setNoteOpen(true); }}><Plus className="h-4 w-4" />Add a follow-up note</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}