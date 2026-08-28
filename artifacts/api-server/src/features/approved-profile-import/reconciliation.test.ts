import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

function normalized(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

type ReconciliationRecord = {
  canonicalName: string;
  aliases?: string[];
  followUps?: Array<{ label: string; reason: string; dueAt: string }>;
  clearFollowUps?: boolean;
};

describe("2026-08-28 approved-profile reconciliation", () => {
  it("covers exactly 53 records and each record maps to one approved profile file", async () => {
    const root = path.resolve(process.cwd(), "../..");
    const reconciliationPath = path.join(root, "imports", "approved-profile-reconciliation-2026-08-28.json");
    const approvedDir = path.join(root, "imports", "approved-profiles");

    const records = JSON.parse(await readFile(reconciliationPath, "utf8")) as ReconciliationRecord[];
    expect(records).toHaveLength(53);

    const files = (await readdir(approvedDir)).filter((file) => file.endsWith(".json"));
    const approved = await Promise.all(files.map(async (file) => {
      const payload = JSON.parse(await readFile(path.join(approvedDir, file), "utf8")) as {
        event?: { name?: unknown };
      };
      return { file, eventName: normalized(payload.event?.name) };
    }));

    const mappingProblems: string[] = [];
    for (const record of records) {
      const names = [record.canonicalName, ...(record.aliases ?? [])].map(normalized);
      const matches = approved.filter((item) => item.eventName && names.includes(item.eventName));
      if (matches.length !== 1) {
        mappingProblems.push(`${record.canonicalName}: ${matches.length} approved-profile matches${matches.length ? ` (${matches.map((match) => match.file).join(", ")})` : ""}`);
      }

      const followUps = record.followUps ?? [];
      if (record.clearFollowUps) expect(followUps).toHaveLength(0);
      for (const followUp of followUps) {
        expect(followUp.label.trim().length).toBeGreaterThan(0);
        expect(followUp.reason.trim().length).toBeGreaterThan(0);
        expect(Number.isNaN(new Date(followUp.dueAt).getTime())).toBe(false);
      }
    }

    expect(mappingProblems, `Reconciliation mapping problems:\n${mappingProblems.join("\n")}`).toEqual([]);
  });

  it("does not reuse one approved profile file for multiple reconciliation records", async () => {
    const root = path.resolve(process.cwd(), "../..");
    const reconciliationPath = path.join(root, "imports", "approved-profile-reconciliation-2026-08-28.json");
    const approvedDir = path.join(root, "imports", "approved-profiles");
    const records = JSON.parse(await readFile(reconciliationPath, "utf8")) as ReconciliationRecord[];
    const files = (await readdir(approvedDir)).filter((file) => file.endsWith(".json"));

    const usage = new Map<string, string[]>();
    for (const file of files) {
      const payload = JSON.parse(await readFile(path.join(approvedDir, file), "utf8")) as {
        event?: { name?: unknown };
      };
      const eventName = normalized(payload.event?.name);
      if (!eventName) continue;
      for (const record of records) {
        const names = [record.canonicalName, ...(record.aliases ?? [])].map(normalized);
        if (!names.includes(eventName)) continue;
        usage.set(file, [...(usage.get(file) ?? []), record.canonicalName]);
      }
    }

    const duplicateUsage = [...usage.entries()]
      .filter(([, names]) => names.length !== 1)
      .map(([file, names]) => `${file}: ${names.join(", ")}`);
    expect(duplicateUsage, `Approved-profile files claimed by multiple records:\n${duplicateUsage.join("\n")}`).toEqual([]);
  });
});
