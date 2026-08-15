import { describe, expect, it } from "vitest";
import { groupEventProfileContacts } from "./group-event-profile-contacts";

const contact = (overrides: Record<string, unknown> = {}) => ({
  id: "generated", name: "Jennings Felt", role: null, isPrimary: false,
  phone: null, email: "jennings@example.com", source: "act", actRecordId: null,
  locationName: null, locationCity: null, locationRegion: null, ...overrides,
});

describe("groupEventProfileContacts", () => {
  it("groups the same contact and keeps unique locations", () => {
    const first = contact({ id: "a", locationName: "Albuquerque" });
    const second = contact({ id: "a", locationName: "Denver" });
    const [group] = groupEventProfileContacts([first, second]);
    expect(group).toMatchObject({ id: "a", locations: ["Albuquerque", "Denver"], contactIds: ["a"] });
  });

  it("does not merge distinct records with the same name", () => {
    const groups = groupEventProfileContacts([
      contact({ id: "a", email: "a@example.com" }),
      contact({ id: "b", email: "b@example.com" }),
    ]);
    expect(groups).toHaveLength(2);
  });
});
