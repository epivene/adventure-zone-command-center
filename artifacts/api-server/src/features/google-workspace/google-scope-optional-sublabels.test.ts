import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import {
  GoogleScopeService,
  buildGoogleScopePreview,
  type GoogleScopePersistence,
} from "./google-scope-service";

const client: GoogleWorkspaceReadClient = {
  authorizationUrl: () => "",
  exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
  accountIdentity: async () => ({ subject: null, email: "company@example.com" }),
  listLabels: async () => [
    { id: "shows", name: "Shows", type: "user" },
    { id: "shows-2026", name: "Shows/2026", type: "user" },
    { id: "shows-old", name: "Shows/Old Leads", type: "user" },
    { id: "receipt", name: "Receipt", type: "user" },
    { id: "off-season", name: "Off Season Business Opportunities", type: "user" },
    { id: "employees", name: "Employees", type: "user" },
    { id: "associations", name: "Associations", type: "user" },
    { id: "SPAM", name: "SPAM", type: "system" },
  ],
  listCalendars: async () => [
    { id: "adventure", summary: "Adventure Zone Calendar", primary: false },
    { id: "pirates", summary: "Pirate's Rebellion Calendar", primary: false },
    { id: "warriors", summary: "Warrior's Playground Calendar", primary: false },
    { id: "zone.pirate.warrior@gmail.com", summary: "Zone Pirate Warrior", primary: true },
  ],
};

function serviceWithPersistence(replace = vi.fn(async () => undefined)) {
  const persistence: GoogleScopePersistence = {
    get: async () => ({ labels: [], calendars: [] }),
    replace,
  };
  return {
    replace,
    service: new GoogleScopeService({
      connection: {
        getCurrent: async () => ({ id: "connection-id", status: "connected" }),
        createReadClient: async () => client,
        markReauthorizationRequired: async () => undefined,
      },
      persistence,
    }),
  };
}

describe("Google Workspace optional nested labels", () => {
  it("allows a nested business label to be omitted while keeping every required root and calendar", async () => {
    const { service, replace } = serviceWithPersistence();
    const preview = buildGoogleScopePreview(await client.listLabels(), await client.listCalendars());
    const selectedLabelIds = preview.labels
      .filter((label) => label.id !== "shows-old")
      .map((label) => label.id);

    await expect(
      service.save({
        labelIds: selectedLabelIds,
        calendarIds: preview.calendars.map((calendar) => calendar.id),
        actorKind: "owner",
        actorId: "owner",
        now: new Date("2026-08-23T19:15:00.000Z"),
      }),
    ).resolves.toMatchObject({
      labels: expect.not.arrayContaining([
        expect.objectContaining({ id: "shows-old" }),
      ]),
    });

    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.not.arrayContaining([
          expect.objectContaining({ id: "shows-old" }),
        ]),
      }),
    );
  });

  it("still rejects omitting a required business root", async () => {
    const { service } = serviceWithPersistence();
    const preview = buildGoogleScopePreview(await client.listLabels(), await client.listCalendars());

    await expect(
      service.save({
        labelIds: preview.labels
          .filter((label) => label.id !== "shows")
          .map((label) => label.id),
        calendarIds: preview.calendars.map((calendar) => calendar.id),
        actorKind: "owner",
        actorId: "owner",
        now: new Date("2026-08-23T19:15:00.000Z"),
      }),
    ).rejects.toThrow("GOOGLE_WORKSPACE_SCOPE_INCOMPLETE");
  });
});
