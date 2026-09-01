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
  "Z - AdventureZone/Profiles",
  "ZZ - Amy Archive/SHOWS",
  "ZZ - Amy Archive/Potential shows",
  "Shows",
  "Off Season Business Opportunities",
  "Employees",
  "Associations",
] as const;

const PROFILE_EVENT_GMAIL_ROOTS = new Set([
  "z - adventurezone/profiles",
  "zz - amy archive/shows",
  "zz - amy archive/potential shows",
  "shows",
  "off season business opportunities",
]);

export const APPROVED_GMAIL_SYSTEM_LABELS = [] as const;

export const APPROVED_CALENDAR_NAMES = [
  "Adventure Zone Calendar",
  "Pirate's Rebellion Calendar",
  "Warrior's Playground Calendar",
] as const;

export const APPROVED_CALENDAR_EMAIL_ID =
  "zone.pirate.warrior@gmail.com" as const;

export type GoogleScopePreview = {
  labels: GoogleScopeLabel[];
  calendars: GoogleScopeCalendar[];
  missingLabelRoots: string[];
  missingCalendars: string[];
  excludedLabels: Array<{
    id: string;
    name: string;
    type: GoogleLabelSummary["type"];
  }>;
  excludedLabelCount: number;
  excludedCalendarCount: number;
};

type GoogleScopeConnectionAccess = {
  getCurrent(): Promise<{
    id: string;
    status: "connected" | "reauthorization_required" | "disconnected";
  } | null>;
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
  markReauthorizationRequired(errorCode: string): Promise<void>;
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function googleErrorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return null;
}

export function buildGoogleScopePreview(
  labels: GoogleLabelSummary[],
  calendars: GoogleCalendarSummary[],
): GoogleScopePreview {
  const approvedLabels: GoogleScopeLabel[] = [];
  const missingLabelRoots: string[] = [];
  let profileEventRootCount = 0;

  for (const expectedRoot of APPROVED_GMAIL_ROOTS) {
    const expected = normalized(expectedRoot);
    const root = labels.find(
      (label) => label.type === "user" && normalized(label.name) === expected,
    );
    if (!root) {
      continue;
    }
    if (PROFILE_EVENT_GMAIL_ROOTS.has(expected)) profileEventRootCount += 1;

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

  if (profileEventRootCount === 0) {
    missingLabelRoots.push("Adventure Zone profile or event labels");
  }

  const deduplicatedLabels = approvedLabels.filter(
    (label, index, all) => all.findIndex((item) => item.id === label.id) === index,
  );
  const approvedLabelIds = new Set(deduplicatedLabels.map((label) => label.id));
  const excludedLabels = labels
    .filter((label) => !approvedLabelIds.has(label.id))
    .map((label) => ({ id: label.id, name: label.name, type: label.type }));

  const approvedCalendars: GoogleScopeCalendar[] = [];
  const missingCalendars: string[] = [];
  const emailCalendarId = normalized(APPROVED_CALENDAR_EMAIL_ID);

  for (const expectedSummary of APPROVED_CALENDAR_NAMES) {
    const matches = calendars.filter(
      (candidate) =>
        normalized(candidate.id) !== emailCalendarId &&
        normalized(candidate.summary) === normalized(expectedSummary),
    );
    if (matches.length !== 1) {
      missingCalendars.push(expectedSummary);
      continue;
    }
    approvedCalendars.push(matches[0]);
  }

  const emailCalendars = calendars.filter(
    (calendar) => normalized(calendar.id) === emailCalendarId,
  );
  if (emailCalendars.length === 1) {
    approvedCalendars.push(emailCalendars[0]);
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
    excludedLabels,
    excludedLabelCount: excludedLabels.length,
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

    try {
      const [labels, calendars] = await Promise.all([
        client.listLabels(),
        client.listCalendars(),
      ]);
      return buildGoogleScopePreview(labels, calendars);
    } catch (error) {
      const code = googleErrorCode(error);
      if (code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED") {
        await this.connection.markReauthorizationRequired(code).catch(() => undefined);
      }
      throw error;
    }
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
    if (
      preview.missingLabelRoots.length > 0 ||
      preview.missingCalendars.length > 0
    ) {
      throw new Error("GOOGLE_WORKSPACE_SCOPE_INCOMPLETE");
    }

    const selectedLabelIds = new Set(input.labelIds);
    const selectedCalendarIds = new Set(input.calendarIds);
    const allowedLabelIds = new Set(preview.labels.map((label) => label.id));
    const allowedCalendarIds = new Set(
      preview.calendars.map((calendar) => calendar.id),
    );
    const requiredLabelIds = new Set(
      preview.labels
        .filter((label) => label.id === label.rootId)
        .map((label) => label.id),
    );

    if (
      [...selectedLabelIds].some((id) => !allowedLabelIds.has(id)) ||
      [...selectedCalendarIds].some((id) => !allowedCalendarIds.has(id))
    ) {
      throw new Error("GOOGLE_WORKSPACE_SCOPE_SELECTION_INVALID");
    }
    if (
      [...requiredLabelIds].some((id) => !selectedLabelIds.has(id)) ||
      selectedCalendarIds.size !== allowedCalendarIds.size ||
      [...allowedCalendarIds].some((id) => !selectedCalendarIds.has(id))
    ) {
      throw new Error("GOOGLE_WORKSPACE_SCOPE_INCOMPLETE");
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
