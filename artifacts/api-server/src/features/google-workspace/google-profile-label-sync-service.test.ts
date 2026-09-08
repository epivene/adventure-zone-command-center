import { describe, expect, it, vi } from "vitest";

import type { GoogleGmailLabelMutationClient } from "./google-api-types";
import type {
  GoogleGmailMutationIntent,
  GoogleGmailMutationRecord,
} from "./google-gmail-mutation-repository";
import type { GoogleProfileLabelRepositoryPort } from "./google-profile-label-repository";
import { GoogleProfileLabelSyncService } from "./google-profile-label-sync-service";

function harness(enabled = true) {
  let row: GoogleGmailMutationRecord | null = null;
  const mutations = {
    createOrLoad: vi.fn(async (intent: GoogleGmailMutationIntent) => {
      if (!row) {
        row = {
          id: "mutation-1",
          ...intent,
          targetLabelId: null,
          removeLabelIds: [],
          state: "pending",
          attemptCount: 0,
          lastErrorCode: null,
        };
      }
      return row;
    }),
    get: vi.fn(async () => row),
    claim: vi.fn(async () => {
      if (!row || row.state === "completed") return null;
      row = { ...row, state: "processing", attemptCount: row.attemptCount + 1 };
      return row;
    }),
    complete: vi.fn(async (input: {
      targetLabelId: string;
      removeLabelIds: string[];
    }) => {
      row = {
        ...row!,
        state: "completed",
        targetLabelId: input.targetLabelId,
        removeLabelIds: input.removeLabelIds,
        lastErrorCode: null,
      };
    }),
    fail: vi.fn(async (input: {
      state: "retryable_error" | "permanent_error" | "conflict";
      errorCode: string;
    }) => {
      row = { ...row!, state: input.state, lastErrorCode: input.errorCode };
    }),
  };
  const gmail: GoogleGmailLabelMutationClient = {
    listLabels: vi.fn(async () => []),
    createLabel: vi.fn(async (name) => ({ id: "Label_target", name, type: "user" })),
    renameLabel: vi.fn(async ({ labelId, name }) => ({ id: labelId, name, type: "user" })),
    modifyThreadLabels: vi.fn(async () => undefined),
    modifyMessageLabels: vi.fn(async () => undefined),
  };
  const labels: GoogleProfileLabelRepositoryPort = {
    getOrganization: vi.fn(async () => ({
      id: "org-1",
      name: "Elko County Fair",
      consolidatedIntoId: null,
    })),
    findByOrganization: vi.fn(async () => null),
    findByLabelId: vi.fn(async () => null),
    adopt: vi.fn(async (input) => ({
      ...input,
      state: "active",
      lastErrorCode: null,
    })),
    markState: vi.fn(async () => undefined),
    listManagedLabelIds: vi.fn(async () => ["Label_old", "Label_target"]),
  };
  const resolver = {
    resolve: vi.fn(async () => ({
      status: "resolved" as const,
      mapping: {
        connectionId: "conn-1",
        organizationId: "org-1",
        gmailLabelId: "Label_target",
        gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
        state: "active" as const,
        lastErrorCode: null,
      },
    })),
  };
  const service = new GoogleProfileLabelSyncService({
    enabled,
    mutations,
    resolver: resolver as never,
    labels,
    gmail,
    now: () => new Date("2026-09-08T12:00:00.000Z"),
  });
  return { service, mutations, resolver, labels, gmail, current: () => row };
}

describe("GoogleProfileLabelSyncService", () => {
  it("labels and archives the explicitly assigned whole thread", async () => {
    const h = harness();

    await expect(h.service.assignThread({
      connectionId: "conn-1",
      messageId: "message-1",
      threadId: "thread-1",
      organizationId: "org-1",
      actorId: "owner-1",
      decisionRevision: "revision-1",
    })).resolves.toMatchObject({
      state: "completed",
      gmailLabelId: "Label_target",
    });

    expect(h.gmail.modifyThreadLabels).toHaveBeenCalledWith({
      threadId: "thread-1",
      addLabelIds: ["Label_target"],
      removeLabelIds: ["INBOX", "Label_old"],
    });
    const call = vi.mocked(h.gmail.modifyThreadLabels).mock.calls[0]?.[0];
    expect(call?.removeLabelIds).not.toContain("UNREAD");
    expect(h.gmail.modifyMessageLabels).not.toHaveBeenCalled();
  });

  it("labels a later incoming message without removing Inbox or unread", async () => {
    const h = harness();

    await expect(h.service.labelInboundMessage({
      connectionId: "conn-1",
      messageId: "new-message",
      threadId: "thread-1",
      organizationId: "org-1",
    })).resolves.toMatchObject({ state: "completed" });

    expect(h.gmail.modifyMessageLabels).toHaveBeenCalledWith({
      messageId: "new-message",
      addLabelIds: ["Label_target"],
      removeLabelIds: [],
    });
    expect(h.gmail.modifyThreadLabels).not.toHaveBeenCalled();
  });

  it("does not call Gmail while the rollout switch is disabled", async () => {
    const h = harness(false);

    await expect(h.service.assignThread({
      connectionId: "conn-1",
      messageId: "message-1",
      threadId: "thread-1",
      organizationId: "org-1",
      actorId: "owner-1",
      decisionRevision: "revision-1",
    })).resolves.toMatchObject({
      state: "retryable_error",
      errorCode: "GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_DISABLED",
    });
    expect(h.gmail.modifyThreadLabels).not.toHaveBeenCalled();
    expect(h.gmail.modifyMessageLabels).not.toHaveBeenCalled();
  });

  it("replays the same operation safely when completion persistence failed", async () => {
    const h = harness();
    vi.mocked(h.mutations.complete)
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockImplementationOnce(async (input) => {
        const current = h.current()!;
        Object.assign(current, {
          state: "completed",
          targetLabelId: input.targetLabelId,
          removeLabelIds: input.removeLabelIds,
          lastErrorCode: null,
        });
      });

    const first = await h.service.assignThread({
      connectionId: "conn-1",
      messageId: "message-1",
      threadId: "thread-1",
      organizationId: "org-1",
      actorId: "owner-1",
      decisionRevision: "revision-1",
    });
    expect(first.state).toBe("retryable_error");

    await h.service.retry("mutation-1");
    expect(h.gmail.modifyThreadLabels).toHaveBeenCalledTimes(2);
    expect(h.mutations.complete).toHaveBeenCalledTimes(2);
  });
});
