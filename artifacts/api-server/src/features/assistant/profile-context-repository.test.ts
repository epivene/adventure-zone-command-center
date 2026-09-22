import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test"; });
import { eventDateAssistantKnowledge } from "./profile-context-repository";

describe("profile assistant event date context", () => {
  it("includes an expected effective date without describing it as booked", () => {
    const result = eventDateAssistantKnowledge({ startsOn: "2027-09-04", endsOn: "2027-09-06", displayStatus: "expected", sourceId: "fact-1" });
    expect(result).toMatchObject({ title: "Next event date" });
    expect(result?.body).toContain("Expected: 2027-09-04 through 2027-09-06");
    expect(result?.body).toContain("not a booking");
    expect(result?.body).not.toContain("Booked:");
  });
});
