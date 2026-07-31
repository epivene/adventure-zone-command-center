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

    const commandBlocks = [...contents.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .join("\n");
    expect(commandBlocks).not.toMatch(/\.xls\b/i);
  });
});
