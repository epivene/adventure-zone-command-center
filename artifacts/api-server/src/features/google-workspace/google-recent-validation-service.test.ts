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

describe("GoogleRecentValidationService", () => {
  it("checks at most 100 newest messages and separates matched, review, and ignored metadata without body storage", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: vi.fn(async () => [
        { id: "m1", threadId: "thread-m1" },
        { id: "m2", threadId: "thread-m2" },
        { id: "m3", threadId: "thread-m3" },
      ]),
      getMessageMetadata: vi.fn(async (id) => {
        if (id === "m1") return message(id, "booking@fair.org", "Hello", ["INBOX"]);
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
          contacts: [{ id: "c1", name: "Fair Office", emails: ["booking@fair.org"] }],
          organizations: [],
          profiles: [{ id: "p1", name: "Known Festival" }],
        }),
      },
    });

    const result = await service.run(100);

    expect(client.listRecentMessageRefs).toHaveBeenCalledWith(100);
    expect(result.counts).toEqual({ discovered: 3, matched: 1, needsReview: 1, ignored: 1 });
    expect(result.matched[0]).toMatchObject({ id: "m1", evidenceCodes: ["exact_contact_email"] });
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
    });

    await expect(service.run(100)).rejects.toThrow("GOOGLE_WORKSPACE_VALIDATION_UNAVAILABLE");
  });
});
