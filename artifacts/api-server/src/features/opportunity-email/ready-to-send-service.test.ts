import { describe, expect, it, vi } from "vitest";

import { ReadyToSendService } from "./ready-to-send-service";
import type { OpportunityEmailRecord } from "./opportunity-email-types";

const NOW = new Date("2026-08-27T18:00:00.000Z");
const SCHEDULED = new Date("2026-08-28T14:00:00.000Z");

function draft(id: string, purpose: OpportunityEmailRecord["purpose"], state: OpportunityEmailRecord["state"] = "draft"): OpportunityEmailRecord {
  return {
    id,
    opportunityId: `11111111-1111-4111-8111-${id.padStart(12, "0")}`,
    organizationId: `22222222-2222-4222-8222-${id.padStart(12, "0")}`,
    contactId: null,
    eventYear: 2026,
    purpose,
    state,
    gmailDraftId: `gmail-${id}`,
    gmailMessageId: null,
    gmailThreadId: null,
    recipientEmail: `${id}@example.com`,
    recipientName: null,
    subject: `Subject ${id}`,
    body: `Body ${id}`,
    scheduledFor: state === "scheduled" ? SCHEDULED : null,
    sentAt: state === "sent" ? NOW : null,
    lastFailureCode: state === "failed" ? "SEND_FAILED" : null,
    lastFailureMessage: state === "failed" ? "Could not send" : null,
    sendRequestKey: null,
    scheduleRequestKey: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function source(rows: Array<{ draft: OpportunityEmailRecord; eventName?: string; opportunityStatus?: string; ownerVisible?: boolean; blocked?: boolean; warning?: string | null }>) {
  const normalized = rows.map((row) => ({
    draft: row.draft,
    eventName: row.eventName ?? `Event ${row.draft.id}`,
    opportunityStatus: row.opportunityStatus ?? "ready_to_contact",
    ownerVisible: row.ownerVisible ?? true,
    blocked: row.blocked ?? false,
    warning: row.warning ?? null,
  }));
  return {
    list: vi.fn(async () => normalized),
    get: vi.fn(async (id: string) => normalized.find((row) => row.draft.id === id) ?? null),
  };
}

describe("ReadyToSendService", () => {
  it("summarizes routine draft/scheduled/failed rows and excludes sent/cancelled rows", async () => {
    const src = source([
      { draft: draft("1", "new_outreach") },
      { draft: draft("2", "follow_up", "scheduled") },
      { draft: draft("3", "reply", "failed") },
      { draft: draft("4", "new_outreach", "sent") },
      { draft: draft("5", "new_outreach", "cancelled") },
    ]);
    const service = new ReadyToSendService({ source: src, delivery: {} as any });

    const summary = await service.summary();

    expect(summary).toMatchObject({ total: 3, newOutreach: 1, followUps: 1, replies: 1 });
    expect(summary.items.map((item) => item.draftId)).toEqual(["1", "2", "3"]);
    expect(summary.items[2]?.warning).toBe("Could not send");
  });

  it("prevalidates every selected draft before any bulk send begins", async () => {
    const src = source([
      { draft: draft("1", "new_outreach") },
      { draft: draft("2", "follow_up"), ownerVisible: false },
    ]);
    const delivery = { sendDraft: vi.fn() };
    const service = new ReadyToSendService({ source: src, delivery: delivery as any });

    await expect(service.sendSelected([
      { draftId: "1", opportunityId: draft("1", "new_outreach").opportunityId, requestKey: "send-1" },
      { draftId: "2", opportunityId: draft("2", "follow_up").opportunityId, requestKey: "send-2" },
    ])).rejects.toThrow("READY_TO_SEND_SELECTION_INVALID");

    expect(delivery.sendDraft).not.toHaveBeenCalled();
  });

  it("prevalidates opportunity ownership, blockers, and eligible state", async () => {
    const blocked = draft("2", "follow_up");
    const src = source([
      { draft: draft("1", "new_outreach") },
      { draft: blocked, blocked: true },
      { draft: draft("3", "reply", "sent") },
    ]);
    const delivery = { sendDraft: vi.fn() };
    const service = new ReadyToSendService({ source: src, delivery: delivery as any });

    await expect(service.sendSelected([
      { draftId: "1", opportunityId: "99999999-9999-4999-8999-999999999999", requestKey: "wrong-opportunity" },
      { draftId: "2", opportunityId: blocked.opportunityId, requestKey: "blocked" },
      { draftId: "3", opportunityId: draft("3", "reply", "sent").opportunityId, requestKey: "sent" },
    ])).rejects.toThrow("READY_TO_SEND_SELECTION_INVALID");

    expect(delivery.sendDraft).not.toHaveBeenCalled();
  });

  it("keeps successful bulk sends successful when a later item fails", async () => {
    const first = draft("1", "new_outreach");
    const second = draft("2", "follow_up");
    const src = source([{ draft: first }, { draft: second }]);
    const delivery = {
      sendDraft: vi.fn()
        .mockResolvedValueOnce({ draft: { ...first, state: "sent" }, followUpReferenceAt: NOW })
        .mockRejectedValueOnce(Object.assign(new Error("failed"), { code: "SEND_FAILED" })),
    };
    const service = new ReadyToSendService({ source: src, delivery: delivery as any });

    const results = await service.sendSelected([
      { draftId: "1", opportunityId: first.opportunityId, requestKey: "send-1" },
      { draftId: "2", opportunityId: second.opportunityId, requestKey: "send-2" },
    ]);

    expect(results).toEqual([
      { draftId: "1", ok: true },
      { draftId: "2", ok: false, error: "SEND_FAILED" },
    ]);
    expect(delivery.sendDraft).toHaveBeenCalledTimes(2);
  });

  it("bulk schedules explicit timestamps after the same all-items prevalidation", async () => {
    const first = draft("1", "new_outreach");
    const second = draft("2", "follow_up");
    const src = source([{ draft: first }, { draft: second }]);
    const delivery = { scheduleDraft: vi.fn(async () => ({ draft: first, followUpReferenceAt: SCHEDULED })) };
    const service = new ReadyToSendService({ source: src, delivery: delivery as any });

    const results = await service.scheduleSelected([
      { draftId: "1", opportunityId: first.opportunityId, requestKey: "schedule-1", scheduledFor: SCHEDULED },
      { draftId: "2", opportunityId: second.opportunityId, requestKey: "schedule-2", scheduledFor: new Date("2026-08-28T14:30:00.000Z") },
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(delivery.scheduleDraft).toHaveBeenCalledTimes(2);
  });
});
