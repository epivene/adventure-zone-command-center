import { useState, type FormEvent } from "react";
import { ArrowLeft, CalendarDays, FileText, Mail, Search, StickyNote, UserRound } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";

export type CrmWorkItem = {
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

type RouteScreenBase = {
  workItems: CrmWorkItem[];
  onOpenProfile: (id: string) => void;
  onOpenEmail: (id: string) => void;
};

export function ProfilesDirectory({ workItems, onOpenProfile }: Pick<RouteScreenBase, "workItems" | "onOpenProfile">) {
  const [query, setQuery] = useState("");
  const matches = workItems.filter((item) =>
    `${item.event} ${item.person} ${item.contactRole} ${item.city} ${item.state}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <section className="grid gap-4" aria-labelledby="profiles-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Booking workspace</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight" id="profiles-heading">Profiles</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search organizer profiles and open their full event-year detail.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="profile-search">Search profiles</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" id="profile-search" onChange={(event) => setQuery(event.target.value)} placeholder="Organizer, event, city…" value={query} />
        </div>
      </div>
      {matches.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {matches.map((item) => (
            <Card key={item.id}>
              <CardContent className="grid gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.event}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.city}, {item.state} · {item.when}</p>
                  </div>
                  <Badge variant="outline">{item.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground"><UserRound className="mr-1 inline h-4 w-4" />{item.person} · {item.contactRole}</p>
                <Button className="w-fit" onClick={() => onOpenProfile(item.id)} size="sm" variant="outline">Open profile</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="grid gap-1 p-6 text-center">
            <p className="font-semibold">No matching profiles</p>
            <p className="text-sm text-muted-foreground">Try another organizer, event, or location.</p>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Demo directory · profile selection is local to this preview.</p>
    </section>
  );
}

export function ProfileDetailScreen({
  item,
  note,
  noteDraft,
  onNoteDraftChange,
  onSaveNote,
  onOpenEmail,
  onBack,
}: {
  item: CrmWorkItem;
  note: string;
  noteDraft: string;
  onNoteDraftChange: (value: string) => void;
  onSaveNote: (event: FormEvent<HTMLFormElement>) => void;
  onOpenEmail: () => void;
  onBack: () => void;
}) {
  return (
    <section className="grid gap-4" aria-labelledby="profile-detail-heading">
      <Button className="w-fit" onClick={onBack} size="sm" variant="ghost"><ArrowLeft className="mr-1 h-4 w-4" />Back to profiles</Button>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Organizer profile</p>
              <CardTitle className="mt-1" id="profile-detail-heading">{item.event}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{item.city}, {item.state} · {item.person}, {item.contactRole}</p>
            </div>
            <Badge variant="secondary">{item.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <section aria-labelledby="organizer-record-title" className="grid gap-3 rounded-lg border border-border p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organizer record · ongoing relationship</p>
              <h2 className="mt-1 font-semibold" id="organizer-record-title">{item.person} · {item.contactRole}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{item.relationshipHistory}</p>
            <p className="text-xs text-muted-foreground">Last contacted {item.lastContact}</p>
            <div className="rounded-md bg-muted p-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><StickyNote className="h-4 w-4" />Newest organizer note</p>
              <p className="mt-2 text-sm font-semibold">{note}</p>
            </div>
            <form className="grid gap-2" onSubmit={onSaveNote}>
              <Label htmlFor="profile-note-draft">Add a local note</Label>
              <Textarea id="profile-note-draft" onChange={(event) => onNoteDraftChange(event.target.value)} placeholder="Add a practical detail from the latest conversation" value={noteDraft} />
              <Button className="w-fit" disabled={!noteDraft.trim()} size="sm" type="submit">Add note to preview</Button>
            </form>
          </section>

          <section aria-labelledby="annual-edition-title" className="grid gap-3 rounded-lg border border-border p-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Annual edition · event-year record</p>
            </div>
            <h2 className="font-semibold" id="annual-edition-title">{item.event} · {item.when}</h2>
            <p className="text-sm text-muted-foreground">{item.editionDetails}</p>
            <p className="text-xs text-muted-foreground">Edition dates and on-site details are kept separate from organizer relationship history.</p>
          </section>

          <section className="grid gap-2 rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Newest email</p>
            <p className="font-semibold">{item.emailSubject}</p>
            <p className="text-sm text-muted-foreground">{item.emailDate} · from {item.person}</p>
            <Button className="w-fit" onClick={onOpenEmail} size="sm" variant="outline"><Mail className="mr-1 h-4 w-4" />Open this email thread</Button>
          </section>
        </CardContent>
      </Card>
    </section>
  );
}

export function EmailInbox({ workItems, onOpenProfile, onOpenEmail }: RouteScreenBase) {
  return (
    <section className="grid gap-4" aria-labelledby="emails-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Booking workspace</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight" id="emails-heading">Emails</h1>
        <p className="mt-1 text-sm text-muted-foreground">Demo inbox · open a thread or follow it to its organizer profile.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent organizer threads</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {workItems.map((item) => (
            <article className="grid gap-2 rounded-lg border border-border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={item.id}>
              <div className="min-w-0">
                <p className="font-semibold">{item.emailSubject}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.person} · {item.event}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.emailDate}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => onOpenEmail(item.id)} size="sm">Open thread</Button>
                <Button onClick={() => onOpenProfile(item.id)} size="sm" variant="outline">Profile</Button>
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

export function EmailThreadScreen({ item, onBack, onOpenProfile }: { item: CrmWorkItem; onBack: () => void; onOpenProfile: () => void }) {
  return (
    <section className="grid gap-4" aria-labelledby="email-thread-heading">
      <Button className="w-fit" onClick={onBack} size="sm" variant="ghost"><ArrowLeft className="mr-1 h-4 w-4" />Back to Emails</Button>
      <Card>
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Organizer email · preview thread</p>
          <CardTitle className="mt-1" id="email-thread-heading">{item.emailSubject}</CardTitle>
          <p className="text-sm text-muted-foreground">From {item.person} · {item.emailDate} · {item.event}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="rounded-lg border border-border bg-muted p-4">
            <p className="text-sm font-semibold">{item.person} · {item.contactRole}</p>
            <p className="mt-3 text-sm leading-6">{item.emailBody}</p>
          </div>
          <p className="text-xs text-muted-foreground">Demo email thread · no real messages are sent or changed.</p>
          <Button className="w-fit" onClick={onOpenProfile} size="sm" variant="outline"><UserRound className="mr-1 h-4 w-4" />Open {item.event} profile</Button>
        </CardContent>
      </Card>
    </section>
  );
}

export function ScheduleScreen({
  workItems,
  assignedLegs,
  onOpenProfile,
}: Pick<RouteScreenBase, "workItems" | "onOpenProfile"> & { assignedLegs: Record<string, string> }) {
  return (
    <section className="grid gap-4" aria-labelledby="schedule-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Booking workspace</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight" id="schedule-heading">Schedule &amp; Routes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Event dates, booking assignments, and planning suggestions at a glance.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Demo event schedule</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {workItems.map((item) => (
            <article className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)] sm:items-center" key={item.id}>
              <div className="min-w-0">
                <p className="font-semibold">{item.event}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.when} · {item.city}, {item.state}</p>
                <p className="mt-2 text-sm">{item.status}</p>
              </div>
              <div className="grid gap-2 sm:justify-items-end">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Assigned · {assignedLegs[item.id] || "Unassigned"}</Badge>
                  <Badge variant="secondary">Suggested · {item.suggestedLeg}</Badge>
                </div>
                <Button className="w-fit" onClick={() => onOpenProfile(item.id)} size="sm" variant="outline">Open event profile</Button>
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Leg assignment choices shown here are local preview state only.</p>
    </section>
  );
}

export type DemoDocument = {
  id: string;
  itemId: string;
  title: string;
  category: string;
  summary: string;
};

export function DemoDocuments({ workItems }: { workItems: CrmWorkItem[] }) {
  const documents: DemoDocument[] = workItems.map((item) => ({
    id: `${item.id}-edition`,
    itemId: item.id,
    title: `${item.event} · event-year reference`,
    category: "Edition reference",
    summary: `${item.when}. ${item.editionDetails}`,
  }));
  return <DocumentsDirectory documents={documents} workItems={workItems} />;
}

function DocumentsDirectory({ documents, workItems }: { documents: DemoDocument[]; workItems: CrmWorkItem[] }) {
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const activeDocument = documents.find((document) => document.id === activeDocumentId);
  const activeItem = workItems.find((item) => item.id === activeDocument?.itemId);

  if (activeDocument && activeItem) {
    return (
      <section className="grid gap-4" aria-labelledby="document-detail-heading">
        <Button className="w-fit" onClick={() => setActiveDocumentId(null)} size="sm" variant="ghost"><ArrowLeft className="mr-1 h-4 w-4" />Back to Documents</Button>
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Document detail · demo reference</p>
            <CardTitle className="mt-1" id="document-detail-heading">{activeDocument.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{activeItem.city}, {activeItem.state} · {activeItem.when}</p>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Badge className="w-fit" variant="outline">{activeDocument.category} · mock content only</Badge>
            <div className="rounded-lg border border-border bg-muted p-4">
              <p className="text-sm leading-6">{activeDocument.summary}</p>
            </div>
            <p className="text-xs text-muted-foreground">This is a preview reference assembled from the demo record, not a live CRM file.</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="grid gap-4" aria-labelledby="documents-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Booking workspace</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight" id="documents-heading">Documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">Open a preview reference tied to an event-year record.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Event document references</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {documents.map((document) => {
            const item = workItems.find((candidate) => candidate.id === document.itemId);
            if (!item) return null;
            return (
              <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4" key={document.id}>
                <div className="flex min-w-0 items-start gap-3">
                  <FileText className="mt-1 h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-semibold">{document.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.event} · {document.category}</p>
                  </div>
                </div>
                <Button onClick={() => setActiveDocumentId(document.id)} size="sm" variant="outline">Open reference</Button>
              </article>
            );
          })}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Preview-only index · no live files or downloads are connected.</p>
    </section>
  );
}
