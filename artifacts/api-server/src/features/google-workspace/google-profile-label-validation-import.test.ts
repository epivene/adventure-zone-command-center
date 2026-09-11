import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import {
  GoogleProfileLabelValidationImportService,
  profileLabelImportIsExcluded,
} from "./google-profile-label-validation-import";

function client(): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
    listLabels: async () => [
      { id: "Label_1320", name: "Profiles/4th of July Events (Clearfield) UT", type: "user" },
    ],
    listCalendars: async () => [],
    listMessagePage: async () => ({
      messages: [
        { id: "message-1", threadId: "thread-1" },
        { id: "message-2", threadId: "thread-1" },
      ],
      nextPageToken: null,
    }),
  };
}

describe("GoogleProfileLabelValidationImportService", () => {
  it("imports exact profile-label messages into approved CRM mappings", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const upsertRows = vi.fn(async (input) => {
      rows.splice(0, rows.length, ...input);
    });
    const service = new GoogleProfileLabelValidationImportService({
      connections: {
        getCurrent: async () => ({ id: "connection-1" }),
        createReadClient: async () => client(),
      },
      labels: {
        getOrganization: async () => ({
          id: "org-1",
          name: "4th of July Events (Clearfield) UT",
          consolidatedIntoId: null,
        }),
        findByOrganization: async () => null,
        findByLabelId: async () => null,
        adopt: vi.fn(async (input) => ({
          ...input,
          state: "active" as const,
          lastErrorCode: null,
        })),
        markState: vi.fn(async () => undefined),
        listManagedLabelIds: async () => [],
      },
      validation: {
        listApprovedForOrganization: async () => rows as never,
        upsertRows,
      },
    });

    const result = await service.reconcileOrganization("org-1");

    expect(upsertRows).toHaveBeenCalledWith([
      {
        messageId: "message-1",
        threadId: "thread-1",
        organizationId: "org-1",
        contactId: null,
        evidenceCodes: ["gmail_profile_label"],
      },
      {
        messageId: "message-2",
        threadId: "thread-1",
        organizationId: "org-1",
        contactId: null,
        evidenceCodes: ["gmail_profile_label"],
      },
    ]);
    expect(result).toHaveLength(2);
  });

  it.each(["ASSOC - RMFA", "RMAF 2026", "Spacs Storage", "Spacks Storage"])(
    "keeps excluded profile %s out of automatic assignment",
    (name) => {
      expect(profileLabelImportIsExcluded(name)).toBe(true);
    },
  );

  it("does not fuzzy-match a different profile label", async () => {
    const upsertRows = vi.fn(async () => undefined);
    const gmail = client();
    gmail.listLabels = async () => [
      { id: "Label_other", name: "Profiles/Clearfield City Events", type: "user" },
    ];
    const service = new GoogleProfileLabelValidationImportService({
      connections: {
        getCurrent: async () => ({ id: "connection-1" }),
        createReadClient: async () => gmail,
      },
      labels: {
        getOrganization: async () => ({
          id: "org-1",
          name: "4th of July Events (Clearfield) UT",
          consolidatedIntoId: null,
        }),
        findByOrganization: async () => null,
        findByLabelId: async () => null,
        adopt: vi.fn(),
        markState: vi.fn(),
        listManagedLabelIds: async () => [],
      },
      validation: {
        listApprovedForOrganization: async () => [],
        upsertRows,
      },
    });

    await expect(service.reconcileOrganization("org-1")).resolves.toEqual([]);
    expect(upsertRows).not.toHaveBeenCalled();
  });
});
