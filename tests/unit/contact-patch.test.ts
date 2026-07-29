import { describe, expect, it, vi } from "vitest";

import { contacts } from "@/db/schema";
import { patchContactInTransaction } from "@/features/contacts/contact-repository";

describe("patchContactInTransaction", () => {
  it("normalizes restored phone values and marks the Act! sync state dirty", async () => {
    const now = new Date("2026-07-28T15:00:00.000Z");
    const before: typeof contacts.$inferSelect = {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: null,
      firstName: "Avery",
      lastName: "Example",
      email: null,
      phone: "old",
      normalizedPhone: null,
      quickAddRequestKey: null,
      jobTitle: null,
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      actRecordId: "ACT-1",
      createdAt: now,
      updatedAt: now,
    };
    const updated = {
      ...before,
      phone: "(406) 555-0101",
      normalizedPhone: "+14065550101",
    };
    const returning = vi.fn(async () => [updated]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    await expect(
      patchContactInTransaction(
        { update, insert } as never,
        before,
        null,
        { phone: "(406) 555-0101" },
        now,
      ),
    ).resolves.toMatchObject({
      contact: { normalizedPhone: "+14065550101" },
    });

    expect(set).toHaveBeenCalledWith({
      phone: "(406) 555-0101",
      normalizedPhone: "+14065550101",
      updatedAt: now,
    });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      contactId: before.id,
      localDirty: true,
      state: "waiting",
    }));
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.objectContaining({ localDirty: true, state: "waiting" }),
    }));
  });
});
