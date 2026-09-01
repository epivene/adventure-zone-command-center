import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import {
  GoogleScopeService,
  buildGoogleScopePreview,
  type GoogleScopePersistence,
} from "./google-scope-service";

const labels = [
  { id: "shows", name: "Shows", type: "user" as const },
  { id: "shows-2026", name: "Shows/2026", type: "user" as const },
  { id: "shows-west", name: "Shows/West", type: "user" as const },
  { id: "receipt", name: "Receipt", type: "user" as const },
  { id: "off-season", name: "Off Season Business Opportunities", type: "user" as const },
  { id: "employees", name: "Employees", type: "user" as const },
  { id: "associations", name: "Associations", type: "user" as const },
  { id: "SPAM", name: "SPAM", type: "system" as const },
  { id: "personal", name: "Personal/Family", type: "user" as const },
  { id: "almost", name: "Show", type: "user" as const },
];

const calendars = [
  { id: "az", summary: "Adventure Zone Calendar", primary: false },
  { id: "pirates", summary: "Pirate's Rebellion Calendar", primary: false },
  { id: "warriors", summary: "Warrior's Playground Calendar", primary: false },
  {
    id: "zone.pirate.warrior@gmail.com",
    summary: "A differently named fourth calendar",
    primary: true,
  },
  { id: "personal-calendar", summary: "Family", primary: false },
];

function workspaceClient(options?: {
  labels?: typeof labels;
  calendars?: typeof calendars;
  listLabels?: GoogleWorkspaceReadClient["listLabels"];
}): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
    listLabels: options?.listLabels ?? (async () => options?.labels ?? labels),
    listCalendars: async () => options?.calendars ?? calendars,
  };
}

describe("buildGoogleScopePreview", () => {
  it("selects the current profile and archived event label trees used by the live mailbox", () => {
    const mailboxLabels = [
      { id: "profiles", name: "Z - AdventureZone/Profiles", type: "user" as const },
      { id: "soda", name: "Z - AdventureZone/Profiles/Soda Springs Fall Festival - Soda Springs ID", type: "user" as const },
      { id: "archive-shows", name: "ZZ - Amy Archive/SHOWS", type: "user" as const },
      { id: "caribou", name: "ZZ - Amy Archive/SHOWS/Caribou County Fair - Grace ID", type: "user" as const },
      { id: "archive-leads", name: "ZZ - Amy Archive/Potential shows", type: "user" as const },
      { id: "future-fair", name: "ZZ - Amy Archive/Potential shows/Future County Fair", type: "user" as const },
      { id: "personal", name: "PERSONAL/Flowers & Chocolate", type: "user" as const },
    ];

    const preview = buildGoogleScopePreview(mailboxLabels, calendars);

    expect(preview.labels.map((label) => label.id)).toEqual([
      "profiles",
      "soda",
      "archive-shows",
      "caribou",
      "archive-leads",
      "future-fair",
    ]);
    expect(preview.missingLabelRoots).toEqual([]);
    expect(preview.labels.find((label) => label.id === "soda")).toMatchObject({
      rootId: "profiles",
      rootName: "Z - AdventureZone/Profiles",
    });
    expect(preview.labels.some((label) => label.id === "personal")).toBe(false);
  });

  it("selects exact Gmail business roots and descendants while excluding Receipt, Spam, and personal labels", () => {
    const preview = buildGoogleScopePreview(labels, calendars);

    expect(preview.labels.map((label) => label.id)).toEqual([
      "shows",
      "shows-2026",
      "shows-west",
      "off-season",
      "employees",
      "associations",
    ]);
    expect(preview.labels.find((label) => label.id === "shows-2026")).toEqual({
      id: "shows-2026",
      name: "Shows/2026",
      rootId: "shows",
      rootName: "Shows",
    });
    expect(preview.labels.some((label) => label.id === "receipt")).toBe(false);
    expect(preview.labels.some((label) => label.id === "SPAM")).toBe(false);
    expect(preview.labels.some((label) => label.id === "personal")).toBe(false);
    expect(preview.labels.some((label) => label.id === "almost")).toBe(false);
    expect(preview.excludedLabelCount).toBe(4);
    expect(preview.missingLabelRoots).toEqual([]);
  });

  it("selects the three named calendars and the fourth calendar by email ID", () => {
    const preview = buildGoogleScopePreview(labels, calendars);

    expect(preview.calendars.map((calendar) => calendar.id)).toEqual([
      "az",
      "pirates",
      "warriors",
      "zone.pirate.warrior@gmail.com",
    ]);
    expect(preview.calendars[3]?.summary).toBe(
      "A differently named fourth calendar",
    );
    expect(preview.excludedCalendarCount).toBe(1);
    expect(preview.missingCalendars).toEqual([]);
  });

  it("reports missing event scope instead of guessing a similar label", () => {
    const preview = buildGoogleScopePreview(
      labels.filter((label) => !["Shows", "Shows/2026", "Shows/West", "Off Season Business Opportunities"].includes(label.name)),
      calendars,
    );

    expect(preview.missingLabelRoots).toEqual(["Adventure Zone profile or event labels"]);
  });

  it("reports an ambiguous named calendar instead of selecting the first match", () => {
    const preview = buildGoogleScopePreview(labels, [
      ...calendars,
      {
        id: "az-copy",
        summary: "Adventure Zone Calendar",
        primary: false,
      },
    ]);

    expect(preview.missingCalendars).toContain("Adventure Zone Calendar");
    expect(preview.calendars.some((calendar) => calendar.id === "az")).toBe(false);
    expect(preview.calendars.some((calendar) => calendar.id === "az-copy")).toBe(false);
  });
});

describe("GoogleScopeService", () => {
  it("persists the complete exact approved preview", async () => {
    const replace = vi.fn(async () => undefined);
    const persistence: GoogleScopePersistence = {
      get: vi.fn(async () => ({ labels: [], calendars: [] })),
      replace,
    };
    const client = workspaceClient();
    const service = new GoogleScopeService({
      connection: {
        getCurrent: async () => ({
          id: "connection-id",
          email: "zone@example.com",
          status: "connected",
          grantedScopes: [],
          connectedAt: "2026-08-22T18:00:00.000Z",
          lastVerifiedAt: null,
          lastErrorCode: null,
        }),
        createReadClient: async () => client,
        markReauthorizationRequired: async () => undefined,
      },
      persistence,
    });
    const preview = buildGoogleScopePreview(labels, calendars);

    await service.save({
      labelIds: preview.labels.map((label) => label.id),
      calendarIds: preview.calendars.map((calendar) => calendar.id),
      actorKind: "owner",
      actorId: "owner",
      now: new Date("2026-08-22T18:30:00.000Z"),
    });

    expect(replace).toHaveBeenCalledWith({
      connectionId: "connection-id",
      labels: preview.labels,
      calendars: preview.calendars,
      actorKind: "owner",
      actorId: "owner",
      now: new Date("2026-08-22T18:30:00.000Z"),
    });
  });

  it("rejects an ID outside the approved business preview", async () => {
    const client = workspaceClient();
    const service = new GoogleScopeService({
      connection: {
        getCurrent: async () => ({
          id: "connection-id",
          email: "zone@example.com",
          status: "connected",
          grantedScopes: [],
          connectedAt: "2026-08-22T18:00:00.000Z",
          lastVerifiedAt: null,
          lastErrorCode: null,
        }),
        createReadClient: async () => client,
        markReauthorizationRequired: async () => undefined,
      },
      persistence: {
        get: async () => ({ labels: [], calendars: [] }),
        replace: vi.fn(async () => undefined),
      },
    });

    await expect(
      service.save({
        labelIds: ["receipt"],
        calendarIds: ["az"],
        actorKind: "owner",
        actorId: "owner",
        now: new Date(),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_SCOPE_SELECTION_INVALID");
  });

  it("refuses to save while an expected business source is missing", async () => {
    const replace = vi.fn(async () => undefined);
    const client = workspaceClient({ labels: [] });
    const service = new GoogleScopeService({
      connection: {
        getCurrent: async () => ({
          id: "connection-id",
          status: "connected",
        }),
        createReadClient: async () => client,
        markReauthorizationRequired: async () => undefined,
      },
      persistence: {
        get: async () => ({ labels: [], calendars: [] }),
        replace,
      },
    });

    await expect(
      service.save({
        labelIds: ["shows"],
        calendarIds: ["az"],
        actorKind: "owner",
        actorId: "owner",
        now: new Date("2026-08-22T18:30:00.000Z"),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_SCOPE_INCOMPLETE");
    expect(replace).not.toHaveBeenCalled();
  });

  it("marks the connection for reauthorization when Google revokes access", async () => {
    const markReauthorizationRequired = vi.fn(async () => undefined);
    const client = workspaceClient({
      listLabels: async () => {
        throw Object.assign(new Error("revoked"), {
          code: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
        });
      },
    });
    const service = new GoogleScopeService({
      connection: {
        getCurrent: async () => ({
          id: "connection-id",
          status: "connected",
        }),
        createReadClient: async () => client,
        markReauthorizationRequired,
      },
      persistence: {
        get: async () => ({ labels: [], calendars: [] }),
        replace: async () => undefined,
      },
    });

    await expect(service.preview()).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    });
    expect(markReauthorizationRequired).toHaveBeenCalledWith(
      "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    );
  });
});
