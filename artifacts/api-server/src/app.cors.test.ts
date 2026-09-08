import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync("src/app.ts", "utf8");

describe("application CORS", () => {
  it("allows the filename header used by protected document uploads", () => {
    expect(appSource).toContain('allowedHeaders: ["Content-Type", "Authorization", "X-File-Name"]');
  });
});
