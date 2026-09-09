import { describe, expect, it, vi } from "vitest";

import { GoogleInboundProfileLabeler } from "./google-inbound-profile-labeler";

describe("GoogleInboundProfileLabeler", () => {
  it("labels a new thread-inherited Inbox reply at message level", async () => {
    const labelInboundMessage = vi.fn(async () => ({
      mutationId: "mutation-1",
      state: "completed" as const,
      gmailLabelId: "Label_10",
      gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
      errorCode: null,
    }));
    const labeler = new GoogleInboundProfileLabeler({
      syncFactory: async () => ({
        connectionId: "conn-1",
        service: {
          assignThread: vi.fn(),
          labelInboundMessage,
          retry: vi.fn(),
        },
      }),
    });

    await labeler.labelNewThreadMatches([{
      id: "new-message",
      threadId: "thread-1",
      labelIds: ["INBOX", "UNREAD"],
      evidenceCodes: ["existing_thread_association"],
      resolvedOrganization: { id: "org-1", name: "Elko County Fair" },
    }]);

    expect(labelInboundMessage).toHaveBeenCalledWith({
      connectionId: "conn-1",
      messageId: "new-message",
      threadId: "thread-1",
      organizationId: "org-1",
    });
  });

  it("retries due mutations even when no new matching reply is present", async () => {
    const retry = vi.fn(async () => ({
      mutationId: "mutation-due",
      state: "completed" as const,
      gmailLabelId: "Label_10",
      gmailLabelName: null,
      errorCode: null,
    }));
    const labeler = new GoogleInboundProfileLabeler({
      dueMutationIds: async () => ["mutation-due"],
      syncFactory: async () => ({
        connectionId: "conn-1",
        service: {
          assignThread: vi.fn(),
          labelInboundMessage: vi.fn(),
          retry,
        },
      }),
    });

    await labeler.labelNewThreadMatches([]);

    expect(retry).toHaveBeenCalledWith("mutation-due");
  });

  it("does not touch unrelated, ambiguous, or sent messages", async () => {
    const syncFactory = vi.fn();
    const labeler = new GoogleInboundProfileLabeler({ syncFactory });

    await labeler.labelNewThreadMatches([
      {
        id: "unrelated",
        threadId: "thread-1",
        labelIds: ["INBOX", "UNREAD"],
        evidenceCodes: ["exactnth_profile_name_subject"],
        resolvedOrganization: { id: "org-1", name: "Elko County Fair" },
      },
      {
        id: "ambiguous",
        threadId: "thread-2",
        labelIds: ["INBOX", "UNREAD"],
        evidenceCodes: ["existing_thread_association"],
        resolvedOrganization: null,
      },
      {
        id: "sent",
        threadId: "thread-3",
        labelIds: ["SENT"],
        evidenceCodes: ["existing_thread_association"],
        resolvedOrganization: { id: "org-1", name: "Elko County Fair" },
      },
    ]);

    expect(syncFactory).not.toHaveBeenCalled();
  });
  it("repairs the Gmail label hierarchy when a check finds no messages", async () => {
    const ensureHierarchy = vi.fn(async () => undefined);
    const labeler = new GoogleInboundProfileLabeler({
      syncFactory: async () => ({
        connectionId: "conn-1",
        service: {
          assignThread: vi.fn(),
          labelInboundMessage: vi.fn(),
          retry: vi.fn(),
        },
        ensureHierarchy,
      }),
    });

    await labeler.labelNewThreadMatches([]);

    expect(ensureHierarchy).toHaveBeenCalledOnce();
  });

});
