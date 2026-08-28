import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/leg-manager/event-wrap-up-service.ts", "utf8");

describe("manager event report closeout boundary", () => {
  it("does not require office cash closeout before a manager can submit an event report", () => {
    expect(source).not.toContain("Enter actual cash on hand before submitting");
  });
});
