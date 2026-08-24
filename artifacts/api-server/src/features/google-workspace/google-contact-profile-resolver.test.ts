import { describe, expect, it } from "vitest";

import { GoogleContactProfileResolver } from "./google-contact-profile-resolver";

function resolverFor(rows: Array<{
  contactId: string;
  organizationId: string;
  organizationName: string;
}>) {
  return new GoogleContactProfileResolver({
    relationships: {
      listActiveOrganizationsForContact: async (contactId) =>
        rows.filter((row) => row.contactId === contactId),
    },
  });
}

describe("GoogleContactProfileResolver", () => {
  it("resolves an exact contact to its one active organization profile", async () => {
    const resolver = resolverFor([
      {
        contactId: "contact-1",
        organizationId: "org-1",
        organizationName: "County Fair",
      },
    ]);

    await expect(resolver.resolve("contact-1")).resolves.toEqual({
      contactId: "contact-1",
      status: "resolved",
      organization: { id: "org-1", name: "County Fair" },
      candidates: [{ id: "org-1", name: "County Fair" }],
    });
  });

  it("does not guess when a contact has multiple active organization profiles", async () => {
    const resolver = resolverFor([
      {
        contactId: "contact-1",
        organizationId: "org-1",
        organizationName: "County Fair",
      },
      {
        contactId: "contact-1",
        organizationId: "org-2",
        organizationName: "Summer Festival",
      },
    ]);

    await expect(resolver.resolve("contact-1")).resolves.toEqual({
      contactId: "contact-1",
      status: "ambiguous",
      organization: null,
      candidates: [
        { id: "org-1", name: "County Fair" },
        { id: "org-2", name: "Summer Festival" },
      ],
    });
  });

  it("leaves a contact unresolved when it has no active organization relationship", async () => {
    const resolver = resolverFor([]);

    await expect(resolver.resolve("contact-1")).resolves.toEqual({
      contactId: "contact-1",
      status: "unresolved",
      organization: null,
      candidates: [],
    });
  });
});
