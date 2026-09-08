import { describe, expect, it } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import { GoogleHistoricalMessageClassifier } from "./google-historical-message-classifier";

const message = (input: {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet?: string;
}) => ({
  id: input.id,
  threadId: input.threadId,
  labelIds: ["INBOX"],
  internalDateMs: 1787680000000,
  snippet: input.snippet ?? input.subject,
  headers: {
    from: input.from,
    to: "TheAdventureZone12@gmail.com",
    cc: "",
    subject: input.subject,
    date: "",
  },
  hasAttachments: false,
});

function client(bodyText = ""): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "theadventurezone12@gmail.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    getThreadDetail: async (threadId) => ({
      id: threadId,
      subject: "",
      originalGmailUrl: "",
      messages: [{
        id: "body-message",
        internalDateMs: 1,
        from: "",
        to: "",
        cc: "",
        subject: "",
        date: "",
        direction: "incoming",
        bodyText,
        attachments: [],
      }],
    }),
  };
}

function context(input?: {
  threadTargets?: Map<string, { id: string; name: string }>;
  addressTargets?: Map<string, { id: string; name: string }>;
  profiles?: Array<{ id: string; name: string }>;
}) {
  return {
    approvedLabelIds: new Set<string>(),
    mailboxEmails: new Set(["theadventurezone12@gmail.com"]),
    contacts: [],
    organizations: [],
    profiles: input?.profiles ?? [],
    threadTargets: input?.threadTargets ?? new Map(),
    addressTargets: input?.addressTargets ?? new Map(),
  };
}

describe("GoogleHistoricalMessageClassifier", () => {
  it("attaches a message in an already confirmed Gmail thread", async () => {
    const classifier = new GoogleHistoricalMessageClassifier({
      contextLoader: async () => context({
        threadTargets: new Map([
          ["thread-1", { id: "logan", name: "Logan Pride Festival (Logan) UT" }],
        ]),
      }),
      aiEnabled: false,
    });

    await expect(classifier.classify(
      message({ id: "m1", threadId: "thread-1", from: "person@example.com", subject: "Re: hello" }),
      client(),
    )).resolves.toMatchObject({
      outcome: "attached",
      organization: { id: "logan", name: "Logan Pride Festival (Logan) UT" },
      evidenceCodes: ["existing_thread_association"],
    });
  });

  it("uses a uniquely learned outside email when no event evidence conflicts", async () => {
    const classifier = new GoogleHistoricalMessageClassifier({
      contextLoader: async () => context({
        addressTargets: new Map([
          ["christina@saltaevents.com", { id: "gaylord", name: "Gaylord Memorial Weekend Festival" }],
        ]),
      }),
      aiEnabled: false,
    });

    const result = await classifier.classify(
      message({ id: "m2", threadId: "thread-2", from: "Christina <christina@saltaevents.com>", subject: "Following up" }),
      client("Just following up on our prior conversation."),
    );

    expect(result).toMatchObject({
      outcome: "attached",
      organization: { id: "gaylord" },
      evidenceCodes: expect.arrayContaining(["learned_external_email"]),
    });
  });

  it("lets clear email body event evidence override an older learned outside email", async () => {
    const classifier = new GoogleHistoricalMessageClassifier({
      contextLoader: async () => context({
        addressTargets: new Map([
          ["christina@saltaevents.com", { id: "gaylord", name: "Gaylord Memorial Weekend Festival" }],
        ]),
        profiles: [
          { id: "gaylord", name: "Gaylord Memorial Weekend Festival" },
          { id: "logan", name: "Logan Pride Festival (Logan) UT" },
        ],
      }),
      aiEnabled: false,
    });

    const result = await classifier.classify(
      message({ id: "m3", threadId: "thread-3", from: "christina@saltaevents.com", subject: "Question" }),
      client("This is about Logan Pride Festival (Logan) UT and the September event."),
    );

    expect(result).toMatchObject({
      outcome: "attached",
      organization: { id: "logan" },
      evidenceCodes: expect.arrayContaining(["exact_profile_name_body"]),
    });
  });

  it("allows high-confidence AI to ignore unrelated personal/order mail without persisting body text in the result", async () => {
    const classifier = new GoogleHistoricalMessageClassifier({
      contextLoader: async () => context(),
      aiEnabled: true,
      aiFactory: async () => ({
        providerName: "test-ai",
        complete: async () => JSON.stringify({
          decision: "IGNORE",
          profileId: null,
          confidence: "high",
          reason: "Personal retail order with no event or CRM context.",
        }),
      }),
    });

    const result = await classifier.classify(
      message({ id: "m4", threadId: "thread-4", from: "store@example.com", subject: "Your order shipped" }),
      client("David, your personal order is on the way."),
    );

    expect(result).toMatchObject({ outcome: "ignored" });
    expect(JSON.stringify(result)).not.toContain("personal order is on the way");
  });

  it("continues safely when Gmail never returns a thread body", async () => {
    const hangingClient = {
      ...client(),
      getThreadDetail: async () => new Promise<never>(() => undefined),
    };
    const classifier = new GoogleHistoricalMessageClassifier({
      contextLoader: async () => context(),
      aiEnabled: false,
      ioTimeoutMs: 20,
    });

    await expect(classifier.classify(
      message({ id: "m5", threadId: "thread-5", from: "unknown@example.com", subject: "Hello" }),
      hangingClient,
    )).resolves.toMatchObject({ outcome: "ignored" });
  });
});
