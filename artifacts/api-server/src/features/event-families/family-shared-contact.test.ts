import { describe, expect, it, vi } from "vitest";
import { getFamilySharedContact } from "./family-shared-contact";

describe("getFamilySharedContact", () => {
  it("returns family website and primary contact without mutating local contacts", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      familyId: "family-1", familyName: "Water Lantern Festival", website: "waterlanternfestival.com",
      contactId: "contact-1", contactName: "Jane Smith", role: "Corporate Events", phone: "701-555-0101", email: "jane@example.com",
    }] });
    const localContacts = [{ id: "local-1", name: "Denver Contact" }];
    const result = await getFamilySharedContact({ query } as any, { kind: "event_family", id: "family-1", name: "Water Lantern Festival" });
    expect(result).toEqual({
      familyId: "family-1", familyName: "Water Lantern Festival", website: "waterlanternfestival.com",
      primaryContact: { contactId: "contact-1", name: "Jane Smith", role: "Corporate Events", phone: "701-555-0101", email: "jane@example.com" },
    });
    expect(localContacts).toEqual([{ id: "local-1", name: "Denver Contact" }]);
    expect(String(query.mock.calls[0]?.[0])).toContain("is_primary = true");
  });

  it("returns null for no shared data or a non-event-family context", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ familyId: "family-1", familyName: "Water Lantern Festival", website: null, contactId: null, contactName: null, role: null, phone: null, email: null }] });
    expect(await getFamilySharedContact({ query } as any, { kind: "event_family", id: "family-1", name: "Water Lantern Festival" })).toBeNull();
    expect(await getFamilySharedContact({ query } as any, { kind: "organization_group", id: "org-1", name: "Org" } as any)).toBeNull();
  });
});
