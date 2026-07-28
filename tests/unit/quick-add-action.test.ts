import { describe, expect, it } from "vitest";

import { submitQuickCaller } from "@/features/contacts/quick-caller-service";
import type { PhoneMatch, QuickCallerInput } from "@/features/contacts/contact-types";

const input = {
  name: "Avery Example",
  organizationName: "Marias Fair",
  phone: "406-555-0101",
  email: "",
  reason: "Asked about an August event.",
  eventDate: "",
  eventLocation: "",
};

class RecordingQuickCallerRepository {
  readonly submitted: QuickCallerInput[] = [];

  constructor(private readonly match: PhoneMatch) {}

  async findContactsByPhone(phone: string) {
    expect(phone).toBe("406-555-0101");
    return this.match;
  }

  async createQuickCaller(caller: QuickCallerInput) {
    this.submitted.push(caller);
    return "new-contact";
  }
}

describe("submitQuickCaller", () => {
  it("does a fresh exact lookup and blocks a stale typed duplicate before creating", async () => {
    const repository = new RecordingQuickCallerRepository({
      kind: "one",
      contact: {
        id: "existing-contact",
        firstName: "Avery",
        lastName: "Example",
        organizationName: "Marias Fair",
        jobTitle: null,
        email: null,
        phone: "406-555-0101",
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
        syncState: "synced",
        updatedAt: new Date("2026-07-28T12:00:00Z"),
        lastSyncedAt: null,
      },
    });

    await expect(submitQuickCaller(input, repository)).resolves.toMatchObject({
      ok: false,
      match: { kind: "one", contact: { id: "existing-contact" } },
    });
    expect(repository.submitted).toEqual([]);
  });

  it("creates only after a fresh no-match response and retains the raw phone", async () => {
    const repository = new RecordingQuickCallerRepository({
      kind: "none",
      normalizedPhone: "+14065550101",
    });

    await expect(submitQuickCaller(input, repository)).resolves.toEqual({
      ok: true,
      contactId: "new-contact",
    });
    expect(repository.submitted).toEqual([
      expect.objectContaining({
        firstName: "Avery",
        lastName: "Example",
        phone: "406-555-0101",
      }),
    ]);
  });
});
