import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GoogleRecentValidation } from "./google-recent-validation";

const result = {
  checkedLimit: 100,
  aiEnabled: false as const,
  historicalImportStarted: false as const,
  counts: { discovered: 3, matched: 1, needsReview: 1, ignored: 1 },
  matched: [
    {
      id: "m1",
      threadId: "t1",
      subject: "County Fair contract",
      from: "booking@fair.org",
      to: "zone@example.com",
      date: "",
      internalDateMs: 1,
      labelIds: ["INBOX"],
      labels: [{ id: "INBOX", name: "INBOX", type: "system" as const }],
      hasAttachments: true,
      evidenceCodes: ["exact_contact_email"],
      candidates: [{ id: "c1", name: "Fair Office", kind: "contact" as const }],
    },
  ],
  needsReview: [
    {
      id: "m2",
      threadId: "t2",
      subject: "Known Festival vendor info",
      from: "events@gmail.com",
      to: "zone@example.com",
      date: "",
      internalDateMs: 2,
      labelIds: ["Label_Potential"],
      labels: [{ id: "Label_Potential", name: "Potential shows/Known Festival", type: "user" as const }],
      hasAttachments: false,
      evidenceCodes: ["approved_business_label", "exact_profile_name_text"],
      candidates: [{ id: "p1", name: "Known Festival", kind: "profile" as const }],
    },
  ],
  ignored: [
    {
      id: "m3",
      threadId: "t3",
      subject: "Dinner plans",
      from: "friend@gmail.com",
      to: "zone@example.com",
      date: "",
      internalDateMs: 3,
      labelIds: ["INBOX"],
      labels: [{ id: "INBOX", name: "INBOX", type: "system" as const }],
      hasAttachments: false,
      evidenceCodes: [],
      candidates: [],
    },
  ],
};

afterEach(cleanup);

describe("GoogleRecentValidation", () => {
  it("shows bounded sample counts, evidence, and keeps ignored mail collapsible", () => {
    render(<GoogleRecentValidation result={result} />);

    expect(screen.getByText("3 checked")).toBeInTheDocument();
    expect(screen.getByText("1 matched")).toBeInTheDocument();
    expect(screen.getByText("1 needs review")).toBeInTheDocument();
    expect(screen.getByText("1 ignored")).toBeInTheDocument();
    expect(screen.getByText("County Fair contract")).toBeInTheDocument();
    expect(screen.getByText("Exact contact email")).toBeInTheDocument();
    expect(screen.queryByText("Dinner plans")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /review ignored email/i }));
    expect(screen.getByText("Dinner plans")).toBeInTheDocument();
  });
});
