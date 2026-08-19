import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "EventProfilePage.tsx"), "utf8");

describe("EventProfilePage ACT history analysis", () => {
  it("mounts the derived-facts review on the organization profile", () => {
    expect(source).toContain('import { DerivedFactsReview } from "@/components/assistant/derived-facts-review"');
    expect(source).toContain("<DerivedFactsReview organizationId={profileId} />");
  });
});
