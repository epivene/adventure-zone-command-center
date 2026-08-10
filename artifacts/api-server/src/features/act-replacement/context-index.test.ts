import { describe, expect, it } from "vitest";
import { buildActContextIndex } from "./context-index";

describe("Act archive context index", () => {
  const rows = [
    { sourceRecordId: "company-1", streamType: "company", rawSnapshot: { Name: "Adventure Zone", Website: "https://adventure.example", BusinessPhone: "503-555-0100", City: "Portland", State: "OR" } },
    { sourceRecordId: "contact-1", streamType: "contact", rawSnapshot: { FirstName: "Merle", LastName: "Highchurch", EmailAddress: "merle@example.com", BusinessPhone: "503-555-0101" } },
    { sourceRecordId: "opportunity-1", streamType: "opportunity", rawSnapshot: { Name: "Carbon County Fair", StartDate: "2026-08-12", City: "Rawlins", State: "WY" } },
  ];

  it("builds deterministic exact indexes for canonical clue families", () => {
    const index = buildActContextIndex(rows, {});
    expect(index.organizationName.get("adventure zone")).toEqual(["company-1"]);
    expect(index.contactName.get("merle highchurch")).toEqual(["contact-1"]);
    expect(index.bookingName.get("carbon county fair")).toEqual(["opportunity-1"]);
    expect(index.directContact.get("merle@example.com")).toEqual(["contact-1"]);
    expect(index.websiteHost.get("adventure.example")).toEqual(["company-1"]);
    expect(index.location.get("portland|or")).toEqual(["company-1"]);
    expect(index.eventDate.get("2026-08-12")).toEqual(["opportunity-1"]);
    expect(index.eventLocation.get("rawlins|wy")).toEqual(["opportunity-1"]);
  });

  it("does not treat shared direct-contact values as unique", () => {
    const index = buildActContextIndex([
      ...rows,
      { sourceRecordId: "contact-2", streamType: "contact", rawSnapshot: { FirstName: "Magnus", LastName: "Burnsides", EmailAddress: "merle@example.com" } },
    ], {});
    expect(index.unique("directContact", "merle@example.com")).toBeNull();
  });

  it("extracts only unique allowlisted narrative references and retains sanitized labels", () => {
    const index = buildActContextIndex(rows, {});
    expect(index.narrativeMentions({ subject: "Call Adventure Zone", body: "Merle Highchurch asked about Carbon County Fair." })).toEqual([
      { family: "narrative_context", label: "body mentions booking name", sourceRecordId: "opportunity-1", streamType: "opportunity" },
      { family: "narrative_context", label: "body mentions contact name", sourceRecordId: "contact-1", streamType: "contact" },
      { family: "narrative_context", label: "subject mentions company name", sourceRecordId: "company-1", streamType: "company" },
    ]);
  });

  it("ignores stop words, short names, and never retains timeline body text", () => {
    const index = buildActContextIndex([
      ...rows,
      { sourceRecordId: "company-short", streamType: "company", rawSnapshot: { Name: "The" } },
    ], {});
    const body = "The private timeline body must not be stored.";
    expect(index.narrativeMentions({ body })).toEqual([]);
    expect(JSON.stringify(index)).not.toContain(body);
  });

  it("indexes a representative archive without constructing an all-pairs matrix", () => {
    const archiveSize = 16_252;
    const index = buildActContextIndex(
      Array.from({ length: archiveSize }, (_, position) => ({
        sourceRecordId: `contact-${position.toString().padStart(5, "0")}`,
        streamType: "contact",
        rawSnapshot: {
          FirstName: "Shared",
          LastName: "Contact",
          EmailAddress: "shared@example.com",
        },
      })),
      {},
    );

    expect(index.contactName.size).toBe(1);
    expect(index.directContact.size).toBe(1);
    expect(index.directContact.get("shared@example.com")).toHaveLength(archiveSize);
    expect(index.unique("directContact", "shared@example.com")).toBeNull();
  });
});
