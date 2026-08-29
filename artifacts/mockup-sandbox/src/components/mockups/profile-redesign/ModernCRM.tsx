import "./_group.css";
import { type ReactNode, useMemo, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Edit3,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  StickyNote,
  Tag,
  UsersRound,
  X,
} from "lucide-react";

type Section = "overview" | "contacts" | "events" | "notes" | "emails";
type ActivityKind = "note" | "call" | "email";

type Contact = {
  id: string;
  name: string;
  initials: string;
  role: string;
  phone: string;
  email: string;
  isPrimary?: boolean;
  availability: string;
};

type Activity = {
  id: string;
  kind: ActivityKind;
  body: string;
  occurredAt: string;
  author: string;
};

const initialContacts: Contact[] = [
  {
    id: "contact-maya",
    name: "Maya Chen",
    initials: "MC",
    role: "Guest Experience Director",
    phone: "(970) 555-0148",
    email: "maya@pineridgeadventure.com",
    isPrimary: true,
    availability: "Usually replies within a day",
  },
  {
    id: "contact-jon",
    name: "Jon Bell",
    initials: "JB",
    role: "Events Coordinator",
    phone: "(970) 555-0162",
    email: "jon@pineridgeadventure.com",
    availability: "Last contacted Apr 8",
  },
];

const initialActivities: Activity[] = [
  {
    id: "note-1",
    kind: "note",
    body: "Maya confirmed the new trail itinerary and asked us to hold the Saturday dinner slot for the Summit Week group.",
    occurredAt: "2025-04-16T15:30:00-06:00",
    author: "Alex Morgan",
  },
  {
    id: "call-1",
    kind: "call",
    body: "Reviewed capacity, transportation options, and the updated group deposit schedule.",
    occurredAt: "2025-04-08T10:15:00-06:00",
    author: "Alex Morgan",
  },
  {
    id: "note-2",
    kind: "note",
    body: "Send the fall retreat proposal after the next pricing review.",
    occurredAt: "2025-03-28T11:00:00-06:00",
    author: "Alex Morgan",
  },
];

const bookings = [
  {
    id: "event-summer",
    name: "Summit Week 2025",
    status: "Confirmed",
    date: "Jul 18, 2025",
    detail: "48 guests · 3 nights",
    location: "Estes Park, CO",
  },
  {
    id: "event-fall",
    name: "Fall Family Retreat",
    status: "Inquiry",
    date: "Sep 5, 2025",
    detail: "Proposal requested",
    location: "Estes Park, CO",
  },
];

const emailThreads = [
  { id: "email-1", subject: "Summit Week itinerary — final details", from: "Maya Chen", date: "Apr 16", unread: true },
  { id: "email-2", subject: "Fall retreat proposal and pricing", from: "Jon Bell", date: "Apr 8", unread: false },
  { id: "email-3", subject: "Transportation options for July", from: "Maya Chen", date: "Mar 31", unread: false },
];

const reviewRating = 4.7;
const reviewCount = 12;
const organizationWebsite = "https://pineridgeadventure.com";

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Denver",
  }).format(new Date(value));

const formatShortDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Denver",
  }).format(new Date(value));

function SectionButton({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${
        active
          ? "bg-[#173b48] text-[#f8f5ee] shadow-sm"
          : "text-[#60747a] hover:bg-[#e9efed] hover:text-[#173b48]"
      }`}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      {label}
      {count !== undefined ? (
        <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${active ? "bg-[#44636a] text-[#f8f5ee]" : "bg-[#dce7e3] text-[#496269]"}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function Metric({
  icon,
  value,
  label,
  onClick,
  active,
  testId,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  onClick: () => void;
  active: boolean;
  testId: string;
}) {
  return (
    <button
      className={`group rounded-xl border p-4 text-left transition ${
        active
          ? "border-[#9ab6a9] bg-[#edf4ef]"
          : "border-[#d8e2dd] bg-[#fbfcf8] hover:border-[#a7beb3] hover:bg-[#f3f7f3]"
      }`}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#e3eee8] text-[#397064]">{icon}</span>
      <span className="block text-2xl font-bold tracking-tight text-[#173b48]">{value}</span>
      <span className="mt-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#72858a]">
        {label}
        <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
      </span>
    </button>
  );
}

export function ModernCRM() {
  const [section, setSection] = useState<Section>("overview");
  const [contacts] = useState(initialContacts);
  const [activities, setActivities] = useState(initialActivities);
  const [noteSearch, setNoteSearch] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [organizationName, setOrganizationName] = useState("Pine Ridge Adventure Lodge");
  const [draftName, setDraftName] = useState(organizationName);
  const [priority, setPriority] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(true);

  const primary = contacts[0];
  const filteredActivities = useMemo(() => {
    const query = noteSearch.trim().toLowerCase();
    return query
      ? activities.filter((item) => `${item.kind} ${item.body} ${item.author}`.toLowerCase().includes(query))
      : activities;
  }, [activities, noteSearch]);

  const showAction = (message: string) => {
    setActionMessage(message);
    window.setTimeout(() => setActionMessage(""), 3200);
  };

  const selectSection = (next: Section) => {
    setSection(next);
    setMoreOpen(false);
  };

  const addNote = () => {
    const body = noteBody.trim();
    if (!body) return;
    setActivities((current) => [
      {
        id: `note-${Date.now()}`,
        kind: "note",
        body,
        occurredAt: new Date().toISOString(),
        author: "Alex Morgan",
      },
      ...current,
    ]);
    setNoteBody("");
    setComposerOpen(false);
    setSection("notes");
    showAction("Note added to the relationship history.");
  };

  const saveEdit = () => {
    const nextName = draftName.trim();
    if (!nextName) return;
    setOrganizationName(nextName);
    setEditing(false);
    showAction("Organization details saved.");
  };

  const copyId = () => {
    void navigator.clipboard?.writeText("profile-pine-ridge");
    showAction("Organization ID copied.");
    setMoreOpen(false);
  };

  return (
    <main className="profile-modern min-h-[100dvh] bg-[#f3f5f0] text-[#173b48]">
      <div className="mx-auto max-w-[1420px] px-4 py-5 sm:px-7 sm:py-7 lg:px-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#173b48] text-sm font-bold tracking-tight text-[#f8f5ee]">AZ</div>
            <div>
              <p className="font-bold tracking-tight text-[#173b48]">Adventure Zone</p>
              <p className="text-xs text-[#71848a]">Relationships / Organizations</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Open notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-[#d8e2dd] bg-[#fbfcf8] text-[#5d747b] transition hover:border-[#a7beb3] hover:text-[#173b48]"
              data-testid="button-notifications"
              onClick={() => showAction("You have one follow-up due today.")}
              type="button"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#d47e4d]" />
            </button>
            <div className="hidden h-10 items-center gap-2 rounded-lg border border-[#d8e2dd] bg-[#fbfcf8] px-3 text-sm sm:flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#dbe9e4] text-[10px] font-bold text-[#397064]">AM</span>
              <span className="font-semibold text-[#526970]">Alex Morgan</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#8ca0a2]" />
            </div>
          </div>
        </header>

        <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#789096]">
            <span>Organizations</span>
            <span className="text-[#a8b5b4]">/</span>
            <span className="text-[#315b66]">{organizationName}</span>
          </div>
          <div className="relative flex w-full items-center gap-2 sm:w-auto">
            <button
              className="button-secondary inline-flex flex-1 items-center gap-2 !border-[#cad9d3] !bg-[#fbfcf8] !text-[#315b66] sm:flex-none"
              data-testid="button-assistant"
              onClick={() => showAction("Assistant is ready with the relationship brief.")}
              type="button"
            >
              <Sparkles className="h-4 w-4 text-[#bf7048]" />
              Ask Assistant
            </button>
            <button
              className="button-secondary inline-flex flex-1 items-center gap-2 !border-[#cad9d3] !bg-[#fbfcf8] !text-[#315b66] sm:flex-none"
              data-testid="button-more"
              onClick={() => setMoreOpen((current) => !current)}
              type="button"
            >
              More <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
            </button>
            {moreOpen ? (
              <div className="absolute right-0 top-12 z-20 w-56 rounded-xl border border-[#d8e2dd] bg-[#fbfcf8] p-1.5 shadow-[0_18px_40px_rgba(23,59,72,0.14)]">
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[#4b6269] hover:bg-[#edf4ef]" data-testid="button-copy-id" onClick={copyId} type="button"><Copy className="h-4 w-4" /> Copy organization ID</button>
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[#4b6269] hover:bg-[#edf4ef]" data-testid="button-priority" onClick={() => { setPriority((current) => !current); setMoreOpen(false); showAction(priority ? "Removed priority flag." : "Marked as priority."); }} type="button"><Tag className="h-4 w-4" /> {priority ? "Remove priority flag" : "Mark as priority"}</button>
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[#4b6269] hover:bg-[#edf4ef]" data-testid="button-archive" onClick={() => { setMoreOpen(false); showAction("Archive is available from the live organization workspace."); }} type="button"><Archive className="h-4 w-4" /> Archive relationship</button>
              </div>
            ) : null}
          </div>
        </div>

        <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] shadow-[0_12px_32px_rgba(32,71,77,0.06)]">
          <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-[#bfd5ca] bg-[#e3eee8] text-xl font-bold tracking-tight text-[#397064]">PR</div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {editing ? (
                    <input
                      aria-label="Organization name"
                      className="h-9 min-w-[250px] rounded-lg border border-[#98b5a8] bg-[#f8fbf7] px-3 text-lg font-bold text-[#173b48] outline-none ring-2 ring-[#d9e9df]"
                      data-testid="input-organization-name"
                      onChange={(event) => setDraftName(event.target.value)}
                      value={draftName}
                    />
                  ) : (
                    <h1 className="break-words text-2xl font-bold tracking-[-0.03em] text-[#173b48] sm:text-3xl" data-testid="text-organization-name">{organizationName}</h1>
                  )}
                  {priority ? <span className="rounded-full bg-[#f6e8d9] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#995c3d]">Priority</span> : null}
                  <span className="rounded-full bg-[#e2efe9] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#397064]">Active relationship</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#688087]">
                  <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-[#4b8575]" />Estes Park, Colorado</span>
                  <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4 text-[#4b8575]" />Outdoor adventure</span>
                  <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-[#4b8575]" />Verified details</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#71848a]">
                  <span className="inline-flex items-center gap-2" aria-label={`${reviewRating} out of 5 stars from ${reviewCount} reviews`}>
                    <span className="inline-flex items-center gap-0.5 text-[#d4874f]" aria-hidden="true">
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star className="h-3.5 w-3.5" fill={index < 4 ? "currentColor" : "none"} key={index} strokeWidth={1.8} />
                      ))}
                    </span>
                    <span className="font-bold text-[#45616a]">{reviewRating}</span>
                    <span>({reviewCount} reviews)</span>
                  </span>
                  <a
                    className="inline-flex items-center gap-1.5 font-semibold text-[#397064] hover:text-[#244f47]"
                    data-testid="link-header-website"
                    href={organizationWebsite}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Visit website
                  </a>
                  <span>Relationship owner <span className="font-semibold text-[#45616a]">Alex Morgan</span> · Last touched Apr 16, 2025</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {editing ? (
                <>
                  <button className="button-primary inline-flex items-center gap-2 !bg-[#397064] hover:!bg-[#2d5d54]" data-testid="button-save-edit" onClick={saveEdit} type="button"><Check className="h-4 w-4" />Save changes</button>
                  <button className="button-secondary inline-flex items-center gap-2 !bg-transparent" data-testid="button-cancel-edit" onClick={() => { setDraftName(organizationName); setEditing(false); }} type="button"><X className="h-4 w-4" />Cancel</button>
                </>
              ) : (
                <>
                  <button className="button-secondary inline-flex items-center gap-2 !border-[#cad9d3] !bg-transparent !text-[#315b66]" data-testid="button-edit-profile" onClick={() => { setDraftName(organizationName); setEditing(true); }} type="button"><Edit3 className="h-4 w-4" />Edit profile</button>
                  <button className="button-primary inline-flex items-center gap-2 !bg-[#397064] hover:!bg-[#2d5d54]" data-testid="button-add-note-header" onClick={() => { setSection("notes"); setComposerOpen(true); }} type="button"><Plus className="h-4 w-4" />Add note</button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e1e8e3] px-4 py-3 sm:px-7">
            <nav aria-label="Organization sections" className="flex flex-wrap items-center gap-1" data-testid="nav-profile-sections">
              <SectionButton active={section === "overview"} label="Overview" onClick={() => selectSection("overview")} testId="tab-overview" />
              <SectionButton active={section === "contacts"} count={contacts.length} label="Contacts" onClick={() => selectSection("contacts")} testId="tab-contacts" />
              <SectionButton active={section === "events"} count={bookings.length} label="Events" onClick={() => selectSection("events")} testId="tab-events" />
              <SectionButton active={section === "notes"} count={activities.length} label="Activity" onClick={() => selectSection("notes")} testId="tab-activity" />
              <SectionButton active={section === "emails"} count={8} label="Emails" onClick={() => selectSection("emails")} testId="tab-emails" />
            </nav>
            <span className="hidden items-center gap-1.5 text-xs font-semibold text-[#809295] md:inline-flex"><Clock3 className="h-3.5 w-3.5" />Mountain Time (MT)</span>
          </div>
        </section>

        {actionMessage ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#b9d2c5] bg-[#eaf4ed] px-4 py-3 text-sm font-semibold text-[#356357]" data-testid="status-action-message" role="status">
            <Check className="h-4 w-4" />{actionMessage}
          </div>
        ) : null}

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric active={section === "contacts"} icon={<UsersRound className="h-4 w-4" />} label="Contacts" onClick={() => selectSection("contacts")} testId="metric-contacts" value={String(contacts.length)} />
          <Metric active={section === "events"} icon={<CalendarDays className="h-4 w-4" />} label="Upcoming events" onClick={() => selectSection("events")} testId="metric-events" value={String(bookings.length)} />
          <Metric active={section === "notes"} icon={<StickyNote className="h-4 w-4" />} label="Activity notes" onClick={() => selectSection("notes")} testId="metric-notes" value={String(activities.length)} />
          <Metric active={section === "emails"} icon={<Mail className="h-4 w-4" />} label="Email threads" onClick={() => selectSection("emails")} testId="metric-emails" value="8" />
        </section>

        {section === "overview" ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.85fr)]">
            <div className="grid gap-5">
              <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
                {followUpOpen ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Next action</p>
                        <h2 className="mt-1 text-xl font-bold tracking-tight text-[#173b48]">Send fall retreat proposal</h2>
                        <p className="mt-1 text-sm text-[#71848a]">Keep the relationship moving while pricing is fresh.</p>
                      </div>
                      <span className="rounded-full bg-[#faecd9] px-2.5 py-1 text-xs font-bold text-[#9b633e]">Due May 2</span>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#e5ebe5] pt-4">
                      <div className="flex items-center gap-2 text-sm text-[#526970]"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dbe9e4] text-xs font-bold text-[#397064]">{primary.initials}</span><span><span className="block text-xs text-[#87989a]">Assigned to</span><span className="font-semibold">{primary.name}</span></span></div>
                      <div className="flex items-center gap-2">
                        <button className="button-secondary inline-flex items-center gap-2 !border-[#cad9d3] !bg-transparent !text-[#315b66]" data-testid="button-snooze-follow-up" onClick={() => showAction("Follow-up snoozed until next week.")} type="button"><Clock3 className="h-4 w-4" />Snooze</button>
                        <button className="button-primary inline-flex items-center gap-2 !bg-[#397064] hover:!bg-[#2d5d54]" data-testid="button-complete-follow-up" onClick={() => { setFollowUpOpen(false); showAction("Follow-up marked complete."); }} type="button"><Check className="h-4 w-4" />Complete</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Next action</p><h2 className="mt-1 text-xl font-bold tracking-tight text-[#397064]">All caught up</h2><p className="mt-1 text-sm text-[#71848a]">No open follow-ups for this organization.</p></div>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e2efe9] text-[#397064]"><Check className="h-5 w-5" /></span>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Relationship activity</p><h2 className="mt-1 text-xl font-bold tracking-tight text-[#173b48]">Recent history</h2></div>
                  <button className="inline-flex items-center gap-1.5 text-sm font-bold text-[#397064] hover:text-[#244f47]" data-testid="button-view-all-activity" onClick={() => selectSection("notes")} type="button">View all <ArrowUpRight className="h-4 w-4" /></button>
                </div>
                <div className="mt-5 grid gap-4">
                  {activities.slice(0, 3).map((activity) => (
                    <article className="flex gap-3" data-testid={`card-activity-${activity.id}`} key={activity.id}>
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${activity.kind === "call" ? "bg-[#f5e6dc] text-[#a66845]" : "bg-[#e3eee8] text-[#397064]"}`}>
                        {activity.kind === "call" ? <Phone className="h-4 w-4" /> : <StickyNote className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1 border-b border-[#edf0eb] pb-4 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-[0.1em] text-[#668078]">{activity.kind}</p><time className="text-xs text-[#8b9a9b]">{formatShortDate(activity.occurredAt)}</time></div>
                        <p className="mt-1 text-sm leading-6 text-[#4d666d]">{activity.body}</p>
                        <p className="mt-2 text-xs font-semibold text-[#8b9a9b]">{activity.author}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <aside className="grid content-start gap-5">
              <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)]">
                <div className="flex items-center justify-between gap-2"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Primary contact</p><h2 className="mt-1 text-lg font-bold text-[#173b48]">{primary.name}</h2></div><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dbe9e4] text-xs font-bold text-[#397064]">{primary.initials}</span></div>
                <p className="mt-1 text-sm text-[#71848a]">{primary.role}</p>
                <div className="mt-4 grid gap-2">
                  <a className="flex items-center gap-2 rounded-lg bg-[#f1f5f1] px-3 py-2.5 text-sm font-semibold text-[#4b6870] hover:bg-[#e6f0e9]" data-testid="link-primary-phone" href={`tel:${primary.phone}`}><Phone className="h-4 w-4 text-[#4b8575]" />{primary.phone}</a>
                  <a className="flex items-center gap-2 rounded-lg bg-[#f1f5f1] px-3 py-2.5 text-sm font-semibold text-[#4b6870] hover:bg-[#e6f0e9]" data-testid="link-primary-email" href={`mailto:${primary.email}`}><Mail className="h-4 w-4 text-[#4b8575]" />{primary.email}</a>
                </div>
                <div className="mt-4 flex gap-2">
                  <button className="button-secondary inline-flex flex-1 items-center justify-center gap-2 !border-[#cad9d3] !bg-transparent !text-[#315b66]" data-testid="button-call-primary" onClick={() => showAction(`Opening call workspace for ${primary.name}.`)} type="button"><Phone className="h-4 w-4" />Call</button>
                  <button className="button-secondary inline-flex flex-1 items-center justify-center gap-2 !border-[#cad9d3] !bg-transparent !text-[#315b66]" data-testid="button-message-primary" onClick={() => showAction(`Drafting an email to ${primary.name}.`)} type="button"><Send className="h-4 w-4" />Message</button>
                </div>
              </section>

              <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)]">
                <div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Relationship health</p><span className="text-xs font-bold text-[#397064]">Good standing</span></div>
                <div className="mt-4 flex items-end justify-between"><span className="text-3xl font-bold tracking-tight text-[#173b48]">4.7 <span className="text-sm font-semibold text-[#849597]">/ 5</span></span><span className="text-xs text-[#849597]">12 rated occurrences</span></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e1e9e4]"><div className="h-full w-[94%] rounded-full bg-[#5d9583]" /></div>
                <p className="mt-3 text-sm leading-5 text-[#71848a]">Strong partner for group stays. Keep response cadence steady through the fall proposal.</p>
              </section>
            </aside>
          </div>
        ) : null}

        {section === "contacts" ? (
          <section className="mt-5 rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">People at this organization</p><h2 className="mt-1 text-xl font-bold text-[#173b48]">Contacts</h2></div><button className="button-primary inline-flex items-center gap-2 !bg-[#397064] hover:!bg-[#2d5d54]" data-testid="button-add-contact" onClick={() => showAction("Contact creation is ready in the live workspace.")} type="button"><Plus className="h-4 w-4" />Add contact</button></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {contacts.map((contact) => (
                <article className="rounded-xl border border-[#dce6e0] bg-[#f8faf6] p-4" data-testid={`card-contact-${contact.id}`} key={contact.id}>
                  <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#dbe9e4] text-xs font-bold text-[#397064]">{contact.initials}</span><div><h3 className="font-bold text-[#173b48]">{contact.name}</h3><p className="text-sm text-[#71848a]">{contact.role}</p></div></div>{contact.isPrimary ? <span className="rounded-full bg-[#e2efe9] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#397064]">Primary</span> : null}</div>
                  <p className="mt-4 text-xs font-semibold text-[#839596]">{contact.availability}</p>
                  <div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex items-center gap-1.5 rounded-md border border-[#d8e2dd] px-2.5 py-2 text-xs font-bold text-[#4f6a70] hover:border-[#9ab6a9] hover:text-[#315b66]" data-testid={`link-contact-phone-${contact.id}`} href={`tel:${contact.phone}`}><Phone className="h-3.5 w-3.5" />Call</a><a className="inline-flex items-center gap-1.5 rounded-md border border-[#d8e2dd] px-2.5 py-2 text-xs font-bold text-[#4f6a70] hover:border-[#9ab6a9] hover:text-[#315b66]" data-testid={`link-contact-email-${contact.id}`} href={`mailto:${contact.email}`}><Mail className="h-3.5 w-3.5" />Email</a><button className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-[#397064]" data-testid={`button-contact-details-${contact.id}`} onClick={() => showAction(`${contact.name}'s contact details are selected.`)} type="button">Details <ArrowUpRight className="h-3.5 w-3.5" /></button></div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {section === "events" ? (
          <section className="mt-5 rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Bookings and opportunities</p><h2 className="mt-1 text-xl font-bold text-[#173b48]">Events</h2></div><button className="button-primary inline-flex items-center gap-2 !bg-[#397064] hover:!bg-[#2d5d54]" data-testid="button-add-event" onClick={() => showAction("New event planning starts in the live workspace.")} type="button"><Plus className="h-4 w-4" />Add event</button></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {bookings.map((booking) => (
                <button className="group rounded-xl border border-[#dce6e0] bg-[#f8faf6] p-4 text-left transition hover:border-[#9ab6a9] hover:bg-[#f3f8f3]" data-testid={`card-event-${booking.id}`} key={booking.id} onClick={() => showAction(`${booking.name} selected.`)} type="button">
                  <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-[#173b48]">{booking.name}</h3><p className="mt-1 text-sm text-[#71848a]">{booking.detail}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${booking.status === "Confirmed" ? "bg-[#e2efe9] text-[#397064]" : "bg-[#f6e8d9] text-[#995c3d]"}`}>{booking.status}</span></div>
                  <div className="mt-5 flex items-center justify-between border-t border-[#e5ebe5] pt-3 text-sm"><span className="inline-flex items-center gap-1.5 font-semibold text-[#536e75]"><CalendarDays className="h-4 w-4 text-[#4b8575]" />{booking.date}</span><span className="inline-flex items-center gap-1 text-xs font-semibold text-[#849597]">{booking.location}<ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" /></span></div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {section === "notes" ? (
          <section className="mt-5 rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Relationship history</p><h2 className="mt-1 text-xl font-bold text-[#173b48]">Activity</h2></div><button className="button-primary inline-flex items-center gap-2 !bg-[#397064] hover:!bg-[#2d5d54]" data-testid="button-add-note" onClick={() => setComposerOpen(true)} type="button"><Plus className="h-4 w-4" />Add note</button></div>
            <label className="relative mt-5 block max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8da09d]" /><input aria-label="Search activity" className="w-full rounded-lg border border-[#d3e0d9] bg-[#f8faf6] py-2.5 pl-9 pr-3 text-sm text-[#173b48] outline-none transition focus:border-[#8eae9e] focus:ring-2 focus:ring-[#dcebe1]" data-testid="input-search-activity" onChange={(event) => setNoteSearch(event.target.value)} placeholder="Search notes, calls, and outreach" value={noteSearch} /></label>
            {composerOpen ? <div className="mt-4 rounded-xl border border-[#bfd5ca] bg-[#edf5ef] p-4"><label className="grid gap-2 text-sm font-bold text-[#315b66]" htmlFor="new-note">New note<textarea autoFocus className="min-h-24 rounded-lg border border-[#c8dcd0] bg-[#fbfcf8] px-3 py-2 font-normal text-[#173b48] outline-none focus:ring-2 focus:ring-[#d3e8da]" data-testid="textarea-new-note" id="new-note" onChange={(event) => setNoteBody(event.target.value)} placeholder="Capture the next useful detail..." value={noteBody} /></label><div className="mt-3 flex flex-wrap gap-2"><button className="button-primary !bg-[#397064] hover:!bg-[#2d5d54]" data-testid="button-save-note" disabled={!noteBody.trim()} onClick={addNote} type="button">Save note</button><button className="button-secondary !bg-transparent" data-testid="button-cancel-note" onClick={() => { setComposerOpen(false); setNoteBody(""); }} type="button">Cancel</button></div></div> : null}
            <div className="mt-6 grid gap-4">
              {filteredActivities.length ? filteredActivities.map((activity) => <article className="flex gap-3" data-testid={`row-activity-${activity.id}`} key={activity.id}><div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${activity.kind === "call" ? "bg-[#f5e6dc] text-[#a66845]" : activity.kind === "email" ? "bg-[#e8e8f0] text-[#6b668c]" : "bg-[#e3eee8] text-[#397064]"}`}>{activity.kind === "call" ? <Phone className="h-4 w-4" /> : activity.kind === "email" ? <Mail className="h-4 w-4" /> : <StickyNote className="h-4 w-4" />}</div><div className="min-w-0 flex-1 border-b border-[#e5ebe5] pb-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-[#668078]">{activity.kind}</span><time className="text-xs text-[#8b9a9b]">{formatDateTime(activity.occurredAt)}</time></div><p className="mt-2 text-sm leading-6 text-[#4d666d]">{activity.body}</p><p className="mt-2 text-xs font-semibold text-[#8b9a9b]">Logged by {activity.author}</p></div></article>) : <div className="rounded-xl border border-dashed border-[#cbdad2] bg-[#f4f8f4] p-8 text-center" data-testid="empty-activity"><Search className="mx-auto h-7 w-7 text-[#8ca49a]" /><p className="mt-3 font-bold text-[#315b66]">No activity matches that search</p><p className="mt-1 text-sm text-[#7b8d90]">Try a different keyword or clear the search.</p></div>}
            </div>
          </section>
        ) : null}

        {section === "emails" ? (
          <section className="mt-5 rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Outreach history</p><h2 className="mt-1 text-xl font-bold text-[#173b48]">Email threads</h2></div><button className="button-primary inline-flex items-center gap-2 !bg-[#397064] hover:!bg-[#2d5d54]" data-testid="button-compose-email" onClick={() => showAction(`Drafting an email to ${primary.name}.`)} type="button"><Send className="h-4 w-4" />Compose email</button></div>
            <div className="mt-5 grid gap-2">
              {emailThreads.map((thread) => <button className="flex items-center gap-3 rounded-xl border border-[#dce6e0] bg-[#f8faf6] p-4 text-left transition hover:border-[#9ab6a9] hover:bg-[#f3f8f3]" data-testid={`row-email-${thread.id}`} key={thread.id} onClick={() => showAction(`Opening “${thread.subject}”.`)} type="button"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${thread.unread ? "bg-[#d47e4d]" : "bg-[#cbd8d2]"}`} /><span className="min-w-0 flex-1"><span className="block truncate font-bold text-[#315b66]">{thread.subject}</span><span className="mt-1 block text-xs text-[#839596]">{thread.from} · {thread.date}</span></span><ArrowUpRight className="h-4 w-4 shrink-0 text-[#87a19a]" /></button>)}
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-lg bg-[#f1f5f1] px-3 py-3 text-sm text-[#71848a]"><MessageCircle className="h-4 w-4 text-[#4b8575]" />8 conversations with {organizationName} synced from outreach.</div>
          </section>
        ) : null}

        <section className="mt-5 rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
          <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Organization record</p><h2 className="mt-1 text-xl font-bold text-[#173b48]">Details</h2></div><button aria-label="Configure visible details" className="rounded-lg p-2 text-[#829696] hover:bg-[#edf4ef] hover:text-[#315b66]" data-testid="button-configure-details" onClick={() => showAction("Details configuration opened.")} type="button"><SlidersHorizontal className="h-4 w-4" /></button></div>
          <dl className="mt-5 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="font-semibold text-[#829696]">Address</dt><dd className="mt-1 leading-6 text-[#4d666d]" data-testid="text-address">1420 Mountain View Drive<br />Estes Park, CO 80517</dd></div>
             <div><dt className="font-semibold text-[#829696]">Website</dt><dd className="mt-1"><a className="inline-flex items-center gap-1.5 font-semibold text-[#397064] hover:text-[#244f47]" data-testid="link-website" href={organizationWebsite} rel="noreferrer noopener" target="_blank">pineridgeadventure.com <ExternalLink className="h-3.5 w-3.5" /></a></dd></div>
            <div><dt className="font-semibold text-[#829696]">Organization group</dt><dd className="mt-1 text-[#4d666d]" data-testid="text-organization-group">Colorado Mountain Partners</dd></div>
            <div><dt className="font-semibold text-[#829696]">Relationship started</dt><dd className="mt-1 text-[#4d666d]" data-testid="text-relationship-started">September 2022</dd></div>
          </dl>
        </section>

        {followUpOpen ? null : <button className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#397064]" data-testid="button-restore-follow-up" onClick={() => setFollowUpOpen(true)} type="button"><Bell className="h-4 w-4" />Restore open follow-up</button>}
      </div>
    </main>
  );
}