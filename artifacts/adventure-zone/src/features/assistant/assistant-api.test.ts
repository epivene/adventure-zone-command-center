import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
const cache = vi.hoisted(() => ({
  getAssistantSnapshot: vi.fn(),
  saveAssistantSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => auth);
vi.mock("./assistant-offline-cache", () => cache);

import { askBookingAssistant } from "./assistant-api";

describe("askBookingAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.saveAssistantSnapshot.mockResolvedValue(undefined);
    auth.apiPost.mockResolvedValue({
      answer: {
        text: "The event starts at 10:00 AM.",
        mode: "deterministic",
        confidence: "high",
        sources: [],
        needsAdmin: false,
      },
      brief: { headline: "Miles City", items: [], generatedAt: "2026-08-18T00:00:00Z" },
      context: {
        context: { kind: "booking", recordId: "2b277ed7-6a50-4bc4-a0ba-357dfdcb4bb9", label: "Miles City" },
        sources: [],
        generatedAt: "2026-08-18T00:00:00Z",
      },
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("sends the browser IANA time zone so saved booking times are formatted like the app", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      locale: "en-US",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "America/Denver",
      hourCycle: "h12",
      hour12: true,
    });

    await askBookingAssistant({
      context: {
        kind: "booking",
        recordId: "2b277ed7-6a50-4bc4-a0ba-357dfdcb4bb9",
        label: "Miles City",
      },
      question: "What time is the event?",
    });

    expect(auth.apiPost).toHaveBeenCalledWith("/assistant/ask", {
      conversationId: undefined,
      contextKind: "booking",
      contextRecordId: "2b277ed7-6a50-4bc4-a0ba-357dfdcb4bb9",
      question: "What time is the event?",
      timeZone: "America/Denver",
    });
  });
});
