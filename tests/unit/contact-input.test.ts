import { describe, expect, it } from "vitest";

import {
  contactFormInputSchema,
  contactListQuerySchema,
} from "@/features/contacts/contact-input";

describe("contactFormInputSchema", () => {
  it("rejects an empty contact name", () => {
    const result = contactFormInputSchema.safeParse({
      firstName: "   ",
      lastName: "",
      organizationName: "",
      jobTitle: "",
      email: "",
      phone: "",
      address1: "",
      address2: "",
      city: "",
      region: "",
      postalCode: "",
    });

    expect(result.success).toBe(false);
  });

  it("normalizes email and converts empty optional fields to null", () => {
    const result = contactFormInputSchema.parse({
      firstName: "  Avery ",
      lastName: " Example  ",
      organizationName: "  Marias Fair ",
      jobTitle: "",
      email: "  AVERY@EXAMPLE.COM ",
      phone: " ",
      address1: "",
      address2: "",
      city: " Shelby ",
      region: " MT ",
      postalCode: "",
    });

    expect(result).toEqual({
      firstName: "Avery",
      lastName: "Example",
      organizationName: "Marias Fair",
      jobTitle: null,
      email: "avery@example.com",
      phone: null,
      address1: null,
      address2: null,
      city: "Shelby",
      region: "MT",
      postalCode: null,
    });
  });

  it("rejects a malformed non-empty email", () => {
    expect(() =>
      contactFormInputSchema.parse({
        firstName: "Avery",
        lastName: "",
        organizationName: "",
        jobTitle: "",
        email: "not-an-email",
        phone: "",
        address1: "",
        address2: "",
        city: "",
        region: "",
        postalCode: "",
      }),
    ).toThrow();
  });
});

describe("contactListQuerySchema", () => {
  it("normalizes search, state, and pagination", () => {
    expect(
      contactListQuerySchema.parse({
        q: "  North   Dakota ",
        state: "waiting",
        page: "3",
      }),
    ).toEqual({
      search: "North Dakota",
      state: "waiting",
      page: 3,
      pageSize: 50,
    });
  });

  it("falls back safely for unsupported filters and pages", () => {
    expect(
      contactListQuerySchema.parse({
        state: "unknown",
        page: "-9",
      }),
    ).toEqual({
      search: "",
      state: "all",
      page: 1,
      pageSize: 50,
    });
  });
});
