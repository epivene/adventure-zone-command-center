import { describe, expect, it } from "vitest";

import {
  GoogleSentProfileLinkSweepService,
  type GoogleSentProfileLinkSweepClassifier,
  type GoogleSentProfileLinkSweepRepository,
} from "./google-sent-profile-link-sweep-service";
import type {
  GoogleMessageMetadata,
  GoogleWorkspaceReadClient,
} from "./google-api-types";

function message(input: {
  id: string;
  threadId?: string;
  labels?: string[];
  dateMs: number;
  subject: string;
  to?: string;
}): GoogleMessageMetadata {
  return {
    id: input.id,
    threadId: input.threadId ?? `thread-${input.id}`,
    labelIds: input.labels ?? ["SENT"],
    internalDateMs: input.dateMs,
    snippet: input.subject,
    headers: {
      from: "Adventure Zone <theadventurezone12@gmail.com>",
      to: input.to ?? "event@example.org",
      cc: "",
      subject: input.subject,
      date: new Date(input.dateMs).toUTCString(),
    },
    hasAttachments: false,
  };
}

class FakeRepository implements GoogleSentProfileLinkSweepRepository {
  readonly linked: Array<{
    messageId: string;
    threadId: string;
    organizationId: string;
    contactId: string | null;
    evidenceCodes: string[];
  }> = [];
  readonly reviews: Array<{
    messageId: string;
    threadId: string;
    subject: string;
    from: string;
    to: string;
    internalDateMs: number | null;
    evidenceCodes: string[];
    candidates: Array<{ id: string; name: string }>;
    hasAttachments: boolean;
  }> = [];

  constructor(
    private readonly messageTargets = new Map<string, { id: string; name: string }>(),
    private readonly threadTargets = new Map<string, { id: string; name: string }>(),
    private readonly labelTargets = new Map<string, { id: string; name: string }>(),
  ) {}

  async profileTargetsByLabelIds(labelIds: string[]) {
    return new Map(
      labelIds.flatMap((id) => {
        const target = this.labelTargets.get(id);
        return target ? [[id, target] as const] : [];
      }),
    );
  }

  async mappedTargets(input: {
    messageIds: string[];
    threadIds: string[];
  }) {
    return {
      byMessage: new Map(
        input.messageIds.flatMap((id) => {
          const target = this.messageTargets.get(id);
          return target ? [[id, target] as const] : [];
        }),
      ),
      byThread: new Map(
        input.threadIds.flatMap((id) => {
          const target = this.threadTargets.get(id);
          return target ? [[id, target] as const] : [];
        }),
      ),
    };
  }

  async upsertMappings(rows: typeof this.linked) {
    this.linked.push(...rows);
  }

  async upsertReviewItems(rows: typeof this.reviews) {
    this.reviews.push(...rows);
  }

  async validationStatus() {
    return "approved" as const;
  }
}

function client(messages: GoogleMessageMetadata[]): GoogleWorkspaceReadClient {
  const byId = new Map(messages.map((item) => [item.id, item]));
  const pages = [messages.slice(0, 3), messages.slice(3)];
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "theadventurezone12@gmail.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    listMessagePage: async ({ pageToken }) => {
      const index = pageToken ? Number(pageToken) : 0;
      return {
        messages: (pages[index] ?? []).map((item) => ({
          id: item.id,
          threadId: item.threadId,
        })),
        nextPageToken: index + 1 < pages.length ? String(index + 1) : null,
      };
    },
    getMessageMetadata: async (id) => byId.get(id)!,
    getThreadDetail: async (threadId) => ({
      id: threadId,
      subject: "",
      originalGmailUrl: "",
      messages: [],
    }),
  };
}

function classifier(
  outcomes: Record<string, Awaited<ReturnType<GoogleSentProfileLinkSweepClassifier["classify"]>>>,
): GoogleSentProfileLinkSweepClassifier {
  return {
    classify: async (item) => outcomes[item.id] ?? {
      outcome: "ignored",
      evidenceCodes: [],
    },
  };
}

describe("GoogleSentProfileLinkSweepService", () => {
  it("uses an existing Gmail profile label as the authoritative profile match", async () => {
    const item = message({
      id: "alamosa-outreach",
      threadId: "alamosa-thread",
      labels: ["SENT", "Label_alamosa"],
      dateMs: Date.UTC(2026, 7, 25),
      subject: "Alamosa ARTs Festival Sept 5th 2026",
      to: "societyhall@example.org",
    });
    const repository = new FakeRepository(
      new Map(),
      new Map(),
      new Map([["Label_alamosa", { id: "org-alamosa", name: "Alamosa ARTs Festival" }]]),
    );
    const service = new GoogleSentProfileLinkSweepService({
      connection: { createReadClient: async () => client([item]) },
      repository,
      classifier: classifier({
        "alamosa-outreach": { outcome: "ignored", evidenceCodes: [] },
      }),
    });

    const result = await service.run({
      after: new Date(Date.UTC(2026, 7, 1)),
      before: new Date(Date.UTC(2026, 8, 1)),
      repair: true,
    });

    expect(result.counts.linked).toBe(1);
    expect(repository.linked).toEqual([
      expect.objectContaining({
        messageId: "alamosa-outreach",
        organizationId: "org-alamosa",
        evidenceCodes: ["gmail_profile_label", "sent_profile_link_sweep"],
      }),
    ]);
  });

  it("repairs unmapped sent mail, inherits an existing thread target, and queues ambiguity", async () => {
    const after = Date.UTC(2026, 0, 1);
    const before = Date.UTC(2027, 0, 1);
    const messages = [
      message({
        id: "already-linked",
        dateMs: Date.UTC(2026, 7, 30),
        subject: "Already linked",
      }),
      message({
        id: "same-thread-follow-up",
        threadId: "known-thread",
        dateMs: Date.UTC(2026, 7, 29),
        subject: "Re: Known event",
      }),
      message({
        id: "twin-falls",
        threadId: "twin-thread",
        dateMs: Date.UTC(2026, 7, 26),
        subject: "Twin Falls County Fair - Sept 2-7 2026",
        to: "fair@tfcfair.com",
      }),
      message({
        id: "ambiguous",
        dateMs: Date.UTC(2026, 6, 1),
        subject: "County Fair",
      }),
      message({
        id: "inbox-only",
        labels: ["INBOX"],
        dateMs: Date.UTC(2026, 5, 1),
        subject: "Incoming only",
      }),
      message({
        id: "too-old",
        dateMs: Date.UTC(2025, 11, 31),
        subject: "Old sent message",
      }),
    ];
    const repository = new FakeRepository(
      new Map([["already-linked", { id: "org-existing", name: "Existing" }]]),
      new Map([["known-thread", { id: "org-thread", name: "Known Event" }]]),
    );
    const service = new GoogleSentProfileLinkSweepService({
      connection: { createReadClient: async () => client(messages) },
      repository,
      classifier: classifier({
        "twin-falls": {
          outcome: "attached",
          organization: {
            id: "b447c83c-6348-4fab-b850-0db7a5576a83",
            name: "Twin Falls County Fair",
          },
          evidenceCodes: ["exact_profile_name_subject"],
        },
        ambiguous: {
          outcome: "needs_review",
          candidates: [
            { id: "org-a", name: "County Fair A" },
            { id: "org-b", name: "County Fair B" },
          ],
          evidenceCodes: ["weighted_profile_text_ambiguous"],
        },
      }),
    });

    const result = await service.run({
      after: new Date(after),
      before: new Date(before),
      repair: true,
    });

    expect(result.counts).toEqual({
      examined: 6,
      sentInWindow: 4,
      alreadyLinked: 1,
      linked: 2,
      needsReview: 1,
      ignored: 0,
      failed: 0,
    });
    expect(repository.linked).toEqual([
      {
        messageId: "same-thread-follow-up",
        threadId: "known-thread",
        organizationId: "org-thread",
        contactId: null,
        evidenceCodes: ["existing_thread_association", "sent_profile_link_sweep"],
      },
      {
        messageId: "twin-falls",
        threadId: "twin-thread",
        organizationId: "b447c83c-6348-4fab-b850-0db7a5576a83",
        contactId: null,
        evidenceCodes: ["exact_profile_name_subject", "sent_profile_link_sweep"],
      },
    ]);
    expect(repository.reviews).toEqual([
      expect.objectContaining({
        messageId: "ambiguous",
        candidates: [
          { id: "org-a", name: "County Fair A" },
          { id: "org-b", name: "County Fair B" },
        ],
      }),
    ]);
    expect(result.linked).toEqual([
      expect.objectContaining({ messageId: "same-thread-follow-up", organizationId: "org-thread" }),
      expect.objectContaining({
        messageId: "twin-falls",
        organizationId: "b447c83c-6348-4fab-b850-0db7a5576a83",
      }),
    ]);
  });

  it("reloads profile evidence for each sweep run", async () => {
    const messages = [message({
      id: "fresh-profile-message",
      dateMs: Date.UTC(2026, 7, 1),
      subject: "Newly created event profile",
    })];
    const repository = new FakeRepository();
    let factoryCalls = 0;
    const service = new GoogleSentProfileLinkSweepService({
      connection: { createReadClient: async () => client(messages) },
      repository,
      classifierFactory: () => {
        factoryCalls += 1;
        return classifier({
          "fresh-profile-message": {
            outcome: "attached",
            organization: {
              id: `org-run-${factoryCalls}`,
              name: `Current profile ${factoryCalls}`,
            },
            evidenceCodes: ["fresh_profile_context"],
          },
        });
      },
    });

    const window = {
      after: new Date(Date.UTC(2026, 0, 1)),
      before: new Date(Date.UTC(2027, 0, 1)),
      repair: true,
    } as const;
    await service.run(window);
    await service.run(window);

    expect(factoryCalls).toBe(2);
    expect(repository.linked.map((row) => row.organizationId)).toEqual([
      "org-run-1",
      "org-run-2",
    ]);
  });

  it("is read-only when repair is false", async () => {
    const messages = [message({
      id: "m1",
      dateMs: Date.UTC(2026, 7, 1),
      subject: "A real event",
    })];
    const repository = new FakeRepository();
    const service = new GoogleSentProfileLinkSweepService({
      connection: { createReadClient: async () => client(messages) },
      repository,
      classifier: classifier({
        m1: {
          outcome: "attached",
          organization: { id: "org-1", name: "A Real Event" },
          evidenceCodes: ["exact_profile_name_subject"],
        },
      }),
    });

    const result = await service.run({
      after: new Date(Date.UTC(2026, 0, 1)),
      before: new Date(Date.UTC(2027, 0, 1)),
      repair: false,
    });

    expect(result.counts.linked).toBe(1);
    expect(repository.linked).toEqual([]);
    expect(repository.reviews).toEqual([]);
  });

  it("rejects invalid or unbounded date windows", async () => {
    const service = new GoogleSentProfileLinkSweepService({
      connection: { createReadClient: async () => client([]) },
      repository: new FakeRepository(),
      classifier: classifier({}),
    });

    await expect(service.run({
      after: new Date("invalid"),
      before: new Date(Date.UTC(2027, 0, 1)),
      repair: true,
    })).rejects.toThrow("GOOGLE_WORKSPACE_SENT_PROFILE_LINK_WINDOW_INVALID");

    await expect(service.run({
      after: new Date(Date.UTC(2024, 0, 1)),
      before: new Date(Date.UTC(2027, 0, 2)),
      repair: true,
    })).rejects.toThrow("GOOGLE_WORKSPACE_SENT_PROFILE_LINK_WINDOW_TOO_LARGE");
  });
});
