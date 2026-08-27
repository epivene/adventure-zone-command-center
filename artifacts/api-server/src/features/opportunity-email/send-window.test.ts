import { describe, expect, it } from "vitest";

import { morningStagger, tomorrowMorning, type SendWindowSettings } from "./send-window";

const settings: SendWindowSettings = {
  morningStart: "08:00",
  morningEnd: "09:00",
  weekdaysOnly: true,
  businessTimeZone: "America/Denver",
};

describe("tomorrowMorning", () => {
  it("uses the recipient timezone when it is explicitly known", () => {
    const result = tomorrowMorning({
      now: new Date("2026-08-27T18:00:00.000Z"),
      settings,
      recipientTimeZone: "America/Chicago",
    });

    expect(result.toISOString()).toBe("2026-08-28T13:00:00.000Z");
  });

  it("falls back to the configured business timezone without guessing", () => {
    const result = tomorrowMorning({
      now: new Date("2026-08-27T18:00:00.000Z"),
      settings,
      recipientTimeZone: null,
    });

    expect(result.toISOString()).toBe("2026-08-28T14:00:00.000Z");
  });

  it("rolls Friday forward to Monday when weekdaysOnly is enabled", () => {
    const result = tomorrowMorning({
      now: new Date("2026-08-28T18:00:00.000Z"),
      settings,
      recipientTimeZone: null,
    });

    expect(result.toISOString()).toBe("2026-08-31T14:00:00.000Z");
  });
});

describe("morningStagger", () => {
  it("deterministically distributes the ordered list across the configured morning window", () => {
    const result = morningStagger({
      now: new Date("2026-08-27T18:00:00.000Z"),
      settings,
      drafts: [
        { id: "draft-a", recipientTimeZone: null },
        { id: "draft-b", recipientTimeZone: null },
        { id: "draft-c", recipientTimeZone: null },
      ],
    });

    expect(result.map((item) => [item.draftId, item.scheduledFor.toISOString()])).toEqual([
      ["draft-a", "2026-08-28T14:00:00.000Z"],
      ["draft-b", "2026-08-28T14:30:00.000Z"],
      ["draft-c", "2026-08-28T15:00:00.000Z"],
    ]);
  });

  it("keeps each known recipient inside that recipient's local morning window", () => {
    const result = morningStagger({
      now: new Date("2026-08-27T18:00:00.000Z"),
      settings,
      drafts: [
        { id: "central", recipientTimeZone: "America/Chicago" },
        { id: "eastern", recipientTimeZone: "America/New_York" },
      ],
    });

    expect(result.map((item) => [item.draftId, item.scheduledFor.toISOString()])).toEqual([
      ["central", "2026-08-28T13:00:00.000Z"],
      ["eastern", "2026-08-28T13:00:00.000Z"],
    ]);
  });

  it("returns an empty schedule for an empty selection", () => {
    expect(morningStagger({
      now: new Date("2026-08-27T18:00:00.000Z"),
      settings,
      drafts: [],
    })).toEqual([]);
  });
});
