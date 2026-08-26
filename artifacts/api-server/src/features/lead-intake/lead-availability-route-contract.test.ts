import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const routeUrl = new URL("../../routes/lead-intake.ts", import.meta.url);
describe("lead availability route contract", () => {
  it("checks availability through the selected Google Calendar read client without Gmail or Calendar mutations", async () => {
    const source = await readFile(routeUrl, "utf8");
    expect(source).toContain('router.post("/lead-intake/rows/:rowId/check-availability"');
    expect(source).toContain("LeadAvailabilityService");
    expect(source).toContain("LeadAvailabilityRepository");
    expect(source).toContain("GOOGLE_REAUTHORIZATION_REQUIRED");
    expect(source).toContain("GOOGLE_CALENDAR_UNAVAILABLE");
    expect(source).toContain("ROW_NOT_FOUND");
    expect(source).toContain("VERSION_CONFLICT");
    expect(source).toContain("AVAILABILITY_NOT_READY");
    expect(source).toContain("res.status(409)");
    expect(source).toContain("res.status(422)");
    expect(source).toContain("res.status(503)");
    for (const forbidden of ["createDraft", "sendMail", "calendar.events.insert"]) expect(source).not.toContain(forbidden);
  });
});