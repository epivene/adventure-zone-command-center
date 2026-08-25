import { describe, expect, it } from "vitest";

import { routeLocalAssistantQuestion } from "./on-device-ai-router";

describe("routeLocalAssistantQuestion", () => {
  it.each([
    "What time is the event?",
    "What date is the booking?",
    "When is the County Fair?",
    "Who should I call?",
    "Who is the primary contact?",
    "What follow up is due?",
    "What's the next action?",
    "What do they usually book?",
    "What happened last year?",
    "What did they book last year?",
  ])("keeps exact cached questions deterministic: %s", (question) => {
    expect(routeLocalAssistantQuestion(question)).toBe("exact_cached_answer");
  });

  it.each([
    "What was that thing they complained about?",
    "Did they ever mention power?",
    "Find the note about the water hookup.",
    "What did we promise them?",
    "Do you remember what they said about insurance?",
    "Was there anything about space for setup?",
  ])("routes vague cached recall to semantic matching: %s", (question) => {
    expect(routeLocalAssistantQuestion(question)).toBe("semantic_cached_search");
  });

  it.each([
    "Draft an email to the fair manager.",
    "Write me a follow-up message.",
    "Research events around Blanding.",
    "Search the web for a new fair.",
    "Which event should we prioritize strategically?",
    "Recommend the best package for this prospect.",
  ])("keeps writing, web research, and strategy in the cloud path: %s", (question) => {
    expect(routeLocalAssistantQuestion(question)).toBe("cloud_required");
  });

  it("defaults an unsupported ambiguous question to cloud instead of pretending the cache can answer", () => {
    expect(routeLocalAssistantQuestion("What do you think we should do here?")).toBe("cloud_required");
  });
});
