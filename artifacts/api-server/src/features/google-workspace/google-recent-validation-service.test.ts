import { describe, expect, it, vi } from "vitest";

import { GoogleRecentValidationService } from "./google-recent-validation-service";
import type { GoogleWorkspaceReadClient } from "./google-api-types";

const message = (id: string, from: string, subject: string, labelIds: string[]) => ({
  id,
  threadId: `thread-${id}`,
  labelIds,
  internalDateMs: 1787510000000,
  snippet: subject,
  headers: { from, to: "zone@example.com", cc: "", subject, date: "" },
  hasAttachments: false,
});

function validationRepository(
  upsertRows = vi.fn(async () => undefined),
  upsertReviewItems = vi.fn(async () => undefined),
) {
  return {
    upsertRows,
    upsertReviewItems,
    getStatus: vi.fn(async () => "ready_for_review" as const),
  };
}

describe("GoogleRecentValidationService", () => {
  it("resolves an exact contact match onward to its one active organization profile and persists the mapping", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: vi.fn(async () => [
        { id: "m1", threadId: "thread-m1" },
      ]),
      getMessageMetadata: vi.fn(async (id) =>
        message(id, "booking@fair.org", "Hello", ["INBOX"]),
      ),
    };
    const upsertRows = vi.fn(async () => undefined);

    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: {
        load: async () => ({
          contacts: [{ id: "c1", name: "Fair Office", emails: ["booking@fair.org"] }],
          organizations: [],
          profiles: [],
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "c1",
          status: "resolved" as const,
          organization: { id: "org-1", name: "County Fair" },
          candidates: [{ id: "org-1", name: "County Fair" }],
        }),
      },
      validationRepository: validationRepository(upsertRows),
    });

    const result = await service.run(100);

    expect(result.validationStatus).toBe("ready_for_review");
    expect(result.counts).toEqual({ discovered: 1, matched: 1, needsReview: 0, ignored: 0 });
    expect(result.matched[0]).toMatchObject({
      id: "m1",
      matchedContact: { id: "c1", name: "Fair Office" },
      resolvedOrganization: { id: "org-1", name: "County Fair" },
      evidenceCodes: ["exact_contact_email", "contact_active_organization"],
    });
    expect(upsertRows).toHaveBeenCalledWith([
      {
        messageId: "m1",
        threadId: "thread-m1",
        organizationId: "org-1",
        contactId: "c1",
        evidenceCodes: ["exact_contact_email", "contact_active_organization"],
      },
    ]);
  });

  it("moves an exact contact match to review when the contact belongs to multiple active profiles and persists the review item", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: async () => [{ id: "m1", threadId: "thread-m1" }],
      getMessageMetadata: async (id) => message(id, "booking@fair.org", "Hello", ["INBOX"]),
    };
    const upsertReviewItems = vi.fn(async () => undefined);

    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: {
        load: async () => ({
          contacts: [{ id: "c1", name: "Fair Office", emails: ["booking@fair.org"] }],
          organizations: [],
          profiles: [],
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "c1",
          status: "ambiguous" as const,
          organization: null,
          candidates: [
            { id: "org-1", name: "County Fair" },
            { id: "org-2", name: "Summer Festival" },
          ],
        }),
      },
      validationRepository: validationRepository(vi.fn(async () => undefined), upsertReviewItems),
    });

    const result = await service.run(100);

    expect(result.counts).toEqual({ discovered: 1, matched: 0, needsReview: 1, ignored: 0 });
    expect(result.needsReview[0]).toMatchObject({
      matchedContact: { id: "c1", name: "Fair Office" },
      resolvedOrganization: null,
      organizationCandidates: [
        { id: "org-1", name: "County Fair" },
        { id: "org-2", name: "Summer Festival" },
      ],
      evidenceCodes: ["exact_contact_email", "contact_organization_ambiguous"],
    });
    expect(upsertReviewItems).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId: "m1",
        threadId: "thread-m1",
        candidates: [
          { id: "org-1", name: "County Fair" },
          { id: "org-2", name: "Summer Festival" },
        ],
      }),
    ]);
  });

  it("checks at most 100 newest messages and separates profile-name review and ignored metadata without body storage", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: vi.fn(async () => [
        { id: "m2", threadId: "thread-m2" },
        { id: "m3", threadId: "thread-m3" },
      ]),
      getMessageMetadata: vi.fn(async (id) => {
        if (id === "m2") return message(id, "random@gmail.com", "Known Festival vendor info", ["INBOX"]);
        return message(id, "friend@gmail.com", "Dinner plans", ["INBOX"]);
      }),
    };

    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: {
        getSaved: async () => ({
          labels: [{ id: "Label_Shows", name: "Shows", rootId: "Label_Shows", rootName: "Shows" }],
          calendars: [],
        }),
      },
      evidence: {
        load: async () => ({
          contacts: [],
          organizations: [],
          profiles: [{ id: "p1", name: "Known Festival" }],
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "unused",
          status: "unresolved" as const,
          organization: null,
          candidates: [],
        }),
      },
      validationRepository: validationRepository(),
    });

    const result = await service.run(100);

    expect(client.listRecentMessageRefs).toHaveBeenCalledWith(100);
    expect(result.counts).toEqual({ discovered: 2, matched: 0, needsReview: 1, ignored: 1 });
    expect(result.needsReview[0]).toMatchObject({ id: "m2", evidenceCodes: ["exact_profile_name_text"] });
    expect(result.ignored[0]).toMatchObject({ id: "m3", subject: "Dinner plans" });
    expect(JSON.stringify(result)).not.toContain("body");
  });

  it("fails closed when the connected Google client does not support Gmail metadata validation", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
    };
    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: { load: async () => ({ contacts: [], organizations: [], profiles: [] }) },
      contactProfileResolver: {
        resolve: async () => ({
          contactId: "unused",
          status: "unresolved" as const,
          organization: null,
          candidates: [],
        }),
      },
      validationRepository: validationRepository(),
    });

    await expect(service.run(100)).rejects.toThrow("GOOGLE_WORKSPACE_VALIDATION_UNAVAILABLE");
  });
});
