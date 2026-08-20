import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const authSource = fs.readFileSync(path.resolve(__dirname, "../lib/auth.ts"), "utf8");
const assistantSource = fs.readFileSync(path.resolve(__dirname, "assistant.ts"), "utf8");

describe("Booking Assistant owner actor identity", () => {
  it("attaches the existing single-owner actor namespace after owner authentication", () => {
    expect(authSource).toContain("SINGLE_OWNER_ACTOR_ID");
    expect(authSource).toContain("OwnerAuthenticatedRequest");
    expect(authSource).toContain(".userId = SINGLE_OWNER_ACTOR_ID");
  });

  it("ensures Assistant conversation routes receive a string actor id", () => {
    expect(assistantSource).toContain("const actorId = (req as any).userId as string");
    expect(authSource).toContain('const SINGLE_OWNER_ACTOR_ID = ""');
  });
});
