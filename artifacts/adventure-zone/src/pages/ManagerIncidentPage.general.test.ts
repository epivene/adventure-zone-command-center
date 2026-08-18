import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/ManagerIncidentPage.tsx", "utf8");
const menu = readFileSync("src/components/manager/manager-menu.tsx", "utf8");
const list = readFileSync("src/pages/ManagerIncidentsPage.tsx", "utf8");

describe("general manager incidents", () => {
  it("makes general incident reporting available without an event or trip", () => {
    expect(page).toContain("General incident");
    expect(page).toContain("No event or trip is required");
    expect(page).toContain("bookingId:null");
    expect(page).toContain("tripId:null");
    expect(menu).toContain("Report General Incident");
    expect(list).toContain("Report General Incident");
  });
});
