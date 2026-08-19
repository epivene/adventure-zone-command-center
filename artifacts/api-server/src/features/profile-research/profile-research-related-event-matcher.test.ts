import { describe, expect, it } from "vitest";

import { classifyRelatedEventAgainstRecords } from "./profile-research-related-event-matcher";

const event = {
  name: "Breckenridge Bluegrass + Beer Festival",
  city: "Breckenridge",
  region: "CO",
  startsAt: "2026-09-11",
  endsAt: "2026-09-13",
  venue: "Main Street Station",
  url: "https://gobreck.com/events/bluegrass-beer",
  rationale: "Official calendar",
};

describe("related event CRM matching", () => {
  it("marks an exact same-location profile as already in Command Center", () => {
    expect(classifyRelatedEventAgainstRecords(event, [{
      kind: "organization",
      id: "org-1",
      organizationId: "org-1",
      name: "Breckenridge Bluegrass + Beer Festival",
      city: "Breckenridge",
      region: "CO",
    }])).toEqual(expect.objectContaining({ status: "existing", organizationId: "org-1" }));
  });

  it("marks a close same-location name as a possible match", () => {
    expect(classifyRelatedEventAgainstRecords(event, [{
      kind: "booking",
      id: "booking-1",
      organizationId: "org-1",
      name: "Breckenridge Bluegrass and Beer",
      city: "Breckenridge",
      region: "CO",
    }])).toEqual(expect.objectContaining({ status: "possible_match", bookingId: "booking-1" }));
  });

  it("marks an unmatched event as a new prospect", () => {
    expect(classifyRelatedEventAgainstRecords(event, [])).toEqual({ status: "new_prospect" });
  });
});
