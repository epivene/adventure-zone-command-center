import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { BookingDateRepairRepository, hash, query, fail } from "../../booking-date-repair/date-repair-repository";
import { recordAuditEntry } from "../../audit/audit-service";
import { reconcileCapacityFacts } from "../../outreach-planner/outreach-commitments";
import { isBookedForSchedule } from "../../calendar/schedule-booking-state";
import { OperationalCalendarLinkRepository } from "./operational-calendar-link-repository";
import type { OperationalCalendarConnectionProvider } from "./operational-calendar-sync-service";
import type { OperationalCalendarEvent } from "./operational-calendar-client";
import { addDays, eventIdentity, reviewedDays, sameEvent, validDay, type PreviewEvent } from "./calendar-preview-model";

type Database = typeof database;
type Connection = NonNullable<Awaited<ReturnType<OperationalCalendarConnectionProvider["createOperationalCalendarClient"]>>>;
export type CalendarProposal = { profileId: string; bookingId: string; setupOn?: string; teardownOn?: string };
type Source = { type: string; id: string; revision: string; label: string; href: string };
type Facts = {
  fingerprint: string; name: string; venue: string; manager: string; city: string; region: string;
  startsOn: string | null; endsOn: string | null; setupOn: string | null; teardownOn: string | null;
  packages: Array<{ key: PreviewEvent["packageKey"]; name: string }>; sources: Source[]; problems: string[];
};
export type ProfileCalendarPreview = {
  id: string; fingerprint: string; expiresAt: string; profileId: string; bookingId: string;
  calendarId: string | null; facts: Facts; setupOn: string | null; teardownOn: string | null;
  events: PreviewEvent[]; problems: string[];
};
type SavedPreview = { proposal: CalendarProposal; preview: ProfileCalendarPreview; connectionId: string | null };
type Receipt = { state: "saved"; previewId: string; events: Array<{ id: string; packageKey: string; href: string }>; savedAt: string };
const labels = { zone: "Zone", pirates: "Pirates", warrior: "Warrior" };
const codes: Record<string, PreviewEvent["packageKey"]> = {
  adventure_zone: "zone", mini_zone: "zone", pirates_rebellion: "pirates",
  pirate_rebellion: "pirates", weekend_warriors: "warrior", warriors_playground: "warrior",
};
const linkToEvent = (calendarId: string, id: string) =>
  "https://calendar.google.com/calendar/u/0/r?cid=" + encodeURIComponent(calendarId) + "&eid=" + Buffer.from(id + " " + calendarId).toString("base64url");

export class ProfileCalendarPreviewService {
  readonly evidence = new BookingDateRepairRepository();
  readonly db: Database;
  readonly connections: OperationalCalendarConnectionProvider;
  readonly now: () => Date;
  constructor(db: Database, connections: OperationalCalendarConnectionProvider, now = () => new Date()) {
    this.db = db; this.connections = connections; this.now = now;
  }

  async facts(tx: Database, proposal: CalendarProposal, connection: Connection | null, lock = false): Promise<Facts> {
    const snapshot = await this.evidence.snapshot(tx, proposal.bookingId, lock, false);
    const b = snapshot.booking, problems = snapshot.resolved.reviewReasons.map(reason =>
      reason.includes("PUBLIC") ? "Review the complete operating dates against saved evidence."
      : reason.includes("RESERVATION") ? "Review the saved setup and teardown dates against their evidence."
      : "Resolve conflicting date evidence before saving.");
    if (b.organization_id !== proposal.profileId) fail(404, "BOOKING_OUTSIDE_PROFILE");
    if (!isBookedForSchedule(b)) problems.push("Confirm this booking before adding it to the calendar.");
    const [leg] = await query(tx, sql`SELECT to_jsonb(t) AS value FROM travel_legs t WHERE id=${b.travel_leg_id ?? null}::uuid`);
    if (!leg) problems.push("Choose the saved booking's operating leg first.");
    const name = String(b.name ?? "").trim();
    const venue = [b.venue_name, b.address1, b.city, b.region, b.postal_code].filter(Boolean).join(", ");
    if (!name || !b.venue_name || !b.city || !b.region) problems.push("Complete the saved event name and venue before adding it to the calendar.");
    const packages = snapshot.operational.booking_package_selections.map(r => {
      const template = snapshot.operational.package_templates.find(t => t.value.id === r.value.package_template_id)?.value;
      return template ? { key: codes[String(template.code).trim().toLowerCase()], name: String(template.name) } : null;
    });
    if (!packages.length || packages.some(p => !p?.key)) problems.push("Review the booking's saved calendar package selection.");
    const selected = [...new Map(packages.filter((p): p is { key: PreviewEvent["packageKey"]; name: string } => Boolean(p?.key)).map(p => [p.key, p])).values()];
    const sources: Source[] = [];
    for (const e of snapshot.resolved.endpointEvidence.filter(e => e.kind.startsWith("verified"))) {
      try {
        const source = await this.evidence.source(tx, snapshot, e.sourceRef as Parameters<BookingDateRepairRepository["source"]>[2], lock);
        if (source.revision !== e.sourceRef.revision) problems.push("Saved date evidence has changed. Review the source again.");
        sources.push({ type: source.type, id: source.id, revision: source.revision, label: source.label,
          href: source.type === "business_document" ? "/business-documents?profileId=" + proposal.profileId : "/profiles/" + proposal.profileId });
      } catch { problems.push("A saved date source is unavailable or no longer accepted. Review the evidence first."); }
    }
    if (!connection) problems.push("Connect the operational calendar before saving.");
    const days = reviewedDays(snapshot.resolved);
    // Exact revision includes raw and resolved endpoints, selected packages, location and source revisions.
    const fingerprint = hash({ booking: b, window: snapshot.window, input: snapshot.input, resolved: snapshot.resolved,
      packages: snapshot.operational.booking_package_selections, templates: snapshot.operational.package_templates,
      leg, sources, connection: connection ? { id: connection.connectionId, calendarId: connection.calendarId } : null });
    return { fingerprint, name, venue, city: String(b.city ?? ""), region: String(b.region ?? ""), manager: String(leg?.value.name ?? ""), ...days,
      packages: selected, sources: [...new Map(sources.map(s => [s.type + s.id, s])).values()], problems: [...new Set(problems)] };
  }

  private async possibleMatches(connection: Connection, name: string, start: string, end: string) {
    let page: string | null = null;
    const seen = new Set<string>();
    const matches: OperationalCalendarEvent[] = [];
    do {
      const result = await connection.client.listEvents({ calendarId: connection.calendarId,
        timeMin: start + "T00:00:00Z", timeMax: end + "T00:00:00Z", pageToken: page });
      matches.push(...result.events.filter(e => e.status !== "cancelled" && e.summary.toLowerCase().includes(name.toLowerCase())));
      page = result.nextPageToken;
      if (page && (seen.has(page) || seen.size >= 20)) fail(409, "CALENDAR_DUPLICATE_SEARCH_INCOMPLETE");
      if (page) seen.add(page);
    } while (page);
    return matches;
  }

  async preview(proposal: CalendarProposal, actor: string): Promise<ProfileCalendarPreview> {
    if (!actor) fail(403, "OWNER_ACTOR_REQUIRED");
    const connection = await this.connections.createOperationalCalendarClient();
    return this.db.transaction(async tx => {
      const facts = await this.facts(tx as Database, proposal, connection);
      const setupOn = proposal.setupOn ?? facts.setupOn, teardownOn = proposal.teardownOn ?? facts.teardownOn;
      const problems = [...facts.problems];
      if (!setupOn || !teardownOn) problems.push("Choose the setup and teardown calendar dates.");
      else if (!validDay(setupOn) || !validDay(teardownOn) || setupOn > teardownOn
        || !facts.startsOn || !facts.endsOn || setupOn > facts.startsOn || teardownOn < facts.endsOn)
        problems.push("Calendar dates must include the full verified operating dates.");
      if (facts.setupOn && setupOn && setupOn > facts.setupOn || facts.teardownOn && teardownOn && teardownOn < facts.teardownOn)
        problems.push("Calendar dates cannot shorten the saved setup/teardown window.");
      const events: PreviewEvent[] = [];
      if (!problems.length && connection && setupOn && teardownOn) {
        const repository = new OperationalCalendarLinkRepository(tx as Database);
        const allLinks = await query(tx, sql`SELECT connection_id, calendar_id, package_key FROM google_operational_calendar_links WHERE booking_id=${proposal.bookingId}::uuid`);
        if (allLinks.some(l => l.connection_id !== connection.connectionId || l.calendar_id !== connection.calendarId))
          problems.push("This booking is linked to a different calendar connection. Review existing links first.");
        if (allLinks.some(l => !facts.packages.some(p => p.key === l.package_key)))
          problems.push("Existing calendar packages differ from the saved booking. Review the links first.");
        const pending = await query(tx, sql`SELECT id FROM google_operational_calendar_reviews WHERE booking_id=${proposal.bookingId}::uuid AND state='pending'`);
        if (pending.length) problems.push("Resolve the existing calendar review before saving.");
        for (const p of facts.packages) {
          const input = {
            summary: facts.manager.toUpperCase() + " " + facts.name + " - " + facts.city + " " + facts.region.toUpperCase() + " (" + labels[p.key] + ")",
            description: "EVENT DATES: " + facts.startsOn + " – " + facts.endsOn + "\nEVENT ADDRESS/MAILING: " + facts.venue,
            startDate: setupOn, endDateExclusive: addDays(teardownOn, 1),
          };
          const link = await repository.findByBookingPackage({ connectionId: connection.connectionId, calendarId: connection.calendarId,
            bookingId: proposal.bookingId, packageKey: p.key });
          const identity = eventIdentity(proposal.bookingId, p.key);
          const existing = await connection.client.getEvent(connection.calendarId, link?.googleEventId ?? identity);
          if (link && (!existing || existing.status === "cancelled")) problems.push("A linked calendar event is missing or cancelled. Review it before saving.");
          if (!link && !existing) {
            // Check every page. A similarly named event is held for manual linking, never silently duplicated.
            const candidates = await this.possibleMatches(connection, facts.name, setupOn, input.endDateExclusive);
            if (candidates.length) problems.push("A potentially matching calendar event exists. Link or review it before saving.");
          }
          if (existing?.status === "cancelled") problems.push("The existing calendar event is cancelled.");
          if (existing && !existing.etag) problems.push("The calendar did not provide a revision for an existing event.");
          events.push({ packageKey: p.key, input, existing, eventId: existing?.id ?? identity,
            mode: existing ? sameEvent(existing, input) ? "reuse" : "update" : "create" });
        }
      }
      if (connection && events.length) {
        const possible = await this.possibleMatches(connection, facts.name, events[0].input.startDate, events[0].input.endDateExclusive);
        if (possible.some(e => !events.some(p => p.eventId === e.id)))
          problems.push("A potentially matching calendar event exists. Link or review it before saving.");
      }
      const preview: ProfileCalendarPreview = { id: randomUUID(), fingerprint: facts.fingerprint,
        expiresAt: new Date(this.now().getTime() + 15 * 60_000).toISOString(),
        profileId: proposal.profileId, bookingId: proposal.bookingId, calendarId: connection?.calendarId ?? null,
        facts, setupOn, teardownOn, events, problems: [...new Set(problems)] };
      const payload: SavedPreview = { proposal, preview, connectionId: connection?.connectionId ?? null };
      await tx.execute(sql`INSERT INTO profile_calendar_previews(id,booking_id,actor,fingerprint,payload,expires_at)
        VALUES(${preview.id}::uuid,${proposal.bookingId}::uuid,${actor},${preview.fingerprint},${JSON.stringify(payload)}::jsonb,${preview.expiresAt}::timestamptz)`);
      return preview;
    }, { isolationLevel: "repeatable read" });
  }

  async apply(input: { previewId: string; fingerprint: string }, actor: string): Promise<Receipt> {
    if (!actor) fail(403, "OWNER_ACTOR_REQUIRED");
    return reconcileCapacityFacts(this.db, "calendar-sync", async tx => {
      const [record] = await query(tx, sql`SELECT * FROM profile_calendar_previews WHERE id=${input.previewId}::uuid FOR UPDATE`);
      if (!record) fail(404, "PREVIEW_NOT_FOUND");
      if (record.actor !== actor) fail(403, "PREVIEW_ACTOR_MISMATCH");
      if (record.fingerprint !== input.fingerprint) fail(409, "PREVIEW_MISMATCH");
      if (record.receipt) return record.receipt as Receipt;
      if (new Date(record.expires_at) <= this.now()) fail(409, "PREVIEW_EXPIRED");
      const saved = record.payload as SavedPreview, preview = saved.preview;
      if (preview.problems.length || !preview.events.length) fail(409, "RESOLVE_PREVIEW_CHECKS");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('profile-calendar:' || ${preview.bookingId}))`);
      const connection = await this.connections.createOperationalCalendarClient();
      if (!connection || saved.connectionId !== connection.connectionId || preview.calendarId !== connection.calendarId)
        fail(409, "CALENDAR_CONNECTION_CHANGED");
      const current = await this.facts(tx as Database, saved.proposal, connection, true);
      if (current.fingerprint !== input.fingerprint || current.problems.length) fail(409, "PREVIEW_STALE");
      const repository = new OperationalCalendarLinkRepository(tx as Database);
      const pending = await query(tx, sql`SELECT id FROM google_operational_calendar_reviews WHERE booking_id=${preview.bookingId}::uuid AND state='pending'`);
      if (pending.length) fail(409, "RESOLVE_CALENDAR_REVIEW");
      const allLinks = await query(tx, sql`SELECT connection_id, calendar_id, package_key FROM google_operational_calendar_links WHERE booking_id=${preview.bookingId}::uuid`);
      if (allLinks.some(l => l.connection_id !== connection.connectionId || l.calendar_id !== connection.calendarId
        || !preview.events.some(e => e.packageKey === l.package_key))) fail(409, "CALENDAR_LINK_CHANGED");
      const possible = await this.possibleMatches(connection, current.name, preview.events[0].input.startDate, preview.events[0].input.endDateExclusive);
      if (possible.some(e => !preview.events.some(p => p.eventId === e.id))) fail(409, "POSSIBLE_DUPLICATE_REQUIRES_REVIEW");
      // Validate every event before the first write. Retries may encounter a prior successful provider write.
      for (const event of preview.events) {
        const link = await repository.findByBookingPackage({ connectionId: connection.connectionId, calendarId: connection.calendarId,
          bookingId: preview.bookingId, packageKey: event.packageKey });
        if (link && link.googleEventId !== event.eventId) fail(409, "CALENDAR_LINK_CHANGED");
        const actual = await connection.client.getEvent(connection.calendarId, event.eventId);
        if (!sameEvent(actual, event.input) && (actual?.etag !== event.existing?.etag || Boolean(actual) !== Boolean(event.existing)))
          fail(409, "CALENDAR_EVENT_CHANGED");
      }
      const results: Receipt["events"] = [];
      for (const event of preview.events) {
        const actual = await connection.client.getEvent(connection.calendarId, event.eventId);
        if (!sameEvent(actual, event.input)) {
          if (actual) {
            if (!event.existing?.etag || actual.etag !== event.existing.etag) fail(409, "CALENDAR_EVENT_CHANGED");
            await connection.client.updateEvent({ calendarId: connection.calendarId, eventId: event.eventId,
              event: event.input, etag: event.existing.etag });
          } else {
            if (event.existing) fail(409, "CALENDAR_EVENT_MISSING");
            // Stable ID prevents duplicate creation after a lost response or rolled-back receipt.
            try { await connection.client.createEvent(connection.calendarId, { ...event.input, id: event.eventId }); }
            catch (error) {
              if (!sameEvent(await connection.client.getEvent(connection.calendarId, event.eventId), event.input)) throw error;
            }
          }
        }
        const verified = await connection.client.getEvent(connection.calendarId, event.eventId);
        if (!sameEvent(verified, event.input) || verified?.id !== event.eventId || !verified?.etag) fail(409, "CALENDAR_SAVE_NOT_VERIFIED");
        await repository.saveSuccessfulSync({ connectionId: connection.connectionId, calendarId: connection.calendarId,
          bookingId: preview.bookingId, packageKey: event.packageKey, googleEventId: event.eventId, etag: verified.etag,
          sourceChecksum: createHash("sha256").update(JSON.stringify(event.input)).digest("hex"), lastAppSnapshot: { ...event.input, profilePreviewId: preview.id,
            sourceFingerprint: preview.fingerprint, sources: preview.facts.sources },
          reservedStartsAt: new Date(event.input.startDate + "T00:00:00Z"), reservedEndsAt: new Date(event.input.endDateExclusive + "T00:00:00Z"),
          syncedAt: this.now() });
        results.push({ id: event.eventId, packageKey: event.packageKey, href: linkToEvent(connection.calendarId, event.eventId) });
      }
      if ((await this.facts(tx as Database, saved.proposal, connection, true)).fingerprint !== preview.fingerprint)
        fail(409, "SOURCE_CHANGED_DURING_SAVE");
      const receipt: Receipt = { state: "saved", previewId: preview.id, events: results, savedAt: this.now().toISOString() };
      await tx.execute(sql`UPDATE profile_calendar_previews SET receipt=${JSON.stringify(receipt)}::jsonb WHERE id=${preview.id}::uuid`);
      await recordAuditEntry(tx, { entityType: "profile_calendar", entityId: preview.bookingId, action: "apply_preview",
        before: { events: preview.events.map(e => e.existing) }, after: { actor, preview, receipt, buffers: "owner-reviewed calendar planning dates" } });
      return receipt;
    });
  }
}
