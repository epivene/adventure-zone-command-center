import { describe, expect, it } from "vitest";

import type { AssistantCachedSnapshot } from "./assistant-offline-cache";
import { buildLocalAssistantDocuments } from "./on-device-ai-documents";

function snapshot(overrides: Partial<AssistantCachedSnapshot> = {}): AssistantCachedSnapshot {
  return {
    key: "owner:organization:org-1",
    actorId: "owner",
    kind: "organization",
    recordId: "org-1",
    label: "County Fair",
    savedAt: "2026-08-25T12:00:00.000Z",
    brief: {
      headline: "County Fair",
      items: [
        {
          key: "objection_or_promise",
          text: "They asked whether we can provide enough power without a generator.",
          confidence: "high",
          sourceIds: ["src-note"],
        },
        {
          key: "follow_up",
          text: "Call after the board meeting.",
          confidence: "medium",
          sourceIds: ["src-follow"],
        },
      ],
      generatedAt: "2026-08-25T12:00:00.000Z",
    },
    context: {
      context: { kind: "organization", recordId: "org-1", label: "County Fair" },
      sources: [
        { id: "src-note", kind: "activity", recordId: "act-1", label: "Amy call notes", occurredAt: "2026-08-20T12:00:00Z" },
        { id: "src-follow", kind: "follow_up", recordId: "follow-1", label: "Board follow-up", occurredAt: "2026-08-21T12:00:00Z" },
        { id: "src-booking", kind: "booking", recordId: "booking-1", label: "County Fair 2025", occurredAt: "2025-07-10T12:00:00Z" },
      ],
      currentBooking: {
        id: "booking-2",
        label: "County Fair 2026",
        startsAt: "2026-07-10T12:00:00Z",
        endsAt: "2026-07-10T20:00:00Z",
        venueName: "Stark County Fairgrounds",
        city: "Dickinson",
        region: "ND",
      },
      priorBookings: [
        {
          id: "booking-1",
          label: "County Fair 2025",
          startsAt: "2025-07-10T12:00:00Z",
          endsAt: "2025-07-10T20:00:00Z",
          venueName: "Eastern Montana Fairgrounds",
          city: "Miles City",
          region: "MT",
        },
      ],
      eventDescription: "Annual family fair with several days of programming.",
      relationshipSummary: "Organizer prefers email after the board meeting.",
      specialNotes: "Water hookup is behind the livestock barn.",
      generatedAt: "2026-08-25T12:00:00.000Z",
      apiToken: "should-never-be-indexed",
      password: "should-never-be-indexed",
      rawHtml: "<div>secret-ish html blob</div>",
      deeplyNested: { note: "do not recursively index arbitrary objects" },
    },
    ...overrides,
  };
}

describe("buildLocalAssistantDocuments", () => {
  it("includes brief items with their source references", () => {
    const documents = buildLocalAssistantDocuments(snapshot());
    expect(documents).toContainEqual({
      id: "brief:objection_or_promise",
      text: "They asked whether we can provide enough power without a generator.",
      sourceIds: ["src-note"],
      kind: "brief",
    });
  });

  it("includes bounded booking descriptors and maps booking sources when available", () => {
    const documents = buildLocalAssistantDocuments(snapshot());
    const prior = documents.find((document) => document.id === "booking:booking-1");
    expect(prior?.text).toMatch(/County Fair 2025/);
    expect(prior?.text).toMatch(/Eastern Montana Fairgrounds/);
    expect(prior?.text).toMatch(/Miles City, MT/);
    expect(prior?.sourceIds).toEqual(["src-booking"]);
  });

  it("indexes only explicitly allowed short context fields", () => {
    const documents = buildLocalAssistantDocuments(snapshot());
    const text = documents.map((document) => document.text).join("\n");
    expect(text).toContain("Annual family fair with several days of programming.");
    expect(text).toContain("Water hookup is behind the livestock barn.");
    expect(text).not.toContain("should-never-be-indexed");
    expect(text).not.toContain("secret-ish html blob");
    expect(text).not.toContain("do not recursively index arbitrary objects");
  });

  it("deduplicates normalized text", () => {
    const value = snapshot();
    value.context.specialNotes = "  Call after   the board meeting.  ";
    const documents = buildLocalAssistantDocuments(value);
    expect(documents.filter((document) => /call after\s+the board meeting/i.test(document.text))).toHaveLength(1);
  });

  it("caps documents at 80 and text at 1200 characters", () => {
    const value = snapshot({
      brief: {
        headline: "Many facts",
        generatedAt: "2026-08-25T12:00:00Z",
        items: Array.from({ length: 100 }, (_, index) => ({
          key: `fact_${index}`,
          text: `${index}: ${"x".repeat(1500)}`,
          confidence: "high" as const,
          sourceIds: [],
        })),
      },
    });
    const documents = buildLocalAssistantDocuments(value);
    expect(documents.length).toBeLessThanOrEqual(80);
    expect(Math.max(...documents.map((document) => document.text.length))).toBeLessThanOrEqual(1200);
  });

  it("never turns internal ids into standalone prose", () => {
    const documents = buildLocalAssistantDocuments(snapshot());
    expect(documents.some((document) => document.text === "org-1" || document.text === "booking-1")).toBe(false);
  });
});
