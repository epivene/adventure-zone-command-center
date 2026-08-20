import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "assistant-message.tsx"), "utf8");

describe("Assistant message mode labels", () => {
  it("does not label live cloud answers as Deeper AI", () => {
    expect(source).not.toContain("Deeper AI");
  });

  it("keeps useful offline and Command Center data labels", () => {
    expect(source).toContain("Offline saved data");
    expect(source).toContain("Command Center data");
  });
});
