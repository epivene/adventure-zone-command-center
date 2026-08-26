import { describe, expect, it, vi } from "vitest";

import { APPROVED_LEAD_INTRODUCTION_2026 } from "../communication-templates/lead-introduction-2026-approved";
import { buildLeadEmailPreview } from "./lead-email-preview-service";
import {
  GmailDraftService,
  GmailDraftServiceError,
  type GmailDraftPersistence,
  type LeadGmailDraftLink,
} from "./gmail-draft-service";

const link: LeadGmailDraftLink = {
  id: "draft-link",
  rowId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  contactId: null,
  googleConnectionId: "33333333-3333-4333-8333-333333333333",
  communicationTemplateId: "44444444-4444-4444-8444-444444444444",
  templateVersion: "2026-prepaid-v1",
  recipientEmail: "person@example.com",
  subject: "Aspen Filmfest (Aspen) CO SEPT 29 – OCT 4, 2026",
  body: "Hi,\n\nBody\n\nDesiree",
  gmailDraftId: "gmail-draft-1",
  gmailMessageId: "gmail-message-1",
  activityId: "66666666-6666-4666-8666-666666666666",
  state: "created",
  lastErrorCode: null,
  idempotencyKey: "lead-gmail:11111111-1111-4111-8111-111111111111",
  attemptCount: 1,
  actorId: "owner-1",
  createdAt: "2026-08-26T12:00:00.000Z",
  updatedAt: "2026-08-26T12:00:01.000Z",
  lastAttemptAt: "2026-08-26T12:00:00.000Z",
  completedAt: "2026-08-26T12:00:01.000Z",
};

function readyState(overrides: Record<string, unknown> = {}) {
  return {
    lead: {
      rowId: link.rowId,
      reviewVersion: 7,
      organizationId: link.organizationId,
      contactId: null,
      profileName: "Aspen Filmfest (Aspen) CO",
      eventName: "Aspen Filmfest",
      eventCity: "Aspen",
      eventRegion: "CO",
      startDate: "2026-09-29",
      endDate: "2026-10-04",
      firstName: null,
      recipientEmail: "person@example.com",
      rowState: "verified",
      recipientConfirmed: true,
      introductionSuitable: true,
      relationshipOutcome: "new_introduction",
      territoryStatus: "open",
      fitStatus: "approved",
    },
    availability: {
      ready: true,
      checkedAt: "2026-08-26T11:59:00.000Z",
      reviewVersion: 7,
      proposedStartDate: "2026-09-27",
      proposedEndDate: "2026-10-05",
      packageAvailability: {
        status: "resolved",
        packages: [{ packageKey: "adventure_zone", availableQuantity: 1 }],
        restrictedOptions: [],
      },
    },
    calendarEvidence: [],
    calendarReservations: [],
    blocks: [],
    approvedTemplate: {
      templateId: link.communicationTemplateId,
      code: "lead_introduction_2026_prepaid",
      version: link.templateVersion,
      sourceDocumentId: "55555555-5555-4555-8555-555555555555",
      sourceFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
      reviewedBy: "Amy",
      reviewedAt: "2026-08-25T00:00:00.000Z",
      definition: APPROVED_LEAD_INTRODUCTION_2026,
    },
    ...overrides,
  } as any;
}

function reservedLink(now = new Date("2026-08-26T12:00:00.000Z")): LeadGmailDraftLink {
  const preview = buildLeadEmailPreview({ ...readyState(), now });
  return { ...link, subject: preview.subject!, body: preview.body!, gmailDraftId: null, gmailMessageId: null, state: "prepared" };
}

function persistence(overrides: Partial<GmailDraftPersistence> = {}): GmailDraftPersistence {
  return {
    findByRow: vi.fn(async () => null),
    prepare: vi.fn(async (input) => {
      const lockedNow = input.now();
      const evidence = input.evaluate(readyState(), lockedNow);
      return { kind: "prepared" as const, link: { ...link, ...evidence, gmailDraftId: null, gmailMessageId: null, state: "prepared" as const } };
    }),
    execute: vi.fn(async (input) => {
      const lockedNow = input.now();
      const outcome = await input.attempt(readyState(), reservedLink(), lockedNow);
      return { ...link, state: outcome.kind === "created" ? "created" : outcome.kind, gmailDraftId: outcome.kind === "created" ? outcome.draftId : null, gmailMessageId: outcome.kind === "created" ? outcome.messageId : null, lastErrorCode: outcome.kind === "created" ? null : outcome.errorCode };
    }),
    ...overrides,
  };
}

describe("GmailDraftService", () => {
  it("returns an existing created link without another Gmail mutation", async () => {
    const store = persistence({ findByRow: vi.fn(async () => link) });
    const createGmailDraft = vi.fn();
    const service = new GmailDraftService({
      persistence: store,
      connection: { createGmailDraftClient: vi.fn(async () => ({ connectionId: link.googleConnectionId, client: { createGmailDraft } })) },
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });

    await expect(service.create({ rowId: link.rowId, expectedVersion: 7, actorId: "owner-1" }))
      .resolves.toEqual({ link, reused: true });
    expect(createGmailDraft).not.toHaveBeenCalled();
    expect(store.prepare).not.toHaveBeenCalled();
    expect(store.execute).not.toHaveBeenCalled();
  });

  it("defers freshness clock reads until each serialized persistence callback has the lock", async () => {
    const clock = vi.fn()
      .mockReturnValueOnce(new Date("2026-08-26T12:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-08-26T12:00:01.000Z"));
    const store = persistence({
      prepare: vi.fn(async (input) => {
        expect(clock).not.toHaveBeenCalled();
        const lockedNow = input.now();
        const rendered = input.evaluate(readyState(), lockedNow);
        return { kind: "prepared" as const, link: { ...reservedLink(), ...rendered } };
      }),
      execute: vi.fn(async (input) => {
        expect(clock).toHaveBeenCalledTimes(1);
        const lockedNow = input.now();
        const outcome = await input.attempt(readyState(), reservedLink(), lockedNow);
        if (outcome.kind !== "created") throw new Error("Expected created outcome");
        return { ...link, gmailDraftId: outcome.draftId, gmailMessageId: outcome.messageId };
      }),
    });
    const service = new GmailDraftService({
      persistence: store,
      connection: { createGmailDraftClient: vi.fn(async () => ({
        connectionId: link.googleConnectionId,
        client: { createGmailDraft: vi.fn(async () => ({ draftId: "gmail-draft-1", messageId: "gmail-message-1" })) },
      })) },
      now: clock,
    });

    await expect(service.create({ rowId: link.rowId, expectedVersion: 7, actorId: "owner-1" }))
      .resolves.toMatchObject({ link: { state: "created" } });
    expect(clock).toHaveBeenCalledTimes(2);
  });

  it("reloads current state and blocks a DO NOT SEND change immediately before Gmail", async () => {
    const execute = vi.fn(async (input: Parameters<GmailDraftPersistence["execute"]>[0]) => {
      const lockedNow = input.now();
      await input.attempt(readyState({
        blocks: [{ id: "block", targetType: "lead_import_row", rowId: link.rowId, active: true }],
      }), reservedLink(), lockedNow);
      throw new Error("unreachable");
    });
    const store = persistence({ execute });
    const createGmailDraft = vi.fn();
    const service = new GmailDraftService({
      persistence: store,
      connection: { createGmailDraftClient: vi.fn(async () => ({ connectionId: link.googleConnectionId, client: { createGmailDraft } })) },
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });

    await expect(service.create({ rowId: link.rowId, expectedVersion: 7, actorId: "owner-1" }))
      .rejects.toMatchObject({ code: "NOT_READY", blockers: ["do_not_send"] });
    expect(createGmailDraft).not.toHaveBeenCalled();
  });

  it("rejects a stale expected review version before Gmail", async () => {
    const store = persistence({
      prepare: vi.fn(async () => {
        throw new GmailDraftServiceError("VERSION_CONFLICT", "Reload the lead.", { expectedVersion: 7, currentVersion: 8 });
      }),
    });
    const createGmailDraft = vi.fn();
    const service = new GmailDraftService({
      persistence: store,
      connection: { createGmailDraftClient: vi.fn(async () => ({ connectionId: link.googleConnectionId, client: { createGmailDraft } })) },
    });

    await expect(service.create({ rowId: link.rowId, expectedVersion: 7, actorId: "owner-1" }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(createGmailDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["GOOGLE_WORKSPACE_GMAIL_DRAFT_CREATE_FAILED", "retryable_error"],
    ["GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN", "manual_review"],
  ] as const)("classifies %s without an automatic Gmail retry", async (errorCode, expectedState) => {
    const createGmailDraft = vi.fn(async () => {
      throw Object.assign(new Error(errorCode), { code: errorCode });
    });
    let capturedState = "";
    const store = persistence({
      execute: vi.fn(async (input) => {
        const lockedNow = input.now();
        const outcome = await input.attempt(readyState(), reservedLink(), lockedNow);
        if (outcome.kind === "created") throw new Error("Expected a classified failure");
        capturedState = outcome.kind;
        return { ...reservedLink(), state: outcome.kind, lastErrorCode: outcome.errorCode };
      }),
    });
    const service = new GmailDraftService({
      persistence: store,
      connection: { createGmailDraftClient: vi.fn(async () => ({ connectionId: link.googleConnectionId, client: { createGmailDraft } })) },
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });

    await expect(service.create({ rowId: link.rowId, expectedVersion: 7, actorId: "owner-1" }))
      .rejects.toMatchObject({ code: errorCode });
    expect(capturedState).toBe(expectedState);
    expect(createGmailDraft).toHaveBeenCalledTimes(1);
  });
});
