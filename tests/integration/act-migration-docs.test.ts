import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const runbookPath = path.join(
  process.cwd(),
  "docs",
  "operations",
  "act-migration.md",
);

describe("Act migration operations documentation", () => {
  it("defines the complete preview-only operator contract", async () => {
    const contents = await readFile(runbookPath, "utf8");

    for (const variable of [
      "ACT_API_BASE_URL",
      "ACT_DATABASE_NAME",
      "ACT_USERNAME",
      "ACT_PASSWORD",
    ]) {
      expect(contents).toContain(variable);
    }

    for (const safetyConcept of [
      "read-only Act! API",
      "does not apply CRM records",
      "stable Act! IDs",
      "resume",
      "reconciliation",
      "Places without People",
      "Opportunities without a reliable Place",
      "source absence never deletes",
      "raw PII",
      "Slice 3",
    ]) {
      expect(contents).toContain(safetyConcept);
    }

    for (const operatorTopic of [
      "Test connection",
      "Start preview snapshot",
      "bounded progress",
      "projected-query compatibility fallback",
      "retryable",
      "non-retryable",
      "Preview states and allowed decisions",
      "Reconciliation counts",
      "Proof that no local CRM records are applied",
      "Evidence required before Slice 3",
      "Abandoning a bad run safely",
      "Credential and PII logging rules",
    ]) {
      expect(contents).toContain(operatorTopic);
    }

    for (const previewState of [
      "new",
      "matched_unchanged",
      "change",
      "new_relationship",
      "possible_duplicate",
      "needs_review",
      "ignored",
      "error",
    ]) {
      expect(contents).toContain(`\`${previewState}\``);
    }

    for (const decision of [
      "approve_proposed",
      "link_existing",
      "keep_separate",
      "ignore",
    ]) {
      expect(contents).toContain(`\`${decision}\``);
    }

    expect(contents).toContain("at most 10 Act! requests");
    expect(contents).toContain("stored preview");
    expect(contents).toContain("stored review decisions");
    expect(contents).toContain("never silently fetches or rematches");
    expect(contents).toContain("no Apply or Import action");
    expect(contents).toMatch(
      /after a timeout or uncertain result,\s+reload and select or resume the newest stored run/i,
    );
    expect(contents).not.toContain("repeat idempotent");
    expect(contents).toMatch(
      /minimum\s+necessary PII is visible only in the owner-only review/,
    );
    expect(contents).toContain("`displaySnapshot` fields");
    expect(contents).toMatch(
      /Free-text review\s+reasons must contain no PII, secrets, or copied source values\./,
    );
    expect(contents).toContain("redacted, PII-free evidence");
    expect(contents).toContain("act_migration_runs");
    expect(contents).toContain("source_digest");
    expect(contents).toContain("proposal_digest");
    expect(contents).toContain(":run_id");
    expect(contents).toContain(
      "Slice 2 has no local Calling-list entity table or storage",
    );
    expect(contents).toContain("organizations");
    expect(contents).toContain("organization_contacts");
    expect(contents).toContain("booking_contacts");
    expect(contents).toMatch(/delimited\s+`test` token/);
    expect(contents).toContain("exactly one URL authority host");
    expect(contents).toMatch(
      /at most one raw `@` credential\s+separator/,
    );
    expect(contents).toContain("host override parameters are not allowed");
    expect(contents).toContain("terminal DNS dots");
    expect(contents).toContain("unsupported_group_count");
    expect(contents).toContain("group_target_unavailable");
    expect(contents).toContain("group_membership_semantics_unknown");
    expect(contents).toMatch(
      /The stored summary does not contain the unsupported Group\s+count\./,
    );

    const commandBlockList = [
      ...contents.matchAll(/```[^\n]*\n([\s\S]*?)```/g),
    ]
      .map((match) => match[1])
      .filter((block): block is string => block !== undefined);
    const commandBlocks = commandBlockList.join("\n");
    expect(commandBlocks).not.toMatch(/\.xls\b/i);

    const databaseGateBlock = commandBlockList.find((block) =>
      block.includes("npm run test:crm-db"),
    );
    expect(databaseGateBlock).toBeDefined();
    expect(databaseGateBlock).toContain("[Uri]::TryCreate");
    expect(databaseGateBlock).toContain("$env:DATABASE_URL");
    expect(databaseGateBlock).toContain("Host.Contains");
    expect(databaseGateBlock).toContain(
      '[regex]::Matches($authority, "@").Count',
    );
    expect(databaseGateBlock).toContain("TrimEnd");
    expect(databaseGateBlock).toContain(
      "(?i)(^|[^a-z0-9])test($|[^a-z0-9])",
    );
    expect(databaseGateBlock?.indexOf("[Uri]::TryCreate")).toBeLessThan(
      databaseGateBlock?.indexOf('$env:CRM_RELEASE_TESTS = "1"') ?? -1,
    );
  });
});
