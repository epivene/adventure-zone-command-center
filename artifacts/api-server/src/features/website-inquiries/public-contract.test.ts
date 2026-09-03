import { describe, expect, it } from "vitest";

import { websiteInquirySubmissionSchema } from "./public-contract";

const validInput = {
  submissionId: "10000000-0000-4000-8000-000000000001",
  name: "  Desie Example  ",
  email: " DESIE@example.com ",
  eventName: "Summer Festival",
  eventDate: "2027-07-04",
  eventLocation: "Denver, CO",
  packageInterest: "Adventure Zone",
  message: "Please tell me about availability.",
  website: "",
  pageUrl: "https://the-adventure-zone.com/#contact",
};

describe("website inquiry public contract", () => {
  it("accepts and trims the documented fields", () => {
    expect(websiteInquirySubmissionSchema.parse(validInput)).toEqual({
      ...validInput,
      name: "Desie Example",
      email: "DESIE@example.com",
    });
  });

  it("accepts omitted optional event details", () => {
    const { eventDate, eventLocation, packageInterest, ...required } = validInput;
    expect(websiteInquirySubmissionSchema.safeParse(required).success).toBe(true);
  });

  it.each([
    [{ ...validInput, email: "not-an-email" }, "email"],
    [{ ...validInput, eventDate: "2027-02-30" }, "date"],
    [{ ...validInput, website: "spam.example" }, "honeypot"],
    [{ ...validInput, role: "owner" }, "unknown field"],
    [{ ...validInput, message: "x".repeat(5001) }, "length"],
  ])("rejects invalid input: %s (%s)", (input) => {
    expect(websiteInquirySubmissionSchema.safeParse(input).success).toBe(false);
  });
});
