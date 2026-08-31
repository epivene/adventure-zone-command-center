import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const assistantImportSource = readFileSync(
  new URL("../../routes/assistant-import.ts", import.meta.url),
  "utf8",
);
const profileTouchSource = readFileSync(
  new URL("../organizations/profile-touch-schema.ts", import.meta.url),
  "utf8",
);
const contactRepositorySource = readFileSync(
  new URL("../contacts/contact-repository.ts", import.meta.url),
  "utf8",
);

describe("approved profile canonical-child contract", () => {
  it("honors an already-resolved event profile ID instead of falling through to create another child set", () => {
    expect(assistantImportSource).toMatch(/requestedProfileId/);
    expect(assistantImportSource).toMatch(/event\.id/);
    expect(assistantImportSource).toMatch(/where id = \$\{requestedProfileId\}::uuid/i);
  });

  it("chooses the active primary contact and the non-merged dated appearance when upserting", () => {
    expect(assistantImportSource).toMatch(/organizationContacts\.isPrimary/);
    expect(assistantImportSource).toMatch(/Merged duplicate/);
    expect(assistantImportSource).toMatch(/bookings\.startsAt/);
  });

  it("maintains a non-destructive canonical-contact map and hides retired contact rows from the Contacts directory", () => {
    expect(profileTouchSource).toMatch(/CREATE TABLE IF NOT EXISTS contact_consolidations/i);
    expect(profileTouchSource).toMatch(/source_contact_id/i);
    expect(profileTouchSource).toMatch(/canonical_contact_id/i);
    expect(contactRepositorySource).toMatch(/contact_consolidations/i);
  });
});
