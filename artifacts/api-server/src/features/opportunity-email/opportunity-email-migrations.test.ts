import { describe, expect, it } from "vitest";

import { loadActReviewMigrations } from "@workspace/db/migrations";

describe("Opportunity email startup migrations", () => {
  it("registers persistence, dispatcher lease, and review-control migrations in order", async () => {
    const names = (await loadActReviewMigrations()).map(({ name }) => name);
    const emailMigrations = names.filter((name) => name.startsWith("07"));

    expect(emailMigrations).toEqual([
      "070_booking_opportunities.sql",
      "071_booking_opportunity_email_state.sql",
      "072_booking_opportunity_email_dispatch.sql",
      "073_booking_opportunity_email_controls.sql",
    ]);
  });
});
