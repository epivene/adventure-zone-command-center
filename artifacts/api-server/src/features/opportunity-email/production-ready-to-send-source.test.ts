import { describe, expect, it, vi } from "vitest";

import { ProductionReadyToSendSource } from "./production-ready-to-send-source";
import type { OpportunityEmailRecord } from "./opportunity-email-types";

const now = new Date("2026-08-27T18:00:00.000Z");
function draft(overrides: Partial<OpportunityEmailRecord> = {}): OpportunityEmailRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    opportunityId: "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    contactId: null,
    eventYear: 2026,
    purpose: "new_outreach",
    state: "draft",
    gmailDraftId: "gmail-draft-1",
    gmailMessageId: "gmail-message-1",
    gmailThreadId: null,
    recipientEmail: "booking@example.com",
    recipientName: "Casey",
    subject: "Subject",
    body: "Body",
    scheduledFor: null,
    sentAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    sendRequestKey: null,
    scheduleRequestKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function dependencies() {
  const current = draft();
  return {
    emails: {
      listReadyToSend: vi.fn(async () => [current]),
      getById: vi.fn(async (id: string) => id === current.id ? current : null),
    },
    opportunities: {
      get: vi.fn(async () => ({
        id: current.opportunityId,
        organizationId: current.organizationId,
        eventYear: 2026,
        bookingId: null,
        contactId: null,
        status: "ready_to_contact",
        emailAutomationProtected: false,
        territoryExceptionApproved: false,
      })),
    },
    profiles: {
      name: vi.fn(async () => "Sample County Fair"),
    },
  };
}

describe("ProductionReadyToSendSource", () => {
  it("projects current email state with Opportunity status and event name", async () => {
    const source = new ProductionReadyToSendSource(dependencies());
    await expect(source.list()).resolves.toEqual([
      expect.objectContaining({
        eventName: "Sample County Fair",
        opportunityStatus: "ready_to_contact",
        ownerVisible: true,
        blocked: false,
      }),
    ]);
  });

  it.each(["needs_review", "declined", "not_pursuing", "territory_hold"])(
    "blocks bulk delivery when the Opportunity is %s",
    async (status) => {
      const deps = dependencies();
      deps.opportunities.get.mockResolvedValue({
        ...(await deps.opportunities.get()),
        status,
      });
      const [row] = await new ProductionReadyToSendSource(deps).list();
      expect(row).toEqual(expect.objectContaining({ blocked: true, warning: expect.any(String) }));
    },
  );

  it("blocks protected records even when the Opportunity status is otherwise sendable", async () => {
    const deps = dependencies();
    deps.opportunities.get.mockResolvedValue({
      ...(await deps.opportunities.get()),
      emailAutomationProtected: true,
    });
    const row = await new ProductionReadyToSendSource(deps).get(draft().id);
    expect(row).toEqual(expect.objectContaining({ blocked: true }));
  });

  it("returns null when the draft or Opportunity no longer exists", async () => {
    const deps = dependencies();
    deps.emails.getById.mockResolvedValue(null);
    await expect(new ProductionReadyToSendSource(deps).get(draft().id)).resolves.toBeNull();
  });
});
