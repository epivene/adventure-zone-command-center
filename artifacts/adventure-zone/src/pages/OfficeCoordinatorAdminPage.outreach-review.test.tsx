import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => auth);
vi.mock("wouter", () => ({
  useSearch: () => "?tab=emails",
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import OfficeCoordinatorAdminPage from "./OfficeCoordinatorAdminPage";

const email = {
  id: "draft-1",
  officeAccountId: "account-1",
  organizationId: "organization-1",
  contactId: "contact-1",
  bookingId: "booking-1",
  eventYear: 2027,
  recipientEmail: "festival@example.com",
  subject: "Convention follow-up",
  body: "Which package would you like to see first?",
  coordinatorNote: null,
  state: "submitted",
  submittedAt: "2026-09-10T12:00:00.000Z",
  ownerReturnNote: null,
  lastSendError: null,
};
let plannerEnabled = true;
let submittedEmail = email;

describe("owner office email review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plannerEnabled = true;
    submittedEmail = email;
    auth.apiGet.mockImplementation(async (path: string) => {
      if (path === "/office-admin/accounts") return { accounts: [{ id: "account-1", loginName: "office", displayName: "Office", role: "office", enabled: true, sessionVersion: 1, canReviewWebsiteInquiries: false }] };
      if (path === "/office-admin/email-drafts?state=submitted") return { drafts: [submittedEmail] };
      if (path.startsWith("/office-admin/tasks")) return { tasks: [] };
      if (path.startsWith("/office-admin/mail")) return { mail: [] };
      if (path.startsWith("/office-admin/messages")) return { messages: [] };
      if (path === "/outreach-planner/allocations") return { holds: [], demands: [], resources: [], anchors: [], reconciliationFacts: [], allocationEnforcementComplete: true };
      if (path === "/outreach-planner/") return { enabled: plannerEnabled, openings: [], candidates: [], researchTasks: [], legs: [], packages: [] };
      throw new Error(`Unexpected GET ${path}`);
    });
    const review = {
      draft: { kind: "office_email", id: email.id, organizationId: email.organizationId, opportunityId: "opportunity-1", bookingId: email.bookingId, eventYear: email.eventYear, revision: 2, state: email.state, content: { to: email.recipientEmail, subject: email.subject, body: email.body } },
      digest: "c".repeat(64),
      approval: null,
      approvedHold: null,
      approvalCurrent: false,
      dispatch: null,
      reviewReasons: ["Review the final intent."],
      requiresIntentReview: true,
    };
    auth.apiPost.mockImplementation(async (path: string) => {
      if (path === `/outreach-planner/drafts/office_email/${email.id}/review-content`) {
        return auth.apiPut.mock.calls.length ? { ...review, approval: { id: "approval-1" }, approvalCurrent: true, reviewReasons: [] } : review;
      }
      return {};
    });
    auth.apiPut.mockResolvedValue({});
  });

  afterEach(() => cleanup());

  it("keeps the real send action disabled until the exact submitted email is approved", async () => {
    render(<OfficeCoordinatorAdminPage />);

    const send = await screen.findByRole("button", { name: "Send reviewed email" });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review final content" }));
    expect(await screen.findByRole("region", { name: "Exact final email preview" })).toHaveTextContent("Which package would you like to see first?");
    fireEvent.change(screen.getByLabelText("Approval reason"), { target: { value: "I checked the final recipient, message, and intent." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve this exact final content" }));

    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    await waitFor(() => expect(auth.apiPost).toHaveBeenCalledWith(`/office-admin/email-drafts/${email.id}/send`, {}));
  });

  it("preserves the existing Early Bird owner send path while outreach review is disabled", async () => {
    plannerEnabled = false;
    submittedEmail = { ...email, id: "draft-early-bird", subject: "Early Bird Promo reminder", body: "The existing prepared Early Bird body" };
    render(<OfficeCoordinatorAdminPage />);

    expect(await screen.findByText("Early Bird 15-day reminder")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(screen.queryByLabelText("Final outreach review")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(auth.apiPost).toHaveBeenCalledWith("/office-admin/email-drafts/draft-early-bird/send", {}));
  });
});
