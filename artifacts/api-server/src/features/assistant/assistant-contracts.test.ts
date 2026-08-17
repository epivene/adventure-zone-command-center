import { describe, expect, it } from "vitest";

import {
  askBookingAssistantInputSchema,
  getAssistantContextInputSchema,
} from "./assistant-input";
import {
  assistantContextKindValues,
  assistantSourceKindValues,
  serializeAssistantSource,
} from "./assistant-types";

describe("booking assistant contracts", () => {
  it("supports only approved context and source kinds", () => {
    expect(assistantContextKindValues).toEqual([
      "organization",
      "contact",
      "event_family",
      "booking",
      "calendar_event",
      "route",
      "call_workspace",
    ]);
    expect(assistantSourceKindValues).toContain("business_knowledge");
    expect(assistantSourceKindValues).toContain("derived_fact");
  });

  it("serializes source dates as JSON-safe strings", () => {
    expect(
      serializeAssistantSource({
        id: "src_1",
        kind: "booking",
        recordId: "4fbc77e5-5453-42af-9316-b0ea6ca91ae5",
        label: "2025 County Fair",
        occurredAt: new Date("2025-07-10T12:00:00.000Z"),
      }),
    ).toEqual({
      id: "src_1",
      kind: "booking",
      recordId: "4fbc77e5-5453-42af-9316-b0ea6ca91ae5",
      label: "2025 County Fair",
      occurredAt: "2025-07-10T12:00:00.000Z",
    });
  });

  it("validates canonical assistant context requests", () => {
    expect(
      getAssistantContextInputSchema.parse({
        contextKind: "booking",
        contextRecordId: "4FBC77E5-5453-42AF-9316-B0EA6CA91AE5",
      }),
    ).toEqual({
      contextKind: "booking",
      contextRecordId: "4fbc77e5-5453-42af-9316-b0ea6ca91ae5",
    });
  });

  it("rejects blank or unbounded assistant questions", () => {
    const base = {
      contextKind: "booking" as const,
      contextRecordId: "4fbc77e5-5453-42af-9316-b0ea6ca91ae5",
    };
    expect(
      askBookingAssistantInputSchema.safeParse({ ...base, question: "   " }).success,
    ).toBe(false);
    expect(
      askBookingAssistantInputSchema.safeParse({
        ...base,
        question: "x".repeat(4001),
      }).success,
    ).toBe(false);
  });

  it("accepts an optional conversation id and trims the question", () => {
    expect(
      askBookingAssistantInputSchema.parse({
        conversationId: "5AE2CFC4-EA1F-49C3-A9CE-A0EA9FA25F4A",
        contextKind: "organization",
        contextRecordId: "4FBC77E5-5453-42AF-9316-B0EA6CA91AE5",
        question: "  What happened last year?  ",
      }),
    ).toEqual({
      conversationId: "5ae2cfc4-ea1f-49c3-a9ce-a0ea9fa25f4a",
      contextKind: "organization",
      contextRecordId: "4fbc77e5-5453-42af-9316-b0ea6ca91ae5",
      question: "What happened last year?",
    });
  });
});
