import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ACT Recovery ownership repair UI", () => {
  it("offers ownership repair after a completed recovery and relabels repair counts", () => {
    const page = readFileSync(new URL("./ActRecoveryPage.tsx", import.meta.url), "utf8");
    const client = readFileSync(new URL("../features/act-recovery/act-recovery-client.ts", import.meta.url), "utf8");

    expect(client).toContain("startOwnershipRepair");
    expect(client).toContain('/act-recovery/ownership-repair');
    expect(page).toContain("Repair ACT Note Ownership");
    expect(page).toContain("Already correct");
    expect(page).toContain("Moved / repaired");
  });
});
