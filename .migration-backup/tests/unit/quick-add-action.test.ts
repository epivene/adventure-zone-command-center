import { describe, expect, it } from "vitest";

import { submitQuickCaller } from "@/features/contacts/quick-caller-service";
import type { PhoneMatch, QuickCallerInput } from "@/features/contacts/contact-types";

const input = {
  requestKey: "99999999-9999-4999-8999-999999999999",
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

  constructor(private readonly result:
    | { kind: "created"; contactId: string }
    | { kind: "match"; match: PhoneMatch }) {}

  async createQuickCaller(caller: QuickCallerInput) {
    this.submitted.push(caller);
    return this.result;
  }
}

describe("submitQuickCaller", () => {
  it("does a fresh exact lookup and blocks a stale typed duplicate before creating", async () => {
    const repository = new RecordingQuickCallerRepository({
      kind: "match",
      match: {
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
      },
    });

    await expect(submitQuickCaller(input, repository)).resolves.toMatchObject({
      ok: false,
      match: { kind: "one", contact: { id: "existing-contact" } },
    });
    expect(repository.submitted).toEqual([
      expect.objectContaining({ requestKey: input.requestKey }),
    ]);
  });

  it("creates only after a fresh no-match response and retains the raw phone", async () => {
    const repository = new RecordingQuickCallerRepository({
      kind: "created",
      contactId: "new-contact",
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
        requestKey: input.requestKey,
      }),
    ]);
  });
});
