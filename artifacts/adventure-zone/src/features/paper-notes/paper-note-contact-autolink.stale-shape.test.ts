import { describe, expect, it } from "vitest";

import { findUnambiguousSavedContact } from "./paper-note-contact-autolink";

const paperContact = {
  key: "contact-0",
  mode: "new_contact" as const,
  selectedContactId: null,
  name: "Jane Doe",
  role: null,
  email: null,
  primary: true,
  phones: [{
    key: "contact-0-phone-0",
    number: "406-555-1212",
    extension: null,
    type: "office" as const,
    label: null,
    instructions: null,
    status: "active" as const,
    primary: false,
    crossedOut: false,
    importAsStructuredValue: true,
  }],
};

describe("paper note contact autolink stale match compatibility", () => {
  it("does not crash when an older cached saved-contact match has no phones array", () => {
    const staleSavedContact = {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Jane Doe",
      role: null,
      email: null,
      // Older cached /matches responses did not always include `phones`.
    } as any;

    expect(() => findUnambiguousSavedContact(paperContact as any, [staleSavedContact])).not.toThrow();
    expect(findUnambiguousSavedContact(paperContact as any, [staleSavedContact])?.id).toBe(staleSavedContact.id);
  });
});
