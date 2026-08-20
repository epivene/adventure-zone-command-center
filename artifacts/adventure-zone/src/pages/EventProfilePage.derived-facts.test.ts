import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const reviewSource = readFileSync(
  join(here, "../components/assistant/derived-facts-review.tsx"),
  "utf8",
);

describe("EventProfilePage ACT history analysis", () => {
  it("keeps the old assistant history review UI retired", () => {
    expect(reviewSource).toContain("return null");
    expect(reviewSource).not.toContain("Assistant history analysis");
    expect(reviewSource).not.toContain("Analyze ACT history");
  });
});
