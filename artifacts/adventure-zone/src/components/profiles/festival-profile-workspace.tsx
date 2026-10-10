import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FestivalEdition } from "@workspace/api-client-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/avz-crm/components/ui/accordion";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Label } from "@workspace/avz-crm/components/ui/label";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { apiGet } from "@/lib/auth-token";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";
import { FestivalEditionEditor } from "./festival-edition-editor";
import { editionGroups } from "./festival-edition-fields";
import { FestivalCrewLocation } from "./festival-crew-location";
import { ProfileLatestNote } from "./profile-latest-note";
import { ProfileLatestEmail } from "./profile-latest-email";
import type { ProfileGoogleEmailState } from "@/components/google-workspace/use-profile-google-email";

function calendarLabel(value: string | undefined) {
  if (!value) return "Not added yet";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
function Detail({ label, value, url }: { label: string; value?: string | null; url?: boolean }) {
  return <div className="min-w-0"><p className="text-xs font-semibold text-muted-foreground">{label}</p>
    <p className="mt-1 whitespace-pre-line break-words text-sm leading-6">{value ? url ? <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">Open {label.toLowerCase()}</a> : value : <span className="text-muted-foreground">Not added yet</span>}</p></div>;
}

export function FestivalProfileWorkspace({ profile, ratingSummary, onFollowUp, onBack, originLabel, legacyTools, toolsOpen = false, onNoteSaved, children, profileEmails }: {
  profile: EventProfile; ratingSummary?: { average: number | null; count: number };
  onFollowUp(): void; onBack(): void; originLabel: string; legacyTools: ReactNode; toolsOpen?: boolean;
  onNoteSaved?(): Promise<void> | void;
  children?: ReactNode;
  profileEmails?: ProfileGoogleEmailState;
}) {
  const [editions, setEditions] = useState<FestivalEdition[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ edition: FestivalEdition | null; year: number } | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [stopEditing, setStopEditing] = useState(false);
  const [showTools, setShowTools] = useState(toolsOpen);
  useEffect(() => { if (toolsOpen) setShowTools(true); }, [toolsOpen]);
  const generation = useRef(0);
  const initialized = useRef(false);
  async function load() {
    const read = ++generation.current;
    try {
      const value = await apiGet<{ editions: FestivalEdition[] }>(`/event-profiles/${profile.id}/editions`);
      if (read !== generation.current) return;
      setEditions(value.editions);
      if (!initialized.current) { setYear(value.editions[0]?.year ?? new Date().getFullYear()); initialized.current = true; }
      setError(null);
    } catch { if (read === generation.current) setError("Festival years could not be loaded. Existing organizer and booking information is still available below."); }
    finally { if (read === generation.current) setLoading(false); }
  }
  useEffect(() => {
    initialized.current = false; void load();
    const refresh = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => { generation.current++; window.removeEventListener("focus", refresh); window.clearInterval(interval); };
  }, [profile.id]);
  const edition = editions.find(item => item.year === year);
  const detail = edition?.details ?? {};
  const contact = (profile.contacts ?? []).find(item => item.isPrimary) ?? profile.contacts?.[0];
  const nextFollowUp = (profile.followUps ?? []).filter(item => !item.completedAt).toSorted((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
  const website = normalizeExternalWebsite(profile.place.website);
  const years = [...new Set([year, ...editions.map(item => item.year)])].sort((a, b) => b - a);
  function saved(value: FestivalEdition) {
    generation.current++;
    setEditions(current => [...current.filter(item => item.year !== value.year), value]);
    setYear(value.year); setEditor(null); setSavedNotice(true);
  }
  return <section className="grid min-w-0 max-w-full grid-cols-1 gap-5 text-foreground" aria-label="Festival profile workspace">
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>Back to {originLabel}</Button>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-primary">Adventure Zone · Organizer profile</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{profile.place.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{[profile.place.city, profile.place.region].filter(Boolean).join(", ")}</p>
      </div>
      {ratingSummary?.count ? <Badge variant="outline">{ratingSummary.average?.toFixed(1) ?? "—"} · {ratingSummary.count} reviews</Badge> : <Badge variant="outline">No reviews yet</Badge>}
    </header>
    <ProfileLatestNote key={profile.id} profileId={profile.id} contactId={contact?.id} notes={profile.notes ?? []} onSaved={onNoteSaved}
      relatedActivity={profileEmails ? <ProfileLatestEmail key={`email-${profile.id}`} profileId={profile.id} gmail={profileEmails} compact /> : null} />
    {savedNotice ? <p role="status" className="text-sm font-semibold text-primary">Event-year details saved.</p> : null}
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.9fr)]">
      <div className="grid min-w-0 gap-4">
        <Card>
          <CardHeader className="flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Festival edition</p><CardTitle className="mt-1">{year} event record</CardTitle></div>
            <div className="grid w-full gap-1 sm:w-52"><Label htmlFor="profile-event-year">Choose year</Label>
              <Select value={String(year)} disabled={Boolean(editor) || loading || stopEditing} onValueChange={value => { setYear(Number(value)); setSavedNotice(false); }}>
                <SelectTrigger id="profile-event-year"><SelectValue /></SelectTrigger><SelectContent>{years.map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent>
              </Select></div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {loading ? <p role="status" className="text-sm text-muted-foreground">Loading event years…</p> : error ? <div role="alert"><p className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div> : editor
              ? <FestivalEditionEditor key={`${profile.id}-${editor.year}-${editor.edition?.id ?? "new"}`} organizationId={profile.id} edition={editor.edition} initialYear={editor.year} onSaved={saved} onCancel={() => { setEditor(null); void load(); }} />
              : <>
                <div className="grid gap-3 rounded-md border border-border bg-muted p-4 sm:grid-cols-2">
                  <Detail label={`Event dates · ${year}`} value={detail.startsOn ? `${calendarLabel(detail.startsOn)}${detail.endsOn ? ` – ${calendarLabel(detail.endsOn)}` : ""}` : null} />
                  <Detail label={`Application deadline · ${year}`} value={detail.applicationDeadline ? calendarLabel(detail.applicationDeadline) : null} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2"><Detail label="Venue & setting" value={[detail.venue, detail.setting].filter(Boolean).join(" · ")} /><Detail label="Category & attendance" value={[detail.category, detail.attendance].filter(Boolean).join(" · ")} /></div>
                {!edition ? <p className="text-sm text-muted-foreground">No annual details have been added for {year}. Existing dates and bookings remain in the organizer’s CRM history below.</p> : null}
                {!detail.startsOn && profile.effectiveEventDate ? <Detail label="Existing recorded event dates (CRM)" value={`${calendarLabel(profile.effectiveEventDate.startsOn)}${profile.effectiveEventDate.endsOn ? ` – ${calendarLabel(profile.effectiveEventDate.endsOn)}` : ""} · ${profile.effectiveEventDate.displayStatus}`} /> : null}
                <div className="flex flex-wrap gap-2"><Button disabled={stopEditing} variant="outline" size="sm" onClick={() => { setSavedNotice(false); setEditor({ edition: edition ?? null, year }); }}>{edition ? "Edit event details" : "Add event details"}</Button><Button disabled={stopEditing} variant="ghost" size="sm" onClick={() => setEditor({ edition: null, year: Math.max(new Date().getFullYear(), ...editions.map(item => item.year)) + 1 })}>Add another year</Button></div>
                <Accordion type="multiple">{editionGroups.map(group => <AccordionItem value={group.title} key={group.title}><AccordionTrigger>{group.title}</AccordionTrigger><AccordionContent><div className="grid gap-4 sm:grid-cols-2">{group.fields.map(field => <Detail key={field.key} label={field.label} value={field.type === "date" && detail[field.key] ? calendarLabel(detail[field.key]) : detail[field.key]} url={field.type === "url"} />)}</div></AccordionContent></AccordionItem>)}</Accordion>
              </>}
          </CardContent>
        </Card>
      </div>
      <aside className="grid content-start gap-4" aria-label="Next action and organizer summary">
        <Card><CardHeader><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next action</p><CardTitle>{nextFollowUp ? `Follow up${contact ? ` with ${contact.name}` : ""}` : "Choose the next useful step"}</CardTitle></CardHeader><CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">{nextFollowUp ? `${nextFollowUp.kind.replaceAll("_", " ")} · ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: BUSINESS_TIME_ZONE }).format(new Date(nextFollowUp.dueAt))}` : "No open follow-up. Schedule one when the organizer needs another contact."}</p>
          <Button className="w-fit" onClick={onFollowUp}>Schedule follow-up</Button>
           <div className="border-t border-border pt-3"><p className="font-semibold">Organizer contact</p></div>
          <Detail label="Primary contact" value={contact ? `${contact.name}${contact.role ? ` · ${contact.role}` : ""}` : null} />
          {contact?.email ? <a className="break-all text-sm text-primary underline" href={`mailto:${contact.email}`}>{contact.email}</a> : null}
          <Detail label="Phone" value={contact?.phone ?? profile.place.phone} />
          {website ? <a href={website} className="break-all text-sm text-primary underline" rel="noopener noreferrer" target="_blank">Organizer website</a> : null}
          {profile.place.applicationDeadline ? <Detail label="Existing organizer deadline" value={calendarLabel(profile.place.applicationDeadline)} /> : null}
          <div className="border-t border-border pt-3"><Detail label="CRM history" value={`${profile.bookings?.length ?? 0} bookings · ${profile.contacts?.length ?? 0} contacts · ${profile.notes?.length ?? 0} notes`} /></div>
          <p className="text-xs text-muted-foreground">Shared organizer and contact details apply across event years.</p>
        </CardContent></Card>
      </aside>
    </div>
    <FestivalCrewLocation key={`${profile.id}-${year}-${detail.venue ?? ""}`} organizationId={profile.id} year={year} onEditionChanged={() => void load()} onEditingChange={setStopEditing} onEditEvent={() => { setSavedNotice(false); setEditor({ edition: edition ?? null, year }); }} />
    <details className="rounded-md border border-border bg-card p-4" open={showTools} onToggle={event => setShowTools(event.currentTarget.open)}>
       <summary className="cursor-pointer font-semibold">Activity, records &amp; profile tools</summary>
      <div className="profile-modern">{legacyTools}</div>
       {children}
    </details>
  </section>;
}
