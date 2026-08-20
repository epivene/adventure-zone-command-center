import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "assistant.ts"), "utf8");

describe("Booking Assistant owner actor identity", () => {
  it("uses the existing single-owner actor namespace when password auth has no user id", () => {
    expect(source).toContain("function assistantActorId");
    expect(source).toContain('String((req as any).userId ?? "")');
    expect(source).toContain("const actorId = assistantActorId(req)");
  });

  it("does not pass an undefined request user id into conversation persistence", () => {
    expect(source).not.toContain("const actorId = (req as any).userId as string");
  });
});
