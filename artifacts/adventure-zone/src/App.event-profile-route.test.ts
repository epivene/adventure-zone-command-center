import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("event profile route wiring", () => {
  it("names the legacy event-profile route parameter profileId so EventProfilePage can load it", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('path="/event-profiles/:profileId"');
    expect(source).not.toContain('path="/event-profiles/:id">{(params)=><EventProfilePage');
  });
});
