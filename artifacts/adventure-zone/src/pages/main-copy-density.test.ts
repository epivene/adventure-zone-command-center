import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const profiles = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");
const contacts = readFileSync("src/pages/ContactsPage.tsx", "utf8");
const bookings = readFileSync("src/pages/BookingsPage.tsx", "utf8");
const schedule = readFileSync("src/pages/SchedulePage.tsx", "utf8");
const needsAnswer = readFileSync("src/pages/NeedsAnswerPage.tsx", "utf8");
const officeToday = readFileSync("src/pages/OfficeTodayPage.tsx", "utf8");

describe("main screen copy density", () => {
  it("removes decorative eyebrow labels from everyday screens", () => {
    expect(bookings).not.toContain(">Pipeline<");
    expect(schedule).not.toContain(">Schedule</p>");
    expect(needsAnswer).not.toContain(">Calling<");
    expect(officeToday).not.toContain(">Booking Workspace<");
  });

  it("uses shorter helper and field copy on surviving screens", () => {
    expect(profiles).toContain("Search events, organizations, and contacts from one CRM directory.");
    expect(bookings).toContain("Bookings, leads, and next steps.");
    expect(bookings).toContain(">Add event<");
    expect(schedule).toContain(">Schedule</h1>");
    expect(needsAnswer).toContain("Questions saved during calls that still need an answer.");
    expect(needsAnswer).toContain("Answer\n");
    expect(officeToday).not.toContain("A clear list of the office work that needs your attention.");
  });

  it("keeps the retired Contacts directory as a redirect instead of a second full page", () => {
    expect(contacts).toContain('params.set("view", "contacts")');
    expect(contacts).toContain("<Redirect");
  });
});
