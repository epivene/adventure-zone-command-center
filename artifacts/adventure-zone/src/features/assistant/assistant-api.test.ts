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

function mockDenverTimeZone() {
  return vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    locale: "en-US",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "America/Denver",
    hourCycle: "h12",
    hour12: true,
  });
}

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
    mockDenverTimeZone();

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

  it("answers a named event schedule from the saved context while offline", async () => {
    mockDenverTimeZone();
    auth.apiPost.mockRejectedValue(new Error("offline"));
    cache.getAssistantSnapshot.mockResolvedValue({
      key: "owner:event_family:family-1",
      actorId: "owner",
      kind: "event_family",
      recordId: "family-1",
      label: "County Fair",
      savedAt: "2026-08-18T00:00:00Z",
      brief: { headline: "County Fair", items: [], generatedAt: "2026-08-18T00:00:00Z" },
      context: {
        context: { kind: "event_family", recordId: "family-1", label: "County Fair" },
        currentBooking: {
          id: "current",
          label: "County Fair 2026",
          startsAt: "2026-07-10T12:00:00.000Z",
          endsAt: "2026-07-10T20:00:00.000Z",
          venueName: "Stark County Fairgrounds",
          city: "Dickinson",
          region: "ND",
        },
        priorBookings: [
          {
            id: "prior",
            label: "County Fair 2025",
            startsAt: "2025-07-10T12:00:00.000Z",
            endsAt: "2025-07-10T20:00:00.000Z",
            venueName: "Eastern Montana Fairgrounds",
            city: "Miles City",
            region: "MT",
          },
        ],
        sources: [
          {
            id: "src-prior",
            kind: "booking",
            recordId: "prior",
            label: "County Fair 2025",
            occurredAt: "2025-07-10T12:00:00.000Z",
          },
        ],
        generatedAt: "2026-08-18T00:00:00Z",
      },
    });

    const result = await askBookingAssistant({
      context: { kind: "event_family", recordId: "family-1", label: "County Fair" },
      question: "What time was the Miles City event?",
    });

    expect(result.answer.mode).toBe("offline_cached");
    expect(result.answer.text).toMatch(/Miles City, MT/i);
    expect(result.answer.text).toMatch(/6:00 AM/i);
    expect(result.answer.text).toMatch(/2:00 PM/i);
    expect(result.answer.sources.map((source) => source.id)).toEqual(["src-prior"]);
  });
});
