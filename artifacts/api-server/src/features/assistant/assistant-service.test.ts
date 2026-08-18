import { describe, expect, it } from "vitest";

import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";
import { AssistantService } from "./assistant-service";
import type { BookingAssistantContextBundle } from "./assistant-types";

function context(): BookingAssistantContextBundle {
  return {
    context: { kind: "booking", recordId: "booking-1", label: "County Fair" },
    profile: { organizationId: "org-1", contactIds: [], contacts: [], eventFamilyId: null },
    currentBooking: {
      id: "booking-1",
      label: "County Fair",
      startsAt: "2026-07-10T12:00:00.000Z",
      status: "possible",
      physicalAttractionTotal: 10,
      packageNames: ["Adventure Zone"],
      specialResourceNames: [],
    },
    priorBookings: [
      {
        id: "booking-0",
        label: "County Fair 2025",
        startsAt: "2025-07-10T12:00:00.000Z",
        status: "completed",
        physicalAttractionTotal: 12,
        packageNames: ["Adventure Zone", "Pirate's Rebellion"],
        specialResourceNames: [],
      },
    ],
    recentActivities: [],
    openFollowUps: [],
    packageHistorySignals: [
      { kind: "usual_package_mix", packageNames: ["Adventure Zone", "Pirate's Rebellion"], sourceBookingIds: ["booking-0"] },
    ],
    routeContext: null,
    derivedFacts: [],
    businessKnowledge: [],
    sources: [
      { id: "src_booking_booking-1", kind: "booking", recordId: "booking-1", label: "County Fair", occurredAt: "2026-07-10T12:00:00.000Z" },
      { id: "src_booking_booking-0", kind: "booking", recordId: "booking-0", label: "County Fair 2025", occurredAt: "2025-07-10T12:00:00.000Z" },
    ],
    generatedAt: "2026-08-17T21:00:00.000Z",
  };
}

function ai(response: string): AiCompletionClient {
  return { providerName: "fake", complete: async () => response };
}

describe("AssistantService", () => {
  it("bypasses cloud AI for deterministic questions", async () => {
    let calls = 0;
    const service = new AssistantService({
      loadContext: async () => context(),
      createAiClient: async () => ({ providerName: "fake", complete: async () => { calls += 1; return "{}"; } }),
    });
    const result = await service.ask({
      contextKind: "booking",
      contextRecordId: "booking-1",
      question: "What do they normally book?",
    });
    expect(result.answer.mode).toBe("deterministic");
    expect(calls).toBe(0);
  });

  it("uses the staff device time zone for deterministic booking schedule answers", async () => {
    let calls = 0;
    const service = new AssistantService({
      loadContext: async () => context(),
      createAiClient: async () => ({ providerName: "fake", complete: async () => { calls += 1; return "{}"; } }),
    });

    const result = await service.ask({
      contextKind: "booking",
      contextRecordId: "booking-1",
      question: "What time does this event start?",
      timeZone: "America/Denver",
    });

    expect(result.answer.mode).toBe("deterministic");
    expect(result.answer.text).toMatch(/6:00 AM/i);
    expect(result.answer.text).toMatch(/MDT/i);
    expect(calls).toBe(0);
  });

  it("returns a source-validated cloud answer for harder questions", async () => {
    const service = new AssistantService({
      loadContext: async () => context(),
      createAiClient: async () => ai(JSON.stringify({
        text: "Ask whether they want to restore Pirate's Rebellion this year.",
        confidence: "medium",
        sourceIds: ["src_booking_booking-0"],
      })),
    });
    const result = await service.ask({
      contextKind: "booking",
      contextRecordId: "booking-1",
      question: "What should I ask when I call?",
    });
    expect(result.answer.mode).toBe("cloud");
    expect(result.answer.sources.map((source) => source.id)).toEqual([
      "src_booking_booking-0",
    ]);
  });

  it("rejects unknown source ids from cloud output", async () => {
    const service = new AssistantService({
      loadContext: async () => context(),
      createAiClient: async () => ai(JSON.stringify({
        text: "Unsupported claim",
        confidence: "high",
        sourceIds: ["src_fake_missing"],
      })),
    });
    const result = await service.ask({
      contextKind: "booking",
      contextRecordId: "booking-1",
      question: "What should I ask when I call?",
    });
    expect(result.answer.mode).toBe("deterministic");
    expect(result.answer.confidence).toBe("low");
    expect(result.answer.text).toMatch(/can't support/i);
  });

  it("falls back safely when the provider is unavailable or malformed", async () => {
    for (const createAiClient of [
      async () => { throw Object.assign(new Error("not configured"), { code: "NO_AI_PROVIDER_CONFIGURED" }); },
      async () => ai("not json"),
    ]) {
      const service = new AssistantService({
        loadContext: async () => context(),
        createAiClient,
      });
      const result = await service.ask({
        contextKind: "booking",
        contextRecordId: "booking-1",
        question: "Draft a strategy for the next call",
      });
      expect(result.answer.mode).toBe("deterministic");
      expect(result.answer.text).toMatch(/saved records|deeper ai/i);
    }
  });
});
