import { describe, expect, it } from "vitest";

import { organizationMergeFailureMessage } from "./organization-merge-error";

describe("organization merge failure messages", () => {
  it("includes safe PostgreSQL constraint diagnostics", () => {
    expect(
      organizationMergeFailureMessage({
        code: "23503",
        constraint: "contract_agreements_organization_id_fkey",
      }),
    ).toBe(
      "Failed to merge profiles (23503: contract_agreements_organization_id_fkey)",
    );
  });

  it("keeps non-constraint errors generic", () => {
    expect(organizationMergeFailureMessage(new Error("secret connection text"))).toBe(
      "Failed to merge profiles",
    );
  });
});
