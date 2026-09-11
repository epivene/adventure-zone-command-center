import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { GoogleReviewAssignmentView } from "../features/google-workspace/google-review-profile-assignment-service";
import { createGoogleWorkspaceValidationRouter } from "./google-workspace-validation";

function appWith(options: {
  run?: (limit: number) => Promise<unknown>;
  reconcile?: (input: { messageIds: string[]; rows: any[] }) => Promise<void>;
  reconcileReview?: (input: {
    sampleMessageIds: string[];
    pendingMessageIds: string[];
  }) => Promise<void>;
  setDecision?: (input: {
    status: "approved" | "rejected";
    actorId: string;
    now: Date;
  }) => Promise<void>;
  listReviewItems?: () => Promise<any[]>;
  upsertReviewItems?: (items: any[]) => Promise<void>;
  markProcessedMessageIds?: (messageIds: string[]) => Promise<void>;
  getReviewThread?: (threadId: string) => Promise<any>;
  getReviewAttachment?: (input: { messageId: string; attachmentId: string }) => Promise<Uint8Array>;
  resolveReviewItem?: (input: {
    messageId: string;
    organizationId: string;
    actorId: string;
    now: Date;
  }) => Promise<void | GoogleReviewAssignmentView>;
  ignoreReviewItem?: (input: {
    messageId: string;
    actorId: string;
    now: Date;
  }) => Promise<void>;
  previewLabelCleanup?: () => Promise<{ labels: Array<{ id: string; name: string }> }>;
  deleteSelectedLabels?: (labelIds: string[]) => Promise<{
    deleted: Array<{ id: string; name: string }>;
    skippedLabelIds: string[];
    failed: Array<{ id: string; name: string; errorCode: string }>;
  }>;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId?: string }).userId = "owner-1";
    next();
  });
  app.use(
    createGoogleWorkspaceValidationRouter({
      service: { run: options.run ?? (async () => ({})) },
      mappingReconciler: {
        reconcile: options.reconcile ?? (async () => undefined),
      },
      reviewReconciler: {
        reconcile: options.reconcileReview ?? (async () => undefined),
      },
      reviewAssignmentService: {
        resolve: options.resolveReviewItem ?? (async () => undefined),
      },
      validationRepository: {
        setDecision: options.setDecision ?? (async () => undefined),
        getStatus: async () => "ready_for_review",
        listReviewItems: options.listReviewItems ?? (async () => []),
        ignoreReviewItem: options.ignoreReviewItem ?? (async () => undefined),
        upsertReviewItems: options.upsertReviewItems ?? (async () => undefined),
        markProcessedMessageIds:
          options.markProcessedMessageIds ?? (async () => undefined),
      } as any,
      connection: {
        createReadClient: async () => options.getReviewThread
          ? ({ getThreadDetail: options.getReviewThread, getAttachment: options.getReviewAttachment } as any)
          : null,
      },
      labelCleanupService: {
        preview: options.previewLabelCleanup ?? (async () => ({ labels: [] })),
        deleteSelected:
          options.deleteSelectedLabels ??
          (async () => ({ deleted: [], skippedLabelIds: [], failed: [] })),
      },
      now: () => new Date("2026-08-24T17:00:00.000Z"),
    }),
  );
  return app;
}

describe("Google Workspace recent validation route", () => {
  it("runs a bounded 100-item validation sample", async () => {
    const run = vi.fn(async (limit: number) => ({
      checkedLimit: limit,
      aiEnabled: false,
      historicalImportStarted: false,
      validationStatus: "ready_for_review",
      counts: { discovered: 0, matched: 0, needsReview: 0, ignored: 0 },
      matched: [],
      needsReview: [],
      ignored: [],
    }));

    const response = await request(appWith({ run }))
      .post("/google-workspace/validation/recent")
      .send({ limit: 100 });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(100, { skipProcessed: true });
    expect(response.body.aiEnabled).toBe(false);
    expect(response.body.historicalImportStarted).toBe(false);
    expect(response.body.validationStatus).toBe("ready_for_review");
  });

  it("persists final AI review outcomes before marking messages processed", async () => {
    const calls: string[] = [];
    const upsertReviewItems = vi.fn(async () => { calls.push("review"); });
    const markProcessedMessageIds = vi.fn(async () => { calls.push("processed"); });
    const reviewRow = {
      id: "ai-review",
      threadId: "thread-ai-review",
      subject: "Possible event",
      from: "organizer@example.org",
      to: "zone@example.com",
      internalDateMs: 1,
      evidenceCodes: ["ai_review"],
      candidates: [
        { id: "contact-1", name: "Contact Person", kind: "contact" },
        { id: "profile-1", name: "Fair Profile", kind: "profile" },
      ],
      organizationCandidates: [
        { id: "org-1", name: "Fair Organization" },
      ],
      hasAttachments: false,
      resolvedOrganization: null,
    };

    const response = await request(appWith({
      run: async () => ({
        matched: [],
        needsReview: [reviewRow],
        ignored: [],
      }),
      upsertReviewItems,
      markProcessedMessageIds,
    })).post("/google-workspace/validation/recent").send({ limit: 100 });

    expect(response.status).toBe(200);
    expect(upsertReviewItems).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId: "ai-review",
        threadId: "thread-ai-review",
        candidates: [
          { id: "org-1", name: "Fair Organization" },
          { id: "profile-1", name: "Fair Profile" },
        ],
      }),
    ]);
    expect(markProcessedMessageIds).toHaveBeenCalledWith(["ai-review"]);
    expect(calls).toEqual(["review", "processed"]);
  });

  it("reconciles stale stored mappings from the current sample", async () => {
    const reconcile = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({
      checkedLimit: 100,
      aiEnabled: false,
      historicalImportStarted: false,
      validationStatus: "approved",
      counts: { discovered: 2, matched: 1, needsReview: 0, ignored: 1 },
      matched: [
        {
          id: "m1",
          threadId: "t1",
          evidenceCodes: ["exact_profile_name_subject"],
          matchedContact: null,
          resolvedOrganization: { id: "logan-pride", name: "Logan Pride Festival (Logan) UT" },
        },
      ],
      needsReview: [],
      ignored: [{ id: "m2", threadId: "t2" }],
    }));

    const response = await request(appWith({ run, reconcile }))
      .post("/google-workspace/validation/recent")
      .send({ limit: 100 });

    expect(response.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith({
      messageIds: ["m1", "m2"],
      rows: [
        {
          messageId: "m1",
          threadId: "t1",
          organizationId: "logan-pride",
          contactId: null,
          evidenceCodes: ["exact_profile_name_subject"],
        },
      ],
    });
  });

  it("removes stale pending review items when current validation no longer needs them", async () => {
    const reconcileReview = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({
      checkedLimit: 100,
      aiEnabled: false,
      historicalImportStarted: false,
      validationStatus: "approved",
      counts: { discovered: 3, matched: 1, needsReview: 1, ignored: 1 },
      matched: [{ id: "matched-now", threadId: "t1" }],
      needsReview: [{ id: "still-review", threadId: "t2" }],
      ignored: [{ id: "ignored-now", threadId: "t3" }],
    }));

    const response = await request(appWith({ run, reconcileReview }))
      .post("/google-workspace/validation/recent")
      .send({ limit: 100 });

    expect(response.status).toBe(200);
    expect(reconcileReview).toHaveBeenCalledWith({
      sampleMessageIds: ["matched-now", "still-review", "ignored-now"],
      pendingMessageIds: ["still-review"],
    });
  });

  it("rejects attempts to expand the validation sample beyond 100", async () => {
    const run = vi.fn(async () => ({}));
    const response = await request(appWith({ run }))
      .post("/google-workspace/validation/recent")
      .send({ limit: 101 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "GOOGLE_WORKSPACE_VALIDATION_INPUT_INVALID" });
    expect(run).not.toHaveBeenCalled();
  });

  it("lists durable Needs Review items", async () => {
    const listReviewItems = vi.fn(async () => [{
      messageId: "m1",
      threadId: "t1",
      subject: "County Fair application",
      from: "fair@example.org",
      to: "zone@example.com",
      internalDateMs: 1,
      evidenceCodes: [],
      candidates: [],
      hasAttachments: false,
      state: "pending",
      resolvedOrganizationId: null,
    }]);

    const response = await request(appWith({ listReviewItems }))
      .get("/google-workspace/validation/review");

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
  });

  it("opens only a saved review item's full Gmail thread", async () => {
    const getReviewThread = vi.fn(async (threadId: string) => ({
      id: threadId,
      subject: "County Fair application",
      originalGmailUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
      messages: [{
        id: "gm1",
        from: "events@example.org",
        to: "zone@example.com",
        cc: "",
        subject: "County Fair application",
        date: "Mon, 24 Aug 2026 10:00:00 -0600",
        internalDateMs: 1,
        direction: "incoming",
        bodyText: "Full message body",
        attachments: [],
      }],
    }));
    const listReviewItems = vi.fn(async () => [{
      messageId: "m1",
      threadId: "t1",
      subject: "County Fair application",
      from: "events@example.org",
      to: "zone@example.com",
      internalDateMs: 1,
      evidenceCodes: [],
      candidates: [],
      hasAttachments: false,
      state: "pending",
      resolvedOrganizationId: null,
      gmailSyncState: "not_requested",
      gmailSyncErrorCode: null,
      gmailSyncMutationId: null,
    }]);

    const response = await request(appWith({ listReviewItems, getReviewThread }))
      .get("/google-workspace/validation/review/m1/thread");

    expect(response.status).toBe(200);
    expect(response.body.messages[0].bodyText).toBe("Full message body");
    expect(getReviewThread).toHaveBeenCalledWith("t1");
  });

  it("opens only an attachment that belongs to the saved review thread", async () => {
    const getReviewAttachment = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const getReviewThread = vi.fn(async () => ({
      id: "t1",
      subject: "County Fair application",
      originalGmailUrl: "https://mail.google.com/mail/u/0/#all/t1",
      messages: [{
        id: "gm1",
        from: "events@example.org",
        to: "zone@example.com",
        cc: "",
        subject: "County Fair application",
        date: "",
        internalDateMs: 1,
        direction: "incoming",
        bodyText: "Full message body",
        attachments: [{
          attachmentId: "a1",
          filename: "fair-info.pdf",
          mimeType: "application/pdf",
          sizeBytes: 3,
          messageId: "gm1",
        }],
      }],
    }));
    const listReviewItems = vi.fn(async () => [{
      messageId: "m1",
      threadId: "t1",
      state: "pending",
    }]);

    const response = await request(appWith({
      listReviewItems,
      getReviewThread,
      getReviewAttachment,
    })).get("/google-workspace/validation/review/m1/attachments/gm1/a1");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("fair-info.pdf");
    expect(response.body).toEqual(Buffer.from([1, 2, 3]));
    expect(getReviewAttachment).toHaveBeenCalledWith({
      messageId: "gm1",
      attachmentId: "a1",
    });
  });

  it("forces active attachment types to download and safely encodes Unicode filenames", async () => {
    const response = await request(appWith({
      listReviewItems: async () => [{ messageId: "m1", threadId: "t1" }],
      getReviewThread: async () => ({
        id: "t1",
        subject: "",
        originalGmailUrl: "",
        messages: [{
          id: "gm1",
          attachments: [{
            attachmentId: "a1",
            filename: "报价.html",
            mimeType: "text/html",
            sizeBytes: 3,
            messageId: "gm1",
          }],
        }],
      }),
      getReviewAttachment: async () => new Uint8Array([1, 2, 3]),
    })).get("/google-workspace/validation/review/m1/attachments/gm1/a1");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/octet-stream");
    expect(response.headers["content-disposition"]).toContain("attachment;");
    expect(response.headers["content-disposition"]).toContain(
      "filename*=UTF-8''%E6%8A%A5%E4%BB%B7.html",
    );
  });

  it("does not fetch an attachment outside the saved review thread", async () => {
    const getReviewAttachment = vi.fn();
    const response = await request(appWith({
      listReviewItems: async () => [{ messageId: "m1", threadId: "t1" }],
      getReviewThread: async () => ({
        id: "t1",
        subject: "",
        originalGmailUrl: "",
        messages: [],
      }),
      getReviewAttachment,
    })).get("/google-workspace/validation/review/m1/attachments/gm1/not-there");

    expect(response.status).toBe(404);
    expect(getReviewAttachment).not.toHaveBeenCalled();
  });

  it("does not open an arbitrary Gmail thread outside the review queue", async () => {
    const getReviewThread = vi.fn();
    const response = await request(appWith({
      listReviewItems: async () => [],
      getReviewThread,
    })).get("/google-workspace/validation/review/not-saved/thread");

    expect(response.status).toBe(404);
    expect(getReviewThread).not.toHaveBeenCalled();
  });

  it("previews old Gmail profile labels without deleting them", async () => {
    const previewLabelCleanup = vi.fn(async () => ({
      labels: [{ id: "Label_old", name: "Z - AdventureZone/Profiles/Old" }],
    }));
    const response = await request(appWith({ previewLabelCleanup }))
      .get("/google-workspace/profile-labels/cleanup");

    expect(response.status).toBe(200);
    expect(response.body.labels).toEqual([
      { id: "Label_old", name: "Z - AdventureZone/Profiles/Old" },
    ]);
    expect(previewLabelCleanup).toHaveBeenCalledTimes(1);
  });

  it("deletes only the explicitly confirmed Gmail label IDs", async () => {
    const deleteSelectedLabels = vi.fn(async (labelIds: string[]) => ({
      deleted: labelIds.map((id) => ({
        id,
        name: "Z - AdventureZone/Profiles/Old",
      })),
      skippedLabelIds: [],
      failed: [],
    }));
    const response = await request(appWith({ deleteSelectedLabels }))
      .post("/google-workspace/profile-labels/cleanup")
      .send({ labelIds: ["Label_old"], confirm: true });

    expect(response.status).toBe(200);
    expect(deleteSelectedLabels).toHaveBeenCalledWith(["Label_old"]);
  });

  it("rejects empty or oversized Gmail label cleanup requests", async () => {
    const deleteSelectedLabels = vi.fn();
    const empty = await request(appWith({ deleteSelectedLabels }))
      .post("/google-workspace/profile-labels/cleanup")
      .send({ labelIds: [], confirm: true });
    const oversized = await request(appWith({ deleteSelectedLabels }))
      .post("/google-workspace/profile-labels/cleanup")
      .send({
        labelIds: Array.from({ length: 101 }, (_, index) => `Label_${index}`),
        confirm: true,
      });

    const unconfirmed = await request(appWith({ deleteSelectedLabels }))
      .post("/google-workspace/profile-labels/cleanup")
      .send({ labelIds: ["Label_old"] });

    expect(empty.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(unconfirmed.status).toBe(400);
    expect(deleteSelectedLabels).not.toHaveBeenCalled();
  });

  it("assigns a review item to a selected live profile", async () => {
    const resolveReviewItem = vi.fn(async () => undefined);
    const response = await request(appWith({ resolveReviewItem }))
      .put("/google-workspace/validation/review/m1")
      .send({ organizationId: "11111111-1111-4111-8111-111111111111" });

    expect(response.status).toBe(200);
    expect(resolveReviewItem).toHaveBeenCalledWith({
      messageId: "m1",
      organizationId: "11111111-1111-4111-8111-111111111111",
      actorId: "owner-1",
      now: new Date("2026-08-24T17:00:00.000Z"),
    });
  });

  it("returns completed Gmail label and archive state", async () => {
    const resolveReviewItem = vi.fn(async () => ({
      organizationId: "11111111-1111-4111-8111-111111111111",
      threadId: "t1",
      gmailSync: {
        mutationId: "mutation-1",
        state: "completed" as const,
        gmailLabelId: "Label_10",
        gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
        errorCode: null,
      },
    }));
    const response = await request(appWith({ resolveReviewItem }))
      .put("/google-workspace/validation/review/m1")
      .send({ organizationId: "11111111-1111-4111-8111-111111111111" });

    expect(response.status).toBe(200);
    expect(response.body.gmailSync).toMatchObject({
      state: "completed",
      gmailLabelId: "Label_10",
    });
  });

  it("returns a retryable Gmail mutation without failing the assignment", async () => {
    const resolveReviewItem = vi.fn(async () => ({
      organizationId: "10000000-0000-4000-8000-000000000001",
      threadId: "thread-1",
      gmailSync: {
        mutationId: "30000000-0000-4000-8000-000000000001",
        state: "retryable_error" as const,
        gmailLabelId: null,
        gmailLabelName: null,
        errorCode: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
      },
    }));

    const response = await request(appWith({ resolveReviewItem }))
      .put("/google-workspace/validation/review/m1")
      .send({ organizationId: "10000000-0000-4000-8000-000000000001" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      gmailSync: {
        mutationId: "30000000-0000-4000-8000-000000000001",
        state: "retryable_error",
      },
    });
  });

  it("ignores a review item without assigning a profile", async () => {
    const ignoreReviewItem = vi.fn(async () => undefined);
    const response = await request(appWith({ ignoreReviewItem }))
      .post("/google-workspace/validation/review/m1/ignore")
      .send({});

    expect(response.status).toBe(200);
    expect(ignoreReviewItem).toHaveBeenCalledWith({
      messageId: "m1",
      actorId: "owner-1",
      now: new Date("2026-08-24T17:00:00.000Z"),
    });
  });

  it("records owner approval without starting historical import", async () => {
    const setDecision = vi.fn(async () => undefined);

    const response = await request(appWith({ setDecision }))
      .post("/google-workspace/validation/decision")
      .send({ decision: "approve" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      validationStatus: "approved",
      historicalImportStarted: false,
    });
    expect(setDecision).toHaveBeenCalledWith({
      status: "approved",
      actorId: "owner-1",
      now: new Date("2026-08-24T17:00:00.000Z"),
    });
  });

  it("records rejection as review state only", async () => {
    const setDecision = vi.fn(async () => undefined);

    const response = await request(appWith({ setDecision }))
      .post("/google-workspace/validation/decision")
      .send({ decision: "reject" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      validationStatus: "rejected",
      historicalImportStarted: false,
    });
    expect(setDecision).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected" }),
    );
  });
});
