import { describe, expect, it } from "vitest";

import { routeAssistantCommand } from "./assistant-command-router";

describe("routeAssistantCommand", () => {
  it("routes broad website checks to the read-only website audit", () => {
    expect(routeAssistantCommand("Check all websites")).toMatchObject({
      kind: "audit",
      capability: "website_verification",
      scope: { kind: "all_applicable" },
      risk: "read_only",
    });
  });

  it("understands the booking-assistant website verification wording", () => {
    expect(routeAssistantCommand(
      "Make sure the profiles/events that have websites, the website works and matched the profile its attached to",
    )).toMatchObject({
      capability: "website_verification",
      risk: "read_only",
    });
  });

  it("routes profile ownership verification wording", () => {
    expect(routeAssistantCommand("Verify our event websites belong to the right profile"))
      .toMatchObject({ capability: "website_verification" });
  });

  it("leaves existing profile search and workflow queries alone", () => {
    expect(routeAssistantCommand("Find Morton County Fair")).toBeNull();
    expect(routeAssistantCommand("Who needs follow-up?")).toBeNull();
  });

  it("does not turn destructive or unsupported requests into executable commands", () => {
    expect(routeAssistantCommand("Delete the wrong websites")).toBeNull();
    expect(routeAssistantCommand("Audit every booking amount")).toBeNull();
    expect(routeAssistantCommand("Run arbitrary SQL against profiles")).toBeNull();
  });
});
