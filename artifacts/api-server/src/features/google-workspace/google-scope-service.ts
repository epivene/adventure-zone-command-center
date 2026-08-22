import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import type {
  GoogleCalendarSummary,
  GoogleLabelSummary,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
import { PostgresGoogleScopePersistence } from "./google-scope-repository";
import type {
  GoogleSavedScope,
  GoogleScopeActorKind,
  GoogleScopeCalendar,
  GoogleScopeLabel,
  GoogleScopePersistence,
} from "./google-scope-types";

export const APPROVED_GMAIL_ROOTS = [
  "Shows",
  "Receipts",
  "Off Season Business Opportunities",
  "Employees",
  "Associations",
] as const;

export const APPROVED_CALENDAR_NAMES = [
  "Adventure Zone Calendar",
  "Pirates Rebellion Calendar",
  "Warriors Playground Calendar",
] as const;

export const APPROVED_CALENDAR_EMAIL_ID =
  "zone.pirate.warrior@gmail.com" as const;

export type GoogleScopePreview = {
  labels: GoogleScopeLabel[];
  calendars: GoogleScopeCalendar[];
  missingLabelRoots: string[];
  missingCalendars: string[];
  excludedLabelCount: number;
  excludedCalendarCount: number;
};

type GoogleScopeConnectionAccess = {
  getCurrent(): Promise<{
    id: string;
    status: "connected" | "reauthorization_required" | "disconnected";
  } | null>;
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function buildGoogleScopePreview(
  labels: GoogleLabelSummary[],
  calendars: GoogleCalendarSummary[],
): GoogleScopePreview {
  const approvedLabels: GoogleScopeLabel[] = [];
  const missingLabelRoots: string[] = [];

  for (const expectedRoot of APPROVED_GMAIL_ROOTS) {
    const expected = normalized(expectedRoot);
    const root = labels.find(
      (label) => label.type === "user" && normalized(label.name) === expected,
    );
    if (!root) {
      missingLabelRoots.push(expectedRoot);
      continue;
    }

    for (const label of labels) {
      const name = normalized(label.name);
      if (
        label.type === "user" &&
        (name === expected || name.startsWith(`${expected}/`))
      ) {
        approvedLabels.push({
          id: label.id,
          name: label.name,
          rootId: root.id,
          rootName: root.name,
        });
      }
    }
  }

  const deduplicatedLabels = approvedLabels.filter(
    (label, index, all) => all.findIndex((item) => item.id === label.id) === index,
  );

  const approvedCalendars: GoogleScopeCalendar[] = [];
  const missingCalendars: string[] = [];
  for (const expectedSummary of APPROVED_CALENDAR_NAMES) {
    const calendar = calendars.find(
      (candidate) => normalized(candidate.summary) === normalized(expectedSummary),
    );
    if (!calendar) {
      missingCalendars.push(expectedSummary);
      continue;
    }
    approvedCalendars.push(calendar);
  }

  const emailCalendar = calendars.find(
    (calendar) => normalized(calendar.id) === normalized(APPROVED_CALENDAR_EMAIL_ID),
  );
  if (emailCalendar) {
    approvedCalendars.push(emailCalendar);
  } else {
    missingCalendars.push(APPROVED_CALENDAR_EMAIL_ID);
  }

  const deduplicatedCalendars = approvedCalendars.filter(
    (calendar, index, all) =>
      all.findIndex((item) => item.id === calendar.id) === index,
  );

  return {
    labels: deduplicatedLabels,
    calendars: deduplicatedCalendars,
    missingLabelRoots,
    missingCalendars,
    excludedLabelCount: Math.max(0, labels.length - deduplicatedLabels.length),
    excludedCalendarCount: Math.max(
      0,
      calendars.length - deduplicatedCalendars.length,
    ),
  };
}

export class GoogleScopeService {
  private readonly connection: GoogleScopeConnectionAccess;
  private readonly persistence: GoogleScopePersistence;

  constructor(options?: {
    connection?: GoogleScopeConnectionAccess;
    persistence?: GoogleScopePersistence;
  }) {
    this.connection = options?.connection ?? new PostgresGoogleConnectionRepository();
    this.persistence = options?.persistence ?? new PostgresGoogleScopePersistence();
  }

  async preview(): Promise<GoogleScopePreview> {
    const connection = await this.connection.getCurrent();
    const client = await this.connection.createReadClient();
    if (!connection || !client) {
      throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    }

    const [labels, calendars] = await Promise.all([
      client.listLabels(),
      client.listCalendars(),
    ]);
    return buildGoogleScopePreview(labels, calendars);
  }

  async getSaved(): Promise<GoogleSavedScope> {
    const connection = await this.connection.getCurrent();
    if (!connection) return { labels: [], calendars: [] };
    return this.persistence.get(connection.id);
  }

  async save(input: {
    labelIds: string[];
    calendarIds: string[];
    actorKind: GoogleScopeActorKind;
    actorId: string;
    now: Date;
  }): Promise<GoogleSavedScope> {
    if (!Number.isFinite(input.now.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_SCOPE_INPUT_INVALID");
    }
    const connection = await this.connection.getCurrent();
    if (!connection) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    const preview = await this.preview();
    const selectedLabelIds = new Set(input.labelIds);
    const selectedCalendarIds = new Set(input.calendarIds);
    const allowedLabelIds = new Set(preview.labels.map((label) => label.id));
    const allowedCalendarIds = new Set(
      preview.calendars.map((calendar) => calendar.id),
    );

    if (
      [...selectedLabelIds].some((id) => !allowedLabelIds.has(id)) ||
      [...selectedCalendarIds].some((id) => !allowedCalendarIds.has(id))
    ) {
      throw new Error("GOOGLE_WORKSPACE_SCOPE_SELECTION_INVALID");
    }

    const saved = {
      labels: preview.labels.filter((label) => selectedLabelIds.has(label.id)),
      calendars: preview.calendars.filter((calendar) =>
        selectedCalendarIds.has(calendar.id),
      ),
    };
    await this.persistence.replace({
      connectionId: connection.id,
      ...saved,
      actorKind: input.actorKind,
      actorId: input.actorId,
      now: input.now,
    });
    return saved;
  }
}

export type {
  GoogleSavedScope,
  GoogleScopeCalendar,
  GoogleScopeLabel,
  GoogleScopePersistence,
} from "./google-scope-types";
