import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("EventFamilyPage member links", () => {
  it("opens member organizations through the canonical profiles route", () => {
    const source = readFileSync(new URL("./EventFamilyPage.tsx", import.meta.url), "utf8");

    expect(source).toContain('href={`/profiles/${member.id}`}');
    expect(source).not.toContain('href={`/event-profiles/${member.id}`}');
  });
});
