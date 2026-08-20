import { describe, expect, it } from "vitest";

import {
  fingerprintPaperNoteTarget,
  paperNoteTargetChanged,
  type PaperNoteStoredTargetSnapshot,
} from "./paper-note-target-snapshot";

describe("paper note target fingerprints", () => {
  it("is stable across object key ordering", () => {
    const left = {
      organization: { id: "org-1", name: "County Fair", city: "Minot" },
      contacts: [{ key: "contact-0", id: "contact-1", email: "amy@example.test" }],
    };
    const right = {
      contacts: [{ email: "amy@example.test", id: "contact-1", key: "contact-0" }],
      organization: { city: "Minot", name: "County Fair", id: "org-1" },
    };
    expect(fingerprintPaperNoteTarget(left)).toBe(fingerprintPaperNoteTarget(right));
  });

  it("changes when an exact reviewed CRM value changes", () => {
    const before = {
      organization: { id: "org-1", name: "County Fair" },
      contacts: [{ key: "contact-0", id: "contact-1", email: "amy@example.test" }],
      phones: [{ path: "contacts.0.phones.0", id: "phone-1", number: "701-555-0100", extension: "22" }],
    };
    const stored: PaperNoteStoredTargetSnapshot = {
      version: 1,
      fingerprint: fingerprintPaperNoteTarget(before),
      value: before,
    };
    expect(paperNoteTargetChanged(stored, before)).toBe(false);
    expect(paperNoteTargetChanged(stored, {
      ...before,
      phones: [{ ...before.phones[0]!, extension: "23" }],
    })).toBe(true);
  });
});
