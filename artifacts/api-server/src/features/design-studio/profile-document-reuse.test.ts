import { describe, expect, it } from "vitest";

import {
  clearReconfirmationContent,
  refreshOfferFacts,
} from "./profile-document-reuse";

describe("profile document reuse", () => {
  it("clears structured event and negotiated fields while preserving reusable copy", () => {
    const source = JSON.stringify({
      heading: "Our custom annual agreement",
      eventName: "2027 Fair",
      eventDates: "July 1, 2027",
      financialFields: {
        guaranteedFee: "$7,500",
        percentage: "10%",
        deposit: "$3,000",
      },
      signatures: { sponsor: "Signed", adventureZone: "Signed" },
      reusableNote: "Use the south entrance every year",
    });
    const cleared = JSON.parse(clearReconfirmationContent(source, []));
    expect(cleared.eventName).toBe("");
    expect(cleared.eventDates).toBe("");
    expect(cleared.financialFields).toEqual({
      guaranteedFee: "",
      percentage: "",
      deposit: "",
    });
    expect(cleared.signatures).toEqual({ sponsor: "", adventureZone: "" });
    expect(cleared.reusableNote).toBe("Use the south entrance every year");
  });

  it("refreshes snapshotted package facts without changing unrelated copy", () => {
    const content = "Mini Zone is $6,000 and needs 4,000–7,000 sq ft. Keep this note.";
    const refreshed = refreshOfferFacts(
      content,
      {
        packages: {
          mini_zone: { priceCents: 600000, marketingFootprint: "4,000–7,000 sq ft" },
        },
        addOns: { foamParty: { priceCents: 350000 } },
      },
      {
        packages: {
          mini_zone: { priceCents: 500000, marketingFootprint: "3,000–5,000 sq ft" },
        },
        addOns: { foamParty: { priceCents: 350000 } },
      },
    );
    expect(refreshed).toBe("Mini Zone is $5,000 and needs 3,000–5,000 sq ft. Keep this note.");
  });
});
