import { describe, expect, it } from "vitest";

import { normalizeSourceScoutRequest, normalizeSourceScoutEvents } from "./profile-research-source-scout";

describe("profile research source scout", () => {
  it("requires a safe public URL and a bounded date window", () => {
    expect(normalizeSourceScoutRequest({
      sourceUrl: "https://gobreck.com/events",
      startDate: "2026-06-01",
      endDate: "2026-10-31",
    })).toEqual(expect.objectContaining({ sourceUrl: "https://gobreck.com/events", startDate: "2026-06-01", endDate: "2026-10-31" }));

    expect(() => normalizeSourceScoutRequest({ sourceUrl: "file:///etc/passwd", startDate: "2026-06-01", endDate: "2026-10-31" })).toThrow("PUBLIC_SOURCE_URL_REQUIRED");
    expect(() => normalizeSourceScoutRequest({ sourceUrl: "https://example.com", startDate: "2026-01-01", endDate: "2027-12-31" })).toThrow("SCOUT_DATE_WINDOW_TOO_LARGE");
  });

  it("keeps only cited events, removes duplicates, and caps results", () => {
    const allowed = new Set(["https://gobreck.com/events/a", "https://gobreck.com/events/b"]);
    const raw = [
      { name: "Festival A", city: "Breckenridge", region: "CO", startsAt: "2026-08-20", endsAt: "2026-08-23", venue: "Main Street", url: "https://gobreck.com/events/a", rationale: "Official listing" },
      { name: "Festival A", city: "Breckenridge", region: "CO", startsAt: "2026-08-20", endsAt: "2026-08-23", venue: "Main Street", url: "https://gobreck.com/events/a", rationale: "Duplicate" },
      { name: "Uncited", city: "Breckenridge", region: "CO", startsAt: "2026-09-01", url: "https://uncited.example/event", rationale: "No citation" },
      { name: "Festival B", city: "Breckenridge", region: "CO", startsAt: "2026-09-11", url: "https://gobreck.com/events/b", rationale: "Official listing" },
    ];

    const events = normalizeSourceScoutEvents(raw, allowed, 1);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("Festival A");
  });
});
