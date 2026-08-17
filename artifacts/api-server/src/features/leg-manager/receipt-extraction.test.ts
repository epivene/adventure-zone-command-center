import { describe, expect, it } from "vitest";
import { parseReceiptSuggestions } from "./receipt-extraction";

describe("parseReceiptSuggestions", () => {
  it("normalizes valid receipt JSON", () => {
    expect(parseReceiptSuggestions('{"merchant":"Pilot Travel Center","totalCents":4876,"taxCents":276,"occurredAt":"2026-08-17"}')).toEqual({
      merchant: "Pilot Travel Center",
      totalCents: 4876,
      taxCents: 276,
      occurredAt: "2026-08-17",
    });
  });

  it("accepts fenced JSON", () => {
    expect(parseReceiptSuggestions('```json\n{"merchant":"Store","totalCents":1200,"taxCents":null,"occurredAt":null}\n```')).toEqual({
      merchant: "Store",
      totalCents: 1200,
      taxCents: null,
      occurredAt: null,
    });
  });

  it("falls back to empty suggestions for malformed or unsafe values", () => {
    expect(parseReceiptSuggestions("not json")).toEqual({ merchant: null, totalCents: null, taxCents: null, occurredAt: null });
    expect(parseReceiptSuggestions('{"merchant":"Store","totalCents":-5}')).toEqual({ merchant: null, totalCents: null, taxCents: null, occurredAt: null });
  });
});
