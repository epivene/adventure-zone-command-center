import { it, expect } from "vitest";
import {
  parseCommercialAction,
  assertCommercialScope,
  confirmationFor,
} from "./commercial-actions";
const org = "11111111-1111-4111-8111-111111111111",
  booking = "22222222-2222-4222-8222-222222222222";
it("requires reviewed payment evidence and blocks inferred status fields", () => {
  expect(() =>
    parseCommercialAction("record_invoice_payment", {
      organizationId: org,
      eventYear: 2027,
      amountCents: 382500,
      receivedDate: "2026-09-24",
      method: "check",
      receiptReference: "",
    }),
  ).toThrow();
  expect(() =>
    parseCommercialAction("record_invoice_payment", {
      organizationId: org,
      eventYear: 2027,
      amountCents: 382500,
      receivedDate: "2026-09-24",
      method: "check",
      receiptReference: "Bank receipt 123",
      paid: true,
    }),
  ).toThrow();
  expect(confirmationFor("record_invoice_payment")).toBe("payment_received");
  expect(confirmationFor("confirm_signed_contract")).toBe(
    "signatures_reviewed",
  );
});
it("freezes mutations to the target customer and canonical event year", () => {
  expect(() =>
    assertCommercialScope(
      { organizationIds: [org], eventYear: 2027 } as any,
      { organization_id: org, event_year: 2027 },
      { organizationId: org, eventYear: 2027 },
    ),
  ).not.toThrow();
  expect(() =>
    assertCommercialScope(
      { organizationIds: [org], eventYear: 2028 } as any,
      { organization_id: org, event_year: 2027 },
      { organizationId: org, eventYear: 2028 },
    ),
  ).toThrow("ASSISTANT_EVENT_YEAR_MISMATCH");
  expect(() =>
    assertCommercialScope(
      { organizationIds: [org], eventYear: 2027 } as any,
      { organization_id: booking, event_year: 2027 },
      { organizationId: org, eventYear: 2027 },
    ),
  ).toThrow("ASSISTANT_TARGET_NOT_IN_BATCH");
});
