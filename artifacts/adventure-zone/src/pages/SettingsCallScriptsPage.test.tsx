import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/SettingsCallScriptsPage.tsx", "utf8");

describe("Call Scripts settings page", () => {
  it("offers the editable wording controls and protected-workflow explanation", () => {
    expect(page).toContain("Call Scripts");
    expect(page).toContain("Say this");
    expect(page).toContain("Coaching tip");
    expect(page).toContain("Preview");
    expect(page).toContain("Customized");
    expect(page).toContain("Save changes");
    expect(page).toContain("Reset to Adventure Zone default");
    expect(page).toContain("response buttons and call outcomes stay protected");
  });

  it("exposes simple placeholder insertion controls", () => {
    expect(page).toContain("Contact name");
    expect(page).toContain("Event name");
    expect(page).toContain("Event date");
    expect(page).toContain("Location");
    expect(page).toContain("Package interest");
  });

  it("shows the new objection wording as editable script steps", () => {
    expect(page).toContain("Already booked / future season");
    expect(page).toContain("Space constraint");
    expect(page).toContain("Budget constraint");
    expect(page).toContain("Event not happening");
    expect(page).toContain("Policy restriction");
    expect(page).toContain("Past-customer feedback");
  });

  it("treats an intentionally blank customized coaching tip as blank", () => {
    expect(page).toContain('override ? (override.coachText ?? "") : (node.coach ?? "")');
  });
});
