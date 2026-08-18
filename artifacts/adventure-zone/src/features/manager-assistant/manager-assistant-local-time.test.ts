import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync("src/features/manager-assistant/manager-assistant-api.ts", "utf8");
const lifecycleSource = readFileSync("src/components/manager/event-lifecycle-action.tsx", "utf8");

describe("manager local time handling", () => {
  it("sends the browser IANA time zone to both lifecycle actions and assistant asks", () => {
    expect(apiSource).toContain("Intl.DateTimeFormat().resolvedOptions().timeZone");
    expect(apiSource).toContain("timeZone: deviceTimeZone()");
    expect(lifecycleSource).toContain("Intl.DateTimeFormat().resolvedOptions().timeZone");
    expect(lifecycleSource).toContain("timeZone: deviceTimeZone()");
  });
});
