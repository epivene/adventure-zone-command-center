import { describe, expect, it, vi } from "vitest";

import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import {
  capturePaperNoteTargetSnapshot,
  fingerprintPaperNoteTarget,
  paperNoteTargetChanged,
  type PaperNoteStoredTargetSnapshot,
} from "./paper-note-target-snapshot";

function review(destination: PaperNoteReviewDraft["destination"]): PaperNoteReviewDraft {
  return {
    event: { name: "County Fair", city: "Minot", region: "ND", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
    activity: { occurredOn: null, method: "call", outcome: "", summary: "" },
    contacts: [],
    organizationPhones: [],
    oldReminder: "",
    starredOnPaper: false,
    generalNotes: [],
    destination,
    conflicts: {},
    currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
  };
}

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

  it("captures an existing-profile target but skips a new profile", async () => {
    const database = {
      execute: vi.fn(async () => ({
        rows: [{
          id: "40000000-0000-4000-8000-000000000001",
          name: "County Fair",
          city: "Minot",
          region: "ND",
          consolidatedIntoId: null,
        }],
      })),
    };

    const existing = await capturePaperNoteTargetSnapshot(database as never, review({
      mode: "existing_profile",
      organizationId: "40000000-0000-4000-8000-000000000001",
      organizationLocationId: null,
    }));
    expect(existing).toMatchObject({ version: 1 });
    expect(existing?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(database.execute).toHaveBeenCalledTimes(1);

    database.execute.mockClear();
    await expect(capturePaperNoteTargetSnapshot(database as never, review({
      mode: "new_profile",
      eventFamilyId: null,
    }))).resolves.toBeNull();
    expect(database.execute).not.toHaveBeenCalled();
  });
});
