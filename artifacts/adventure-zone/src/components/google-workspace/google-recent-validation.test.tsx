import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  decideGoogleWorkspaceValidationSample: vi.fn(),
}));
vi.mock("@/features/google-workspace/google-workspace-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/google-workspace/google-workspace-client")>();
  return { ...actual, decideGoogleWorkspaceValidationSample: client.decideGoogleWorkspaceValidationSample };
});
vi.mock("./google-validation-review", () => ({
  GoogleValidationReview: () => <div>Actionable Needs Review panel</div>,
}));

import { GoogleRecentValidation } from "./google-recent-validation";

const result = {
  checkedLimit: 100,
  aiEnabled: false as const,
  historicalImportStarted: false as const,
  validationStatus: "ready_for_review" as const,
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
      evidenceCodes: ["exact_contact_email", "contact_active_organization"],
      candidates: [{ id: "c1", name: "Fair Office", kind: "contact" as const }],
      matchedContact: { id: "c1", name: "Fair Office" },
      resolvedOrganization: { id: "org-1", name: "County Fair" },
      organizationCandidates: [{ id: "org-1", name: "County Fair" }],
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
      matchedContact: null,
      resolvedOrganization: null,
      organizationCandidates: [],
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
      matchedContact: null,
      resolvedOrganization: null,
      organizationCandidates: [],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GoogleRecentValidation", () => {
  it("shows bounded sample counts, contact-to-profile resolution, actionable review, and collapsible ignored mail", () => {
    render(<GoogleRecentValidation result={result} />);

    expect(screen.getByText("3 checked")).toBeInTheDocument();
    expect(screen.getByText("1 matched")).toBeInTheDocument();
    expect(screen.getByText("1 needs review")).toBeInTheDocument();
    expect(screen.getByText("1 ignored")).toBeInTheDocument();
    expect(screen.getByText("County Fair contract")).toBeInTheDocument();
    expect(screen.getByText("Exact contact email")).toBeInTheDocument();
    expect(screen.getByText("Matched contact: Fair Office")).toBeInTheDocument();
    expect(screen.getByText("Profile: County Fair")).toBeInTheDocument();
    expect(screen.getByText("Actionable Needs Review panel")).toBeInTheDocument();
    expect(screen.getByText(/1 item in Needs Review will stay unlinked/i)).toBeInTheDocument();
    expect(screen.queryByText("Dinner plans")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /review ignored email/i }));
    expect(screen.getByText("Dinner plans")).toBeInTheDocument();
  });

  it("lets the owner approve only the resolved matches without starting historical import", async () => {
    client.decideGoogleWorkspaceValidationSample.mockResolvedValue({
      validationStatus: "approved",
      historicalImportStarted: false,
    });
    render(<GoogleRecentValidation result={result} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve resolved matches" }));

    await waitFor(() =>
      expect(client.decideGoogleWorkspaceValidationSample).toHaveBeenCalledWith("approve"),
    );
    expect(await screen.findByText(/Sample approved/i)).toBeInTheDocument();
    expect(screen.getByText(/historical import is still off/i)).toBeInTheDocument();
  });
});
