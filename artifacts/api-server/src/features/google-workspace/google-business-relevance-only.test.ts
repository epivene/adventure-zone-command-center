import { describe, expect, it } from "vitest";

import { buildGoogleScopePreview } from "./google-scope-service";
import { classifyGoogleMessageRelevance } from "./google-relevance-classifier";

describe("Google Workspace business relevance only", () => {
  it("does not approve Receipt, Spam, or Trash as business scope roots", () => {
    const preview = buildGoogleScopePreview(
      [
        { id: "shows", name: "Shows", type: "user" },
        { id: "receipt", name: "Receipt", type: "user" },
        { id: "off-season", name: "Off Season Business Opportunities", type: "user" },
        { id: "employees", name: "Employees", type: "user" },
        { id: "associations", name: "Associations", type: "user" },
        { id: "SPAM", name: "SPAM", type: "system" },
        { id: "TRASH", name: "TRASH", type: "system" },
      ],
      [
        { id: "az", summary: "Adventure Zone Calendar", primary: false },
        { id: "pirates", summary: "Pirate's Rebellion Calendar", primary: false },
        { id: "warriors", summary: "Warrior's Playground Calendar", primary: false },
        {
          id: "zone.pirate.warrior@gmail.com",
          summary: "Zone Pirate Warrior",
          primary: true,
        },
      ],
    );

    expect(preview.labels.map((label) => label.id)).toEqual([
      "shows",
      "off-season",
      "employees",
      "associations",
    ]);
    expect(preview.excludedLabels.map((label) => label.id)).toEqual([
      "receipt",
      "SPAM",
      "TRASH",
    ]);
    expect(preview.missingLabelRoots).toEqual([]);
  });

  it("ignores owner-only personal mail when no CRM evidence is present", () => {
    const result = classifyGoogleMessageRelevance({
      message: {
        id: "personal-1",
        threadId: "personal-thread",
        labelIds: ["INBOX", "IMPORTANT", "STARRED"],
        internalDateMs: 1787510000000,
        snippet: "Your personal account statement is ready.",
        headers: {
          from: "Personal Service <notice@example.com>",
          to: "David Gordon <owner@example.com>",
          cc: "",
          subject: "Personal account notice",
          date: "Sun, 23 Aug 2026 10:00:00 -0600",
        },
        hasAttachments: false,
      },
      evidence: {
        approvedLabelIds: new Set(["shows", "off-season", "employees", "associations"]),
        contacts: [],
        organizations: [],
        profiles: [],
        existingThreadTarget: null,
      },
    });

    expect(result).toEqual({
      status: "ignored",
      evidenceCodes: [],
      candidates: [],
    });
  });
});
