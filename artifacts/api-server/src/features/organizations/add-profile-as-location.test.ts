import { describe, expect, it } from "vitest";

import {
  contacts,
  organizationContacts,
  organizationLocations,
} from "@/db/schema";
import { addProfileAsLocation } from "./add-profile-as-location";

function queryResult<T>(result: T) {
  const query = {
    from: () => query,
    where: () => query,
    for: async () => result,
    limit: async () => result,
    then: (
      resolve: (value: T) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

describe("addProfileAsLocation contact reassignment", () => {
  it("creates the canonical organization-contact association before moving the contact", async () => {
    let selectCall = 0;
    let canonicalAssociationExists = false;

    const canonical = {
      id: "6813439b-4ba6-478c-9c51-70b583914e9e",
      consolidatedIntoId: null,
    };
    const source = {
      id: "93ee6ee1-9bea-403e-a83c-83a3de8566d4",
      name: "County Fair - Northern Gila (Payson) AZ",
      city: "Payson",
      region: "AZ",
      address1: null,
      address2: null,
      postalCode: null,
      website: null,
      phone: null,
      normalizedPhone: null,
      actRecordId: "ACT-OLD",
      consolidatedIntoId: null,
    };
    const sourceAssociation = {
      contactId: "b1009d0e-0000-4000-8000-000000000001",
      role: "Fair contact",
      isPrimary: true,
      active: true,
      source: "ACT",
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    };

    const tx = {
      execute: async () => undefined,
      select: () => {
        selectCall += 1;
        if (selectCall === 1) return queryResult([canonical]);
        if (selectCall === 2) return queryResult([source]);
        if (selectCall === 3) return queryResult([]);
        return queryResult([sourceAssociation]);
      },
      insert: (table: unknown) => ({
        values: () => {
          if (table === organizationLocations) {
            return {
              returning: async () => [{ id: "location-1" }],
            };
          }
          if (table === organizationContacts) {
            canonicalAssociationExists = true;
            return {
              onConflictDoNothing: async () => undefined,
            };
          }
          throw new Error("Unexpected insert");
        },
      }),
      update: (table: unknown) => ({
        set: () => ({
          where: async () => {
            if (table === contacts && !canonicalAssociationExists) {
              throw new Error("contacts_primary_organization_contact_fk");
            }
          },
        }),
      }),
      delete: () => ({
        where: async () => undefined,
      }),
    };

    const database = {
      transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx),
    };

    await expect(
      addProfileAsLocation(
        database as never,
        {
          canonicalOrgId: canonical.id,
          sourceOrgId: source.id,
          label: "Payson, AZ",
        },
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).resolves.toEqual({ locationId: "location-1" });
  });
});
