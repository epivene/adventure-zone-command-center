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
      },
      labelCleanupService: {
        preview: options.previewLabelCleanup ?? (async () => ({ labels: [] })),
        deleteSelected:
          options.deleteSelectedLabels ??
          (async () => ({ deleted: [], skippedLabelIds: [] })),
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
    expect(run).toHaveBeenCalledWith(100);
    expect(response.body.aiEnabled).toBe(false);
    expect(response.body.historicalImportStarted).toBe(false);
    expect(response.body.validationStatus).toBe("ready_for_review");
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
