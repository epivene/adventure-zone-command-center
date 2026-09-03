import { describe, expect, it, vi } from "vitest";

import {
  WebsiteInquiryNotFoundError,
  WebsiteInquiryReviewService,
  WebsiteInquiryTransitionError,
  type WebsiteInquiryActor,
  type WebsiteInquiryReviewRepository,
  type WebsiteInquiryStatusTransaction,
} from "./website-inquiry-review-service";

const actor: WebsiteInquiryActor = {
  kind: "office",
  id: "amy-id",
  name: "Amy",
};
const inquiryId = "20000000-0000-4000-8000-000000000002";
const createdAt = new Date("2026-09-03T16:00:00.000Z");

function record(
  status: "new" | "reviewing" | "archived" | "spam" | "converted" = "new",
) {
  return {
    id: inquiryId,
    submissionId: "10000000-0000-4000-8000-000000000001",
    referenceCode: "AZI-2026-AAAAAAAA",
    status,
    name: "Desie Example",
    email: "desie@example.com",
    eventName: "Summer Festival",
    eventDate: "2027-07-04",
    eventLocation: "Denver, CO",
    packageInterest: "Adventure Zone",
    message: "Please send availability.",
    pageUrl: "https://the-adventure-zone.com/#contact",
    sourceOrigin: "https://the-adventure-zone.com",
    reviewedByKind: null,
    reviewedById: null,
    reviewedByName: null,
    reviewedAt: null,
    convertedContactId: null,
    convertedOrganizationId: null,
    convertedBookingId: null,
    convertedAt: null,
    alertState: "sent" as const,
    alertAttemptCount: 1,
    alertLastAttemptAt: createdAt,
    alertFailureReason: null,
    alertDeliveredRecipients: ["owner@example.com"],
    createdAt,
    updatedAt: createdAt,
  };
}

function setup(status: "new" | "reviewing" | "archived" | "spam" | "converted" = "new") {
  const stored = record(status);
  const transaction: WebsiteInquiryStatusTransaction = {
    getForUpdate: vi.fn(async () => stored),
    updateStatus: vi.fn(async (input) => ({
      ...stored,
      status: input.status,
      reviewedByKind: input.actor.kind,
      reviewedById: input.actor.id,
      reviewedByName: input.actor.name,
      reviewedAt: input.now,
      updatedAt: input.now,
    })),
    recordAuditEntry: vi.fn(async () => undefined),
  };
  const repository: WebsiteInquiryReviewRepository = {
    list: vi.fn(async () => ({ items: [stored], nextCursor: null })),
    countNew: vi.fn(async () => 4),
    getDetail: vi.fn(async () => ({ inquiry: stored, auditHistory: [] })),
    runStatusTransaction: vi.fn(async (operation) => operation(transaction)),
  };
  const service = new WebsiteInquiryReviewService({
    repository,
    now: () => new Date("2026-09-03T18:00:00.000Z"),
  });
  return { repository, service, stored, transaction };
}

describe("WebsiteInquiryReviewService", () => {
  it("requests newest-first status pagination and exposes the next cursor", async () => {
    const h = setup();
    await h.service.list({
      status: "new",
      cursor: "2026-09-03T16:00:00.000Z,20000000-0000-4000-8000-000000000002",
      limit: 25,
    });
    expect(h.repository.list).toHaveBeenCalledWith({
      status: "new",
      before: {
        createdAt: new Date("2026-09-03T16:00:00.000Z"),
        id: inquiryId,
      },
      limit: 25,
    });
  });

  it("counts only new inquiries and loads detail with audit history", async () => {
    const h = setup();
    await expect(h.service.count()).resolves.toEqual({ newCount: 4 });
    await expect(h.service.detail(inquiryId)).resolves.toEqual({
      inquiry: h.stored,
      auditHistory: [],
    });
  });

  it.each([
    ["new", "begin_review", "reviewing"],
    ["new", "archive", "archived"],
    ["reviewing", "archive", "archived"],
    ["new", "spam", "spam"],
    ["reviewing", "spam", "spam"],
    ["archived", "restore", "new"],
    ["spam", "restore", "new"],
  ] as const)("changes %s with %s to %s and audits the actor", async (from, action, to) => {
    const h = setup(from);
    await expect(
      h.service.changeStatus({ inquiryId, action, actor }),
    ).resolves.toMatchObject({ status: to });
    expect(h.transaction.recordAuditEntry).toHaveBeenCalledWith({
      entityType: "website_inquiry",
      entityId: inquiryId,
      action,
      before: { status: from },
      after: {
        status: to,
        actor: { kind: "office", id: "amy-id", name: "Amy" },
      },
    });
  });

  it.each([
    ["new", "restore"],
    ["reviewing", "begin_review"],
    ["archived", "archive"],
    ["spam", "spam"],
    ["converted", "archive"],
  ] as const)("rejects the invalid %s -> %s transition", async (status, action) => {
    const h = setup(status);
    await expect(
      h.service.changeStatus({ inquiryId, action, actor }),
    ).rejects.toBeInstanceOf(WebsiteInquiryTransitionError);
    expect(h.transaction.updateStatus).not.toHaveBeenCalled();
  });

  it("returns not found without writing an audit entry", async () => {
    const h = setup();
    vi.mocked(h.transaction.getForUpdate).mockResolvedValueOnce(null);
    await expect(
      h.service.changeStatus({ inquiryId, action: "archive", actor }),
    ).rejects.toBeInstanceOf(WebsiteInquiryNotFoundError);
    expect(h.transaction.recordAuditEntry).not.toHaveBeenCalled();
  });
});
