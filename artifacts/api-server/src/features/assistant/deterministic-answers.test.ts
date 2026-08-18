import { describe, expect, it } from "vitest";

import { answerDeterministically } from "./deterministic-answers";
import { buildBookingBrief } from "./booking-brief";
import type { BookingAssistantContextBundle } from "./assistant-types";

function makeContext(): BookingAssistantContextBundle {
  return {
    context: { kind: "booking", recordId: "current", label: "County Fair 2026" },
    profile: {
      organizationId: "org-1",
      contactIds: ["contact-1"],
      contacts: [{ id: "contact-1", label: "Lisa Smith", isPrimary: true }],
      eventFamilyId: null,
    },
    currentBooking: {
      id: "current",
      label: "County Fair 2026",
      startsAt: "2026-07-10T12:00:00.000Z",
      endsAt: "2026-07-10T20:00:00.000Z",
      venueName: "Stark County Fairgrounds",
      city: "Dickinson",
      region: "ND",
      status: "possible",
      physicalAttractionTotal: 9,
      packageNames: ["Adventure Zone"],
      specialResourceNames: [],
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
        status: "completed",
        physicalAttractionTotal: 12,
        packageNames: ["Adventure Zone", "Pirate's Rebellion"],
        specialResourceNames: ["Paintball trailer"],
      },
    ],
    recentActivities: [],
    openFollowUps: [
      { id: "follow", kind: "call", dueAt: "2026-08-18T15:00:00.000Z", label: "Call Lisa" },
    ],
    packageHistorySignals: [
      { kind: "usual_package_mix", packageNames: ["Adventure Zone", "Pirate's Rebellion"], sourceBookingIds: ["prior"] },
      { kind: "main_attraction_difference", previousCount: 12, currentCount: 9, difference: -3, sourceBookingId: "prior" },
      { kind: "missing_prior_resource", resourceId: "paintball", resourceName: "Paintball trailer", sourceBookingId: "prior" },
    ],
    routeContext: null,
    derivedFacts: [],
    businessKnowledge: [],
    sources: [
      { id: "src-current", kind: "booking", recordId: "current", label: "County Fair 2026", occurredAt: "2026-07-10T12:00:00.000Z" },
      { id: "src-prior", kind: "booking", recordId: "prior", label: "County Fair 2025", occurredAt: "2025-07-10T12:00:00.000Z" },
      { id: "src-follow", kind: "follow_up", recordId: "follow", label: "Call Lisa", occurredAt: "2026-08-18T15:00:00.000Z" },
      { id: "src-contact", kind: "activity", recordId: "contact-1", label: "Lisa Smith", occurredAt: null },
    ],
    generatedAt: "2026-08-17T21:00:00.000Z",
  };
}

describe("answerDeterministically", () => {
  it.each([
    ["What did they book last year?", /Adventure Zone.*Pirate's Rebellion/i],
    ["What do they normally book?", /usually book Adventure Zone.*Pirate's Rebellion/i],
    ["What's different from last year?", /3 fewer/i],
    ["What follow up is due?", /Call Lisa/i],
    ["Who is the main contact?", /Lisa Smith/i],
    ["Did they have paintball last time?", /Paintball trailer/i],
  ])("answers supported question: %s", (question, expected) => {
    const context = makeContext();
    const answer = answerDeterministically({
      question,
      context,
      brief: buildBookingBrief(context),
      timeZone: "America/Denver",
    });
    expect(answer?.mode).toBe("deterministic");
    expect(answer?.text).toMatch(expected);
    expect(answer?.sources.length).toBeGreaterThan(0);
  });

  it("answers the current booking start and end time without calling cloud AI", () => {
    const context = makeContext();
    const answer = answerDeterministically({
      question: "What time does this event start?",
      context,
      brief: buildBookingBrief(context),
      timeZone: "America/Denver",
    });

    expect(answer?.mode).toBe("deterministic");
    expect(answer?.text).toMatch(/County Fair 2026/i);
    expect(answer?.text).toMatch(/6:00 AM/i);
    expect(answer?.text).toMatch(/2:00 PM/i);
    expect(answer?.text).toMatch(/MDT/i);
    expect(answer?.sources.map((source) => source.id)).toEqual(["src-current"]);
  });

  it("finds a named event by its saved booking city and answers its time", () => {
    const context = makeContext();
    const answer = answerDeterministically({
      question: "What time was the Miles City event?",
      context,
      brief: buildBookingBrief(context),
      timeZone: "America/Denver",
    });

    expect(answer?.mode).toBe("deterministic");
    expect(answer?.text).toMatch(/Miles City, MT/i);
    expect(answer?.text).toMatch(/July 10, 2025/i);
    expect(answer?.text).toMatch(/6:00 AM/i);
    expect(answer?.text).toMatch(/2:00 PM/i);
    expect(answer?.sources.map((source) => source.id)).toEqual(["src-prior"]);
  });

  it("states when the matched booking has no saved start time instead of guessing", () => {
    const context = makeContext();
    context.currentBooking = {
      ...context.currentBooking!,
      startsAt: null,
      endsAt: null,
    };
    const answer = answerDeterministically({
      question: "What time is this event?",
      context,
      brief: buildBookingBrief(context),
      timeZone: "America/Denver",
    });

    expect(answer?.text).toMatch(/doesn't have a start time saved/i);
    expect(answer?.confidence).toBe("low");
    expect(answer?.sources.map((source) => source.id)).toEqual(["src-current"]);
  });

  it("combines known omissions and follow-up for what am I forgetting", () => {
    const context = makeContext();
    const answer = answerDeterministically({
      question: "What am I forgetting?",
      context,
      brief: buildBookingBrief(context),
      timeZone: "America/Denver",
    });
    expect(answer?.text).toMatch(/Paintball trailer/i);
    expect(answer?.text).toMatch(/Call Lisa/i);
  });

  it("returns a sourced low-evidence answer instead of guessing", () => {
    const context = makeContext();
    context.priorBookings = [];
    context.packageHistorySignals = [];
    const answer = answerDeterministically({
      question: "What did they book last year?",
      context,
      brief: buildBookingBrief(context),
      timeZone: "America/Denver",
    });
    expect(answer?.text).toMatch(/don't have enough saved history/i);
    expect(answer?.confidence).toBe("low");
  });

  it("falls through for unsupported questions", () => {
    const context = makeContext();
    expect(
      answerDeterministically({
        question: "Write a persuasive renewal email with three subject lines",
        context,
        brief: buildBookingBrief(context),
        timeZone: "America/Denver",
      }),
    ).toBeNull();
  });
});
