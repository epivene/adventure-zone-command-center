import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import { GoogleRecentValidationService } from "./google-recent-validation-service";

function client(messages: Record<string, ReturnType<typeof message>>): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "TheAdventureZone12@gmail.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    listRecentMessageRefs: async () =>
      Object.values(messages).map((item) => ({ id: item.id, threadId: item.threadId })),
    getMessageMetadata: async (id) => messages[id],
  };
}

function message(input: {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject?: string;
  labelIds?: string[];
}) {
  return {
    id: input.id,
    threadId: input.threadId,
    labelIds: input.labelIds ?? ["INBOX"],
    internalDateMs: 1787680000000,
    snippet: input.subject ?? "Following up",
    headers: {
      from: input.from,
      to: input.to ?? "TheAdventureZone12@gmail.com",
      cc: "",
      subject: input.subject ?? "Following up",
      date: "",
    },
    hasAttachments: false,
  };
}

function baseOptions(readClient: GoogleWorkspaceReadClient) {
  return {
    connection: { createReadClient: async () => readClient },
    scope: { getSaved: async () => ({ labels: [], calendars: [] }) },
    evidence: {
      load: async () => ({ contacts: [], organizations: [], profiles: [] }),
    },
    contactProfileResolver: {
      resolve: async () => ({
        contactId: "unused",
        status: "unresolved" as const,
        organization: null,
        candidates: [],
      }),
    },
    validationRepository: {
      upsertRows: vi.fn(async () => undefined),
      upsertReviewItems: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => "approved" as const),
    },
  };
}

describe("GoogleRecentValidationService confirmed relationship learning", () => {
  it("auto-matches another message in a confirmed thread before AI/review", async () => {
    const readClient = client({
      reply: message({
        id: "reply",
        threadId: "known-thread",
        from: "organizer@example.org",
        subject: "Re: Hello",
      }),
    });
    const service = new GoogleRecentValidationService({
      ...baseOptions(readClient),
      learning: {
        load: async () => ({
          mailboxEmails: new Set(["theadventurezone12@gmail.com"]),
          threadTargets: new Map([
            ["known-thread", { id: "org-1", name: "Logan Pride Festival" }],
          ]),
          addressTargets: new Map(),
        }),
      },
    });

    const result = await service.run(100);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toMatchObject({
      resolvedOrganization: { id: "org-1", name: "Logan Pride Festival" },
      evidenceCodes: ["existing_thread_association"],
    });
  });

  it("auto-matches a uniquely confirmed external email and ignores the Adventure Zone mailbox as ownership evidence", async () => {
    const readClient = client({
      incoming: message({
        id: "incoming",
        threadId: "new-thread",
        from: "Christina <christina@saltaevents.com>",
      }),
      internal: message({
        id: "internal",
        threadId: "internal-thread",
        from: "Adventure Zone <TheAdventureZone12@gmail.com>",
        to: "another-internal@example.com",
        labelIds: ["SENT"],
      }),
    });
    const service = new GoogleRecentValidationService({
      ...baseOptions(readClient),
      learning: {
        load: async () => ({
          mailboxEmails: new Set(["theadventurezone12@gmail.com"]),
          threadTargets: new Map(),
          addressTargets: new Map([
            ["christina@saltaevents.com", { id: "org-2", name: "Gaylord Memorial Weekend Festival" }],
            ["theadventurezone12@gmail.com", { id: "bad", name: "Adventure Zone" }],
          ]),
        }),
      },
    });

    const result = await service.run(100);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toMatchObject({
      id: "incoming",
      resolvedOrganization: { id: "org-2", name: "Gaylord Memorial Weekend Festival" },
      evidenceCodes: ["learned_external_email"],
    });
    expect(result.ignored.map((row) => row.id)).toContain("internal");
  });
});
