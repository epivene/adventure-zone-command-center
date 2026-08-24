import { describe, expect, it } from "vitest";

import { businessHintLabelIds } from "./google-recent-validation-service";

const labels = [
  { id: "p", name: "Potential shows", type: "user" as const },
  { id: "p1", name: "Potential shows/County Fair", type: "user" as const },
  { id: "e", name: "BUSINESS EXPENSES", type: "user" as const },
  { id: "e1", name: "BUSINESS EXPENSES/Hotels", type: "user" as const },
  { id: "b", name: "BANKING & LOANS/Venmo", type: "user" as const },
  { id: "personal", name: "Family", type: "user" as const },
  { id: "INBOX", name: "INBOX", type: "system" as const },
];

describe("businessHintLabelIds", () => {
  it("uses Potential shows as a business hint but does not promote finance labels by themselves", () => {
    expect([...businessHintLabelIds(labels)]).toEqual(["p", "p1"]);
  });
});
