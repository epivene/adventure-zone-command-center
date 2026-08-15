import { describe, expect, it } from "vitest";
import type { AiCompletionClient } from "@/features/ai-suggestions/ai-client";
import { eventFamilyAiInternals, suggestEventFamiliesWithAi } from "./event-family-ai";

const candidates = [
  { id: "a", name: "Spring Celebration", placeType: "festival_event", city: "A", region: "ND", email: "private@example.com", phone: "555-1111", notes: "private note" },
  { id: "b", name: "Spring Fest", placeType: "festival_event", city: "B", region: "ND", email: "hidden@example.com", phone: "555-2222", notes: "another note" },
];

function fakeClient(raw: string, capture?: (prompt: string) => void): AiCompletionClient {
  return {
    providerName: "test",
    async complete(prompt) {
      capture?.(prompt);
      return raw;
    },
  };
}

describe("event family AI", () => {
  it("sends only the allowed candidate fields", async () => {
    let prompt = "";
    await suggestEventFamiliesWithAi(
      fakeClient("[]", (value) => { prompt = value; }),
      candidates,
    );
    expect(prompt).toContain("Spring Celebration");
    expect(prompt).not.toContain("private@example.com");
    expect(prompt).not.toContain("555-1111");
    expect(prompt).not.toContain("private note");
  });

  it("accepts fenced JSON and normalizes the proposal", async () => {
    const result = await suggestEventFamiliesWithAi(
      fakeClient('```json\n[{"proposedName":"Spring Festivals","candidateIds":["a","b"],"confidence":0.9,"reason":"same recurring event type"}]\n```'),
      candidates,
    );
    expect(result).toEqual([
      {
        proposedName: "Spring Festivals",
        normalizedName: "spring festivals",
        candidateIds: ["a", "b"],
        source: "ai",
        confidence: 0.9,
        reason: "same recurring event type",
      },
    ]);
  });

  it("drops malformed, unknown, singleton, and overlapping groups", async () => {
    await expect(suggestEventFamiliesWithAi(fakeClient("not json"), candidates)).resolves.toEqual([]);
    await expect(suggestEventFamiliesWithAi(fakeClient('[{"proposedName":"X","candidateIds":["a","unknown"],"confidence":0.8,"reason":"x"}]'), candidates)).resolves.toEqual([]);
    await expect(suggestEventFamiliesWithAi(fakeClient('[{"proposedName":"X","candidateIds":["a","a"],"confidence":0.8,"reason":"x"}]'), candidates)).resolves.toEqual([]);
  });

  it("strips at most one markdown fence", () => {
    expect(eventFamilyAiInternals.stripSingleFence("```json\n[]\n```")).toBe("[]");
  });
});
