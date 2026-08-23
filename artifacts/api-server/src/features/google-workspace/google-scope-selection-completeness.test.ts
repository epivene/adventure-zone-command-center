import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import {
  GoogleScopeService,
  type GoogleScopePersistence,
} from "./google-scope-service";

const client: GoogleWorkspaceReadClient = {
  authorizationUrl: () => "",
  exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
  accountIdentity: async () => ({ subject: null, email: "company@example.com" }),
  listLabels: async () => [
    { id: "shows", name: "Shows", type: "user" },
    { id: "receipts", name: "Receipts", type: "user" },
    {
      id: "off-season",
      name: "Off Season Business Opportunities",
      type: "user",
    },
    { id: "employees", name: "Employees", type: "user" },
    { id: "associations", name: "Associations", type: "user" },
  ],
  listCalendars: async () => [
    { id: "adventure", summary: "Adventure Zone Calendar", primary: false },
    { id: "pirates", summary: "Pirates Rebellion Calendar", primary: false },
    { id: "warriors", summary: "Warriors Playground Calendar", primary: false },
    {
      id: "zone.pirate.warrior@gmail.com",
      summary: "Zone Pirate Warrior",
      primary: true,
    },
  ],
};

describe("Google Workspace approved scope completeness", () => {
  it("refuses to save when any approved business label or calendar is omitted", async () => {
    const replace = vi.fn(async () => undefined);
    const persistence: GoogleScopePersistence = {
      get: async () => ({ labels: [], calendars: [] }),
      replace,
    };
    const service = new GoogleScopeService({
      connection: {
        getCurrent: async () => ({ id: "connection-id", status: "connected" }),
        createReadClient: async () => client,
        markReauthorizationRequired: async () => undefined,
      },
      persistence,
    });

    await expect(
      service.save({
        labelIds: ["shows", "receipts", "off-season", "employees"],
        calendarIds: [
          "adventure",
          "pirates",
          "warriors",
          "zone.pirate.warrior@gmail.com",
        ],
        actorKind: "owner",
        actorId: "owner",
        now: new Date("2026-08-22T19:00:00.000Z"),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_SCOPE_INCOMPLETE");
    expect(replace).not.toHaveBeenCalled();
  });
});
