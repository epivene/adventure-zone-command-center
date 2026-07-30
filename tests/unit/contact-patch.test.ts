import { describe, expect, it, vi } from "vitest";

import { contacts, organizationContacts } from "@/db/schema";
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

  it("does not overwrite a reviewed role or Place primary flag", async () => {
    const now = new Date("2026-07-28T15:00:00.000Z");
    const before: typeof contacts.$inferSelect = {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      firstName: "Avery",
      lastName: "Example",
      email: null,
      phone: null,
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
    const associations = new Map<string, Record<string, unknown>>([
      [
        before.organizationId!,
        {
          organizationId: before.organizationId!,
          contactId: before.id,
          role: "Reviewed role",
          isPrimary: true,
          active: true,
          source: "local",
        },
      ],
      [
        "33333333-3333-4333-8333-333333333333",
        {
          organizationId: "33333333-3333-4333-8333-333333333333",
          contactId: before.id,
          role: "Reviewed target role",
          isPrimary: true,
          active: false,
          source: "local",
        },
      ],
    ]);
    const current = { ...before };
    let relationshipConflictSet: Record<string, unknown> | null = null;
    const writer = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({ for: async () => [{ id: current.id }] }),
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          if (table === organizationContacts) {
            const existing = associations.get(values.organizationId as string);
            return {
              onConflictDoUpdate: async (configuration: { set: Record<string, unknown> }) => {
                relationshipConflictSet = configuration.set;
                associations.set(values.organizationId as string, existing
                  ? { ...existing, ...configuration.set }
                  : { ...values });
              },
            };
          }
          return { onConflictDoUpdate: async () => undefined };
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          if (table === contacts) Object.assign(current, values);
          return {
            where: () => ({ returning: async () => [{ ...current }] }),
          };
        },
      }),
      delete: () => undefined,
    };

    await patchContactInTransaction(
      writer as never,
      before,
      null,
      { organizationId: "33333333-3333-4333-8333-333333333333" },
      now,
    );

    expect(current.organizationId).toBe("33333333-3333-4333-8333-333333333333");
    expect(relationshipConflictSet).toEqual({
      active: true,
      source: "local",
      updatedAt: now,
    });
    expect([...associations.values()]).toEqual([
      {
        organizationId: "22222222-2222-4222-8222-222222222222",
        contactId: before.id,
        role: "Reviewed role",
        isPrimary: true,
        active: true,
        source: "local",
      },
      {
        organizationId: "33333333-3333-4333-8333-333333333333",
        contactId: before.id,
        role: "Reviewed target role",
        isPrimary: true,
        active: true,
        source: "local",
        updatedAt: now,
      },
    ]);
  });
});
