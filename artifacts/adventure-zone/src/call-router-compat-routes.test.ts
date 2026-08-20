import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");

describe("guided call compatibility routes", () => {
  it("registers the call-entry URLs used throughout the app", () => {
    expect(app).toContain('<Route path="/calls/new" component={CallWorkspacePage} />');
    expect(app).toContain('<Route path="/calls/log" component={MobileCallLogPage} />');
  });
});
