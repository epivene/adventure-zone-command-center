import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entryCard = readFileSync("src/components/paper-notes/paper-note-entry-card.tsx", "utf8");
const entryPanel = readFileSync("src/components/paper-notes/paper-note-entry-panel.tsx", "utf8");
const batchReview = readFileSync("src/pages/PaperNoteBatchReviewPage.tsx", "utf8");

describe("paper notes dark theme", () => {
  it("uses theme tokens for the shared review accordions and entry card", () => {
    expect(entryCard).toContain("border-border bg-card");
    expect(entryCard).toContain("text-card-foreground");
    expect(entryCard).toContain("text-muted-foreground");
    expect(entryCard).not.toContain("bg-slate-50/60");
    expect(entryCard).not.toContain("bg-white/80");
  });

  it("uses theme-aware loading and batch surfaces", () => {
    expect(entryPanel).toContain("border-border bg-card");
    expect(batchReview).toContain("border-border bg-card");
  });
});
