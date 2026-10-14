import { describe, expect, it } from "vitest";
import { searchCalendarRecords, suggestCalendarProfiles } from "./operational-calendar-review-search";
const profiles = [
  { profileId: "blanding", profileName: "City of Blanding", city: "Blanding", region: "UT" },
  { profileId: "haffe", profileName: "HAFFE Convention", city: null, region: null },
  { profileId: "white-pine", profileName: "White Pine Fundraiser", city: null, region: null },
  { profileId: "unrelated", profileName: "County Fair", city: "Blanding", region: "UT" },
];
describe("calendar review discovery", () => {
  it.each([
    ["KRISTY BLANDING CITY FALL FESTIVAL BLANDING UT (ZONE)", "blanding"],
    ["HAFFE CONVENTION 2026", "haffe"],
    ["WHITE PINE FUNDRAISER", "white-pine"],
  ])("finds existing profiles from %s without dates or stored candidate IDs", (summary, id) => {
    expect(suggestCalendarProfiles({ summary, managerToken: "KRISTY" }, profiles)[0].profileId).toBe(id);
  });
  it("uses the same word-order/typo search as profiles", () => {
    expect(searchCalendarRecords("UT blandng", profiles, p => [p.profileName, p.city ?? "", p.region ?? ""]).map(p => p.profileId)).toEqual(["blanding", "unrelated"]);
  });
  it("does not offer generic fairs based only on matching city", () => {
    expect(suggestCalendarProfiles({ summary: "KRISTY FALL FESTIVAL (ZONE)", city: "Blanding", managerToken: "Kristy" }, profiles)).toEqual([]);
  });
  it("flags contradicting regions while leaving final identity selection to review", () => {
    expect(suggestCalendarProfiles({ summary: "Blanding", region: "CO" }, profiles)[0].matchNote).toContain("State differs");
  });
});
