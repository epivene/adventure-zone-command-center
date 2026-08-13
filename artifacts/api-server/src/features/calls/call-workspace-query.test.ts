import { describe, expect, it } from "vitest";

import { loadCallWorkspace } from "./call-workspace-query";

const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";
const bookingId = "30000000-0000-4000-8000-000000000001";
const followUpId = "40000000-0000-4000-8000-000000000001";
const phoneId = "50000000-0000-4000-8000-000000000001";

describe("loadCallWorkspace", () => {
  it("returns server-derived calling context without deriving a route from a phone number", async () => {
    const lastContactedAt = new Date("2026-08-11T16:00:00.000Z");
    const phone = { id: phoneId, contactId, number: "701-555-0100", normalizedNumber: "7015550100", type: "office" as const, extension: "12", label: "Front desk", primary: true, source: "local", doNotCallAt: null, doNotCallReason: null };
    const contextRepository = {
      findOrganization: async () => ({ id: organizationId, name: "Acme Venue", lastResort: false, lastResortReason: null }),
      findContact: async () => ({ id: contactId, organizationId, firstName: "Avery", lastName: "Lee", email: "avery@example.test", phone: phone.number, city: "Fargo", region: "ND" }),
      findBooking: async () => ({ id: bookingId, organizationId, primaryContactId: contactId, name: "Fall Festival", city: "Fargo", region: "ND", status: "pending_contract" as const, startsAt: new Date("2026-09-20T15:00:00.000Z") }),
      findFollowUp: async () => ({ id: followUpId, organizationId, contactId, bookingId, kind: "check_contract", dueAt: new Date("2026-08-13T15:00:00.000Z") }),
      hasActiveOrganizationContact: async () => true,
      hasBookingContact: async () => true,
      findLastContactedAt: async () => lastContactedAt,
    };
    const phoneAndOperationsProvider = {
      listForContact: async () => [phone],
      getForBooking: async () => ({ packageNames: [], sharedAttractionTotal: null, pendingRequestCount: 0, leg: { id: "60000000-0000-4000-8000-000000000001", name: "Northern route", color: "#2563eb" }, warnings: [] }),
    };

    const result = await loadCallWorkspace(
      { organizationId, contactId, bookingId, followUpId },
      contextRepository as never,
      phoneAndOperationsProvider as never,
      phoneAndOperationsProvider as never,
    );

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        phones: [phone],
        contextSummary: {
          bookingStatus: "pending_contract",
          bookingStatusLabel: "Pending Contract",
          travelLeg: { id: "60000000-0000-4000-8000-000000000001", name: "Northern route", color: "#2563eb" },
          lastContactedAt,
        },
        defaultScriptKind: "contract_follow_up",
        scriptPrompts: [
          "Confirm they received the proposal or contract",
          "Ask whether anything needs clarification",
          "Confirm deposit and decision timing",
          "Agree on the next step",
        ],
      }),
    });
  });
});
