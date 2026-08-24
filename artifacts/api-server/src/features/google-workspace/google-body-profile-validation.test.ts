import { describe, expect, it, vi } from "vitest";

import { GoogleRecentValidationService } from "./google-recent-validation-service";
import type { GoogleWorkspaceReadClient } from "./google-api-types";

describe("GoogleRecentValidationService body evidence", () => {
  it("promotes an otherwise unresolved email when the readable thread body uniquely names a profile without returning the body", async () => {
    const client: GoogleWorkspaceReadClient = {
      authorizationUrl: () => "",
      exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
      accountIdentity: async () => ({ subject: null, email: "theadventurezone12@gmail.com" }),
      listLabels: async () => [],
      listCalendars: async () => [],
      listRecentMessageRefs: async () => [{ id: "m1", threadId: "t1" }],
      getMessageMetadata: async () => ({
        id: "m1",
        threadId: "t1",
        labelIds: ["INBOX"],
        internalDateMs: 1,
        snippet: "Please see details below",
        headers: {
          from: "organizer@gmail.com",
          to: "theadventurezone12@gmail.com",
          cc: "",
          subject: "Re: vendor information",
          date: "",
        },
        hasAttachments: false,
      }),
      getThreadDetail: vi.fn(async () => ({
        id: "t1",
        subject: "Re: vendor information",
        originalGmailUrl: "https://mail.google.com/mail/u/0/#all/t1",
        messages: [{
          id: "m1",
          internalDateMs: 1,
          from: "organizer@gmail.com",
          to: "theadventurezone12@gmail.com",
          cc: "",
          subject: "Re: vendor information",
          date: "",
          direction: "incoming" as const,
          bodyText: "We would like Adventure Zone back at Logan Pride Festival this September.",
          attachments: [],
        }],
      })),
    };
    const upsertRows = vi.fn(async () => undefined);

    const service = new GoogleRecentValidationService({
      connection: { createReadClient: async () => client },
      scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
      evidence: {
        load: async () => ({
          contacts: [],
          organizations: [],
          profiles: [
            { id: "logan-pride", name: "Logan Pride Festival (Logan) UT" },
            { id: "adventure-zone", name: "Adventure Zone, The (Logan) UT" },
          ],
        }),
      },
      contactProfileResolver: {
        resolve: async () => ({ contactId: "unused", status: "unresolved" as const, organization: null, candidates: [] }),
      },
      validationRepository: {
        upsertRows,
        upsertReviewItems: async () => undefined,
        getStatus: async () => "ready_for_review" as const,
      },
    });

    const result = await service.run(100);

    expect(result.counts).toEqual({ discovered: 1, matched: 1, needsReview: 0, ignored: 0 });
    expect(result.matched[0]).toMatchObject({
      resolvedOrganization: { id: "logan-pride", name: "Logan Pride Festival (Logan) UT" },
      evidenceCodes: ["exact_profile_name_body"],
    });
    expect(upsertRows).toHaveBeenCalledWith([
      expect.objectContaining({ organizationId: "logan-pride" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("We would like Adventure Zone back");
  });
});
