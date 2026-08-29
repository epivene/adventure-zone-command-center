import { createHash } from "node:crypto";

import type { OperationalCalendarPackageKey } from "@/db/schema";
import type { GoogleConnectionRole } from "@/features/google-workspace/google-connection-repository";
import type {
  OperationalCalendarClient,
  OperationalCalendarEvent,
  OperationalCalendarEventInput,
} from "./operational-calendar-client";
import type { OperationalCalendarLink } from "./operational-calendar-link-repository";
import type { OperationalCalendarProjection, OperationalBookingState } from "./operational-calendar-projection-repository";
import { renderOperationalCalendarRows } from "./operational-calendar-renderer";

export interface OperationalCalendarProjectionStore {
  loadConfirmedBooking(bookingId: string): Promise<OperationalCalendarProjection | null>;
  ensureAppOperationalWindow?(bookingId: string): Promise<void>;
  loadBookingState?(bookingId: string): Promise<OperationalBookingState | null>;
  saveOperationalWindow(input: {
    bookingId: string;
    startsAt: Date;
    endsAt: Date;
    source: "app" | "google_calendar" | "manual";
  }): Promise<void>;
}

export interface OperationalCalendarLinkStore {
  findByBookingPackage(input: {
    connectionId: string;
    calendarId: string;
    bookingId: string;
    packageKey: OperationalCalendarPackageKey;
  }): Promise<OperationalCalendarLink | null>;
  listByBooking?(input: {
    connectionId: string;
    calendarId: string;
    bookingId: string;
  }): Promise<OperationalCalendarLink[]>;
  saveSuccessfulSync(input: {
    connectionId: string;
    calendarId: string;
    googleEventId: string;
    bookingId: string;
    packageKey: OperationalCalendarPackageKey;
    etag: string | null;
    sourceChecksum: string;
    lastAppSnapshot: Record<string, unknown>;
    reservedStartsAt: Date;
    reservedEndsAt: Date;
    syncedAt: Date;
  }): Promise<OperationalCalendarLink>;
  recordSyncError(input: { linkId: string; errorCode: string; now: Date }): Promise<void>;
  createReview(input: {
    connectionId: string;
    linkId?: string | null;
    bookingId?: string | null;
    calendarId: string;
    googleEventId: string;
    reason: string;
    proposedChanges: Record<string, unknown>;
  }): Promise<void>;
}

export interface OperationalCalendarConnectionProvider {
  createOperationalCalendarClient(): Promise<{
    connectionId: string;
    calendarId: string;
    client: OperationalCalendarClient;
  } | null>;
  markReauthorizationRequired?(errorCode: string, role?: GoogleConnectionRole): Promise<void>;
}

export type OperationalCalendarSyncResult =
  | { state: "not_confirmed_or_incomplete" }
  | { state: "not_connected" }
  | { state: "synced"; created: number; updated: number }
  | { state: "review_required"; created: number; updated: number; reviewCount: number };

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code;
  return error instanceof Error ? error.message : "GOOGLE_OPERATIONAL_CALENDAR_SYNC_FAILED";
}
function dateKey(value: Date) { return value.toISOString().slice(0, 10); }
function calendarInput(row: ReturnType<typeof renderOperationalCalendarRows>[number]): OperationalCalendarEventInput {
  return { summary: row.summary, description: row.description, startDate: dateKey(row.reservedStart), endDateExclusive: dateKey(row.reservedEnd) };
}
function eventSnapshot(event: OperationalCalendarEvent | OperationalCalendarEventInput): Record<string, unknown> {
  return { summary: event.summary, description: event.description, startDate: event.startDate, endDateExclusive: event.endDateExclusive };
}
function checksum(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
function statusPrefix(status: string) { return status === "cancelled" ? "CANCELLED" : "PLACEHOLDER"; }
function withStatusPrefix(summary: string, status: string) {
  const stripped = summary.replace(/^(CANCELLED|PLACEHOLDER)\s+/i, "").trim();
  return `${statusPrefix(status)} ${stripped}`;
}

export class OperationalCalendarSyncService {
  constructor(
    private readonly connections: OperationalCalendarConnectionProvider,
    private readonly projections: OperationalCalendarProjectionStore,
    private readonly links: OperationalCalendarLinkStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async syncConfirmedBooking(bookingId: string): Promise<OperationalCalendarSyncResult> {
    await this.projections.ensureAppOperationalWindow?.(bookingId);
    const projection = await this.projections.loadConfirmedBooking(bookingId);
    if (!projection) return this.syncPreviouslyLinkedNonConfirmedBooking(bookingId);
    await this.projections.saveOperationalWindow({
      bookingId, startsAt: projection.reservedStart, endsAt: projection.reservedEnd, source: "app",
    });
    const connection = await this.connections.createOperationalCalendarClient();
    if (!connection) return { state: "not_connected" };

    const rows = renderOperationalCalendarRows(projection);
    let created = 0;
    let updated = 0;
    let reviewCount = 0;

    for (const row of rows) {
      const eventInput = calendarInput(row);
      const appSnapshot = eventSnapshot(eventInput);
      const link = await this.links.findByBookingPackage({
        connectionId: connection.connectionId,
        calendarId: connection.calendarId,
        bookingId,
        packageKey: row.packageKey,
      });
      try {
        if (!link) {
          const googleEvent = await connection.client.createEvent(connection.calendarId, eventInput);
          await this.links.saveSuccessfulSync({
            connectionId: connection.connectionId, calendarId: connection.calendarId,
            googleEventId: googleEvent.id, bookingId, packageKey: row.packageKey,
            etag: googleEvent.etag, sourceChecksum: checksum(eventSnapshot(googleEvent)),
            lastAppSnapshot: appSnapshot, reservedStartsAt: row.reservedStart,
            reservedEndsAt: row.reservedEnd, syncedAt: this.now(),
          });
          created += 1;
          continue;
        }
        const googleEvent = await connection.client.updateEvent({
          calendarId: connection.calendarId, eventId: link.googleEventId,
          event: eventInput, etag: link.etag,
        });
        await this.links.saveSuccessfulSync({
          connectionId: connection.connectionId, calendarId: connection.calendarId,
          googleEventId: googleEvent.id, bookingId, packageKey: row.packageKey,
          etag: googleEvent.etag, sourceChecksum: checksum(eventSnapshot(googleEvent)),
          lastAppSnapshot: appSnapshot, reservedStartsAt: row.reservedStart,
          reservedEndsAt: row.reservedEnd, syncedAt: this.now(),
        });
        updated += 1;
      } catch (error) {
        const handled = await this.handleLinkedWriteError({ error, link, connection, bookingId, appSnapshot });
        if (handled) { reviewCount += 1; continue; }
        throw error;
      }
    }

    return reviewCount
      ? { state: "review_required", created, updated, reviewCount }
      : { state: "synced", created, updated };
  }

  private async syncPreviouslyLinkedNonConfirmedBooking(bookingId: string): Promise<OperationalCalendarSyncResult> {
    if (!this.projections.loadBookingState || !this.links.listByBooking) return { state: "not_confirmed_or_incomplete" };
    const state = await this.projections.loadBookingState(bookingId);
    if (!state || state.status === "confirmed") return { state: "not_confirmed_or_incomplete" };
    const connection = await this.connections.createOperationalCalendarClient();
    if (!connection) return { state: "not_connected" };
    const links = await this.links.listByBooking({
      connectionId: connection.connectionId, calendarId: connection.calendarId, bookingId,
    });
    if (!links.length) return { state: "not_confirmed_or_incomplete" };

    let updated = 0;
    let reviewCount = 0;
    for (const link of links) {
      const current = await connection.client.getEvent(connection.calendarId, link.googleEventId).catch(() => null);
      if (!current) {
        await this.links.createReview({
          connectionId: connection.connectionId, linkId: link.id, bookingId,
          calendarId: connection.calendarId, googleEventId: link.googleEventId,
          reason: "Linked calendar event is missing", proposedChanges: { appStatus: state.status },
        });
        reviewCount += 1;
        continue;
      }
      const eventInput: OperationalCalendarEventInput = {
        summary: withStatusPrefix(current.summary, state.status),
        description: current.description,
        startDate: current.startDate,
        endDateExclusive: current.endDateExclusive,
      };
      const appSnapshot = { ...eventSnapshot(eventInput), appStatus: state.status };
      try {
        const googleEvent = await connection.client.updateEvent({
          calendarId: connection.calendarId, eventId: link.googleEventId,
          event: eventInput, etag: link.etag,
        });
        await this.links.saveSuccessfulSync({
          connectionId: connection.connectionId, calendarId: connection.calendarId,
          googleEventId: googleEvent.id, bookingId, packageKey: link.packageKey,
          etag: googleEvent.etag, sourceChecksum: checksum(eventSnapshot(googleEvent)),
          lastAppSnapshot: appSnapshot, reservedStartsAt: link.reservedStartsAt,
          reservedEndsAt: link.reservedEndsAt, syncedAt: this.now(),
        });
        updated += 1;
      } catch (error) {
        const handled = await this.handleLinkedWriteError({ error, link, connection, bookingId, appSnapshot });
        if (handled) { reviewCount += 1; continue; }
        throw error;
      }
    }
    return reviewCount
      ? { state: "review_required", created: 0, updated, reviewCount }
      : { state: "synced", created: 0, updated };
  }

  private async handleLinkedWriteError(input: {
    error: unknown;
    link: OperationalCalendarLink | null;
    connection: { connectionId: string; calendarId: string; client: OperationalCalendarClient };
    bookingId: string;
    appSnapshot: Record<string, unknown>;
  }): Promise<boolean> {
    const code = errorCode(input.error);
    if (code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED") {
      await this.connections.markReauthorizationRequired?.(code, "operational_calendar");
      return false;
    }
    if (input.link && (code === "GOOGLE_OPERATIONAL_CALENDAR_CONFLICT" || code === "GOOGLE_OPERATIONAL_CALENDAR_EVENT_MISSING")) {
      const current = await input.connection.client.getEvent(input.connection.calendarId, input.link.googleEventId).catch(() => null);
      await this.links.createReview({
        connectionId: input.connection.connectionId, linkId: input.link.id, bookingId: input.bookingId,
        calendarId: input.connection.calendarId, googleEventId: input.link.googleEventId,
        reason: code === "GOOGLE_OPERATIONAL_CALENDAR_CONFLICT" ? "Calendar change detected" : "Linked calendar event is missing",
        proposedChanges: { app: input.appSnapshot, google: current ? eventSnapshot(current) : null, previousApp: input.link.lastAppSnapshot },
      });
      await this.links.recordSyncError({ linkId: input.link.id, errorCode: code, now: this.now() });
      return true;
    }
    if (input.link) await this.links.recordSyncError({ linkId: input.link.id, errorCode: code, now: this.now() });
    return false;
  }
}
