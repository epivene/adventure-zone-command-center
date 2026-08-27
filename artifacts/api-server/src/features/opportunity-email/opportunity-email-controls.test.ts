import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { bookingOpportunities } from "@/db/schema";

describe("Opportunity email review controls", () => {
  it("stores protected automation and approved territory exception explicitly", () => {
    const columns = getTableColumns(bookingOpportunities);

    expect(columns).toHaveProperty("emailAutomationProtected");
    expect(columns).toHaveProperty("territoryExceptionApproved");
  });
});
