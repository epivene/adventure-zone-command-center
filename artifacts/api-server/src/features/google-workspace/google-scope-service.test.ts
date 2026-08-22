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
  { id: "receipts", name: "Receipts", type: "user" as const },
  { id: "off-season", name: "Off Season Business Opportunities", type: "user" as const },
  { id: "employees", name: "Employees", type: "user" as const },
  { id: "associations", name: "Associations", type: "user" as const },
  { id: "personal", name: "Personal/Family", type: "user" as const },
  { id: "almost", name: "Show", type: "user" as const },
];

const calendars = [
  { id: "az", summary: "Adventure Zone Calendar", primary: false },
  { id: "pirates", summary: "Pirates Rebellion Calendar", primary: false },
  { id: "warriors", summary: "Warriors Playground Calendar", primary: false },
  {
    id: "zone.pirate.warrior@gmail.com",
    summary: "A differently named fourth calendar",
    primary: true,
  },
  { id: "personal-calendar", summary: "Family", primary: false },
];

describe("buildGoogleScopePreview", () => {
  it("selects exact Gmail roots and every descendant while excluding personal labels", () => {
    const preview = buildGoogleScopePreview(labels, calendars);

    expect(preview.labels.map((label) => label.id)).toEqual([
      "shows",
      "shows-2026",
      "shows-west",
      "receipts",
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
    expect(preview.labels.some((label) => label.id === "personal")).toBe(false);
    expect(preview.labels.some((label) => label.id === "almost")).toBe(false);
    expect(preview.excludedLabelCount).toBe(2);
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

  it("reports a missing expected root instead of guessing a similar label", () => {
    const preview = buildGoogleScopePreview(
      labels.filter((label) => label.name !== "Associations"),
      calendars,
    );

    expect(preview.missingLabelRoots).toEqual(["Associations"]);
  });
});

describe("GoogleScopeService", () => {
  it("persists only IDs that were present in the exact preview", async () => {
    const replace = vi.fn(async () => undefined);
    const persistence: GoogleScopePersistence = {
      get: vi.fn(async () => ({ labels: [], calendars: [] })),
      replace,
    };
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => labels,
      listCalendars: async () => calendars,
    };
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
      },
      persistence,
    });

    await service.save({
      labelIds: ["shows", "shows-2026", "receipts"],
      calendarIds: ["az", "zone.pirate.warrior@gmail.com"],
      actorKind: "owner",
      actorId: "owner",
      now: new Date("2026-08-22T18:30:00.000Z"),
    });

    expect(replace).toHaveBeenCalledWith({
      connectionId: "connection-id",
      labels: expect.arrayContaining([
        {
          id: "shows",
          name: "Shows",
          rootId: "shows",
          rootName: "Shows",
        },
        {
          id: "shows-2026",
          name: "Shows/2026",
          rootId: "shows",
          rootName: "Shows",
        },
      ]),
      calendars: expect.arrayContaining([
        { id: "az", summary: "Adventure Zone Calendar", primary: false },
        {
          id: "zone.pirate.warrior@gmail.com",
          summary: "A differently named fourth calendar",
          primary: true,
        },
      ]),
      actorKind: "owner",
      actorId: "owner",
      now: new Date("2026-08-22T18:30:00.000Z"),
    });
  });

  it("rejects an ID outside the approved business preview", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => labels,
      listCalendars: async () => calendars,
    };
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
      },
      persistence: {
        get: async () => ({ labels: [], calendars: [] }),
        replace: vi.fn(async () => undefined),
      },
    });

    await expect(
      service.save({
        labelIds: ["personal"],
        calendarIds: ["az"],
        actorKind: "owner",
        actorId: "owner",
        now: new Date(),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_SCOPE_SELECTION_INVALID");
  });
});
