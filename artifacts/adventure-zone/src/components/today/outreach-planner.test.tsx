import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getPlanner: vi.fn(), getAllocations: vi.fn(), createOpening: vi.fn(), setOpeningStatus: vi.fn(),
  searchOpportunities: vi.fn(), searchProfiles: vi.fn(), admitProfile: vi.fn(), addCandidate: vi.fn(),
  patchCandidate: vi.fn(), checkCandidate: vi.fn(), reviewHistory: vi.fn(), linkAttempt: vi.fn(), reviewSource: vi.fn(), reviewInbound: vi.fn(), advanceCandidate: vi.fn(),
  saveCandidateDemand: vi.fn(), createHold: vi.fn(), releaseHold: vi.fn(), extendHold: vi.fn(), requestResearch: vi.fn(), saveResearchResults: vi.fn(),
  getRecoveryCatalog: vi.fn(), saveCommittedDemand: vi.fn(), changeCommitment: vi.fn(), saveRouteAnchor: vi.fn(), revokeRouteAnchor: vi.fn(), reviewImportedSource: vi.fn(),
  reviewDraftContent: vi.fn(), approveDraft: vi.fn(), getDispatches: vi.fn(), reconcileDispatch: vi.fn(),
}));
const trip = vi.hoisted(() => ({ geocodeAddressAction: vi.fn() }));
const auth = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiPut: vi.fn() }));
vi.mock("@/features/outreach-planner/outreach-api", async (original) => ({ ...(await original()), ...api }));
vi.mock("@/actions/trips", async (original) => ({ ...(await original()), ...trip }));
vi.mock("@/lib/auth-token", () => auth);

import { AssistantContextProvider } from "@/features/assistant/assistant-context";
import { OutreachDraftReviewControl, OutreachPlanner, OutreachProfileSummary } from "./outreach-planner";
import { OpportunityDraftComposer } from "@/components/opportunities/opportunity-draft-composer";

const opening = { id: "opening-1", title: "October route opening", status: "open", eventYear: 2026, startsOn: "2026-10-01", endsOn: "2026-10-10", legId: "leg-1", quantities: { show: 1 }, createdAt: "2026-09-01T00:00:00Z" } as const;
function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1", openingId: opening.id, opportunityId: "opportunity-1", organizationId: "organization-1", bookingId: "booking-1", organizationName: "County Fair", eventYear: 2026,
    eventStartsAt: "2026-10-04T14:00:00Z", eventEndsAt: "2026-10-05T22:00:00Z", opportunityStatus: "prospecting", tier: "convention", manualRank: 1, snoozedUntil: null, cadenceOverride: null,
    decisionDueAt: null, meaningfulReplyAt: null, conventionEndsOn: "2026-09-01", releasedAt: null, checkedAt: "2026-09-10T12:00:00Z", suggestions: [{ tier: "convention", reason: "Linked Expo member", conventionYear: 2025 }],
    attempts: [], outreach: { state: "ready", dueAt: null, reason: "Initial outreach is ready.", nextStage: "initial" }, capacity: { status: "fits", reasons: [] }, capacityDisplayReasons: [], waitingFor: null, waitingForCandidateId: null,
    portfolio: { state: "first_choice", reason: "First verified pursuit across competing openings.", competing: [] }, liveHoldId: null,
    sources: { checkedAt: "2026-09-10T12:00:00Z", choices: [{ id: "source-1", kind: "sent_email", occurredAt: "2026-09-09T12:00:00Z", eligible: true, reason: "Successful Gmail delivery", purpose: "new_outreach", explicitStage: "initial" }], reviewReasons: [], protectedReason: null, manualNextActions: [], historyFingerprint: "facts-1", inboundObservations: [] },
    ...overrides,
  };
}
function planner(overrides: Record<string, unknown> = {}) {
  return { enabled: true, openings: [opening], candidates: [candidate()], researchTasks: [], legs: [{ id: "leg-1", name: "Northern route", active: true }], packages: [{ id: "package-1", code: "show", name: "Adventure Show", active: true, normalCapacity: 1, temporaryUnavailableQuantity: 0 }], ...overrides };
}
const allocations = { holds: [], demands: [], resources: [{ id: "resource-1", name: "Show trailer", code: "trailer", category: "equipment", status: "available", movable: true, normal_travel_leg_id: "leg-1" }], anchors: [], reconciliationFacts: [], allocationEnforcementComplete: true };
function view() { return render(<AssistantContextProvider><OutreachPlanner /></AssistantContextProvider>); }

beforeEach(() => {
  vi.resetAllMocks();
  api.getPlanner.mockResolvedValue(planner()); api.getAllocations.mockResolvedValue(allocations);
  for (const name of ["createOpening", "setOpeningStatus", "addCandidate", "patchCandidate", "checkCandidate", "reviewHistory", "linkAttempt", "reviewSource", "reviewInbound", "advanceCandidate", "saveCandidateDemand", "createHold", "releaseHold", "extendHold", "requestResearch", "saveCommittedDemand", "changeCommitment", "saveRouteAnchor", "revokeRouteAnchor", "reviewImportedSource", "approveDraft", "reconcileDispatch"] as const) api[name].mockResolvedValue({});
  api.searchOpportunities.mockResolvedValue([]); api.searchProfiles.mockResolvedValue([]); api.getRecoveryCatalog.mockResolvedValue({ bookings: [], drafts: [] }); api.getDispatches.mockResolvedValue([]);
  trip.geocodeAddressAction.mockResolvedValue({ ok: true, results: [{ latitude: 44.1, longitude: -93.2, displayName: "Mankato, Minnesota" }] });
  auth.apiPost.mockResolvedValue({}); auth.apiPatch.mockResolvedValue({});
});
afterEach(cleanup);

describe("outreach booking workspace", () => {
  it("renders nothing when the feature is disabled", async () => {
    api.getPlanner.mockResolvedValue({ ...planner(), enabled: false, openings: [], candidates: [], legs: [], packages: [] });
    const result = view(); await waitFor(() => expect(api.getPlanner).toHaveBeenCalled());
    expect(result.container).toBeEmptyDOMElement(); expect(api.getAllocations).not.toHaveBeenCalled();
  });

  it("keeps a failed initial load visible and lets the owner retry", async () => {
    api.getPlanner.mockRejectedValueOnce(new Error("Planner connection interrupted")).mockResolvedValueOnce(planner());
    view();
    expect(await screen.findByRole("alert")).toHaveTextContent("Planner connection interrupted");
    fireEvent.click(screen.getByRole("button", { name: "Retry outreach priorities" }));
    expect(await screen.findByRole("heading", { name: "Booking priority workspace" })).toBeInTheDocument();
    expect(api.getPlanner).toHaveBeenCalledTimes(2);
  });

  it("uses portfolio state for contact-next and keeps replies, contention, and unknown capacity in review", async () => {
    api.getPlanner.mockResolvedValue(planner({ candidates: [
      candidate(),
      candidate({ id: "candidate-2", organizationId: "organization-2", bookingId: null, organizationName: "River Festival", portfolio: { state: "waiting", reason: "One trailer is already pursued for County Fair.", competing: [] }, waitingFor: { candidateId: "candidate-1", organizationName: "County Fair", openingId: opening.id, openingTitle: opening.title, reason: "Same scarce trailer" }, outreach: { state: "ready", dueAt: null, reason: "Cadence ready", nextStage: "initial" } }),
      candidate({ id: "candidate-3", organizationId: "organization-3", organizationName: "Prairie Expo", portfolio: { state: "attention", reason: "A reply needs owner review.", competing: [] }, outreach: { state: "reply", dueAt: null, reason: "Meaningful reply", nextStage: null }, capacity: { status: "needs_review", reasons: ["Event dates missing"] }, capacityDisplayReasons: ["Event dates missing"] }),
    ] }));
    view();
    const contact = await screen.findByText("Contact next", { selector: "summary" });
    expect(within(contact.parentElement!).getByRole("link", { name: "County Fair" })).toHaveAttribute("href", expect.stringContaining("/profiles/organization-1"));
    expect(within(contact.parentElement!).getByRole("link", { name: "County Fair" }).getAttribute("href")).not.toContain("opportunity-1");
    fireEvent.click(screen.getByText(/Waiting \/ follow-ups/, { selector: "summary" }));
    expect(screen.getAllByText(/One trailer is already pursued/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Prairie Expo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs Review").length).toBeGreaterThan(0);
    expect(document.querySelector("table")).toBeNull();
    expect(document.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("creates an opening from configured leg and named package counts while preserving input on failure", async () => {
    api.getPlanner.mockResolvedValue(planner({ openings: [], candidates: [] }));
    api.createOpening.mockRejectedValueOnce(new Error("Dates conflict"));
    view();
    fireEvent.change(await screen.findByLabelText("Opening name"), { target: { value: "Holiday route" } });
    fireEvent.change(screen.getByLabelText("Opening starts"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Opening ends"), { target: { value: "2026-12-05" } });
    fireEvent.change(screen.getByLabelText("Adventure Show quantity"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create opening" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dates conflict");
    expect(screen.getByLabelText("Opening name")).toHaveValue("Holiday route");
    expect(api.createOpening).toHaveBeenCalledWith(expect.objectContaining({ legId: "leg-1", quantities: { show: 1 } }));
  });

  it("searches by opportunity name and adds an audited event-year classification", async () => {
    api.searchOpportunities.mockResolvedValue([{ id: "opportunity-2", organizationId: "organization-2", bookingId: null, organizationName: "Winter Expo", eventYear: 2026, status: "needs_review", suggestions: [{ tier: "convention", reason: "Convention member", conventionYear: 2025 }] }]);
    view(); fireEvent.click(await screen.findByText(/Route openings and backups/, { selector: "summary" }));
    const picker = screen.getByText("Add an existing opportunity or saved Scout profile", { selector: "summary" }).parentElement!; fireEvent.click(picker.querySelector("summary")!);
    fireEvent.change(within(picker).getByLabelText("Search by name"), { target: { value: "Winter" } }); fireEvent.click(within(picker).getByRole("button", { name: "Search" }));
    fireEvent.click(await within(picker).findByRole("button", { name: /Winter Expo/ }));
    fireEvent.change(within(picker).getByLabelText("Classification/admission reason"), { target: { value: "Reviewed 2026 opportunity and convention history" } });
    fireEvent.click(within(picker).getByRole("button", { name: "Add to opening" }));
    await waitFor(() => expect(api.addCandidate).toHaveBeenCalledWith({ openingId: opening.id, opportunityId: "opportunity-2", tier: "convention", manualRank: 0, reason: "Reviewed 2026 opportunity and convention history" }));
  });

  it("admits a saved Scout profile by name and then adds the returned event-year opportunity", async () => {
    api.searchProfiles.mockResolvedValue([{ organizationId: "organization-scout", organizationName: "Saved Scout Fair", city: "Mankato", region: "MN", protectedReason: null, suggestions: [], bookings: [] }]);
    api.admitProfile.mockResolvedValue({ opportunityId: "opportunity-scout", organizationId: "organization-scout", bookingId: null, eventYear: 2026, reused: false, reason: "Reviewed saved profile" });
    view(); const route = (await screen.findByText(/Route openings and backups/, { selector: "summary" })).parentElement!; fireEvent.click(route.querySelector("summary")!);
    const picker = within(route).getByText("Add an existing opportunity or saved Scout profile", { selector: "summary" }).parentElement!; fireEvent.click(picker.querySelector("summary")!); fireEvent.click(within(picker).getByRole("button", { name: "Saved profile" }));
    fireEvent.change(within(picker).getByLabelText("Search by name"), { target: { value: "Saved Scout" } }); fireEvent.click(within(picker).getByRole("button", { name: "Search" })); fireEvent.click(await within(picker).findByRole("button", { name: /Saved Scout Fair/ }));
    fireEvent.change(within(picker).getByLabelText("Classification/admission reason"), { target: { value: "Reviewed saved Scout profile for 2026; dates still need review" } }); fireEvent.click(within(picker).getByRole("button", { name: "Add to opening" }));
    await waitFor(() => expect(api.admitProfile).toHaveBeenCalledWith({ organizationId: "organization-scout", eventYear: 2026, bookingId: null, reason: "Reviewed saved Scout profile for 2026; dates still need review" }));
    expect(api.addCandidate).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opportunity-scout", openingId: opening.id }));
  });

  it("saves decisions, links actual evidence, advances only eligible work, and exposes reviewed holds", async () => {
    view(); const contact = (await screen.findByText("Contact next", { selector: "summary" })).parentElement!;
    fireEvent.click(within(contact).getByText("Decision, snooze, classification and rank", { selector: "summary" }));
    fireEvent.change(within(contact).getByLabelText(/Audit reason/), { target: { value: "Owner chose a response deadline" } });
    fireEvent.change(within(contact).getByLabelText(/Decision due/), { target: { value: "2026-09-20T10:00" } }); fireEvent.click(within(contact).getByRole("button", { name: "Save decision date" }));
    await waitFor(() => expect(api.patchCandidate).toHaveBeenCalledWith("candidate-1", expect.objectContaining({ decisionDueAt: expect.stringContaining("2026-09-20") })));
    fireEvent.click(within(contact).getByText("Actual contact history and source review", { selector: "summary" }));
    fireEvent.change(within(contact).getByLabelText("Successful send or completed call"), { target: { value: "source-1" } }); fireEvent.click(within(contact).getByRole("button", { name: "Link as Initial" }));
    await waitFor(() => expect(api.linkAttempt).toHaveBeenCalledWith("candidate-1", expect.objectContaining({ sourceId: "source-1", stage: "initial" })));
    expect(within(contact).getByRole("button", { name: "Advance to next candidate" })).toBeDisabled();
    fireEvent.click(within(contact).getByText("Demand, hold and allocation audit", { selector: "summary" }));
    expect(within(contact).getByRole("button", { name: "Create verified hold" })).toBeDisabled();
  });

  it("shows exact live-hold expiry/quantities and advances only a fully eligible pursuit", async () => {
    const readyToAdvance = candidate({ outreach: { state: "advance", dueAt: null, reason: "Cadence complete; release this pursuit.", nextStage: null } });
    api.getPlanner.mockResolvedValue(planner({ candidates: [readyToAdvance] }));
    api.getAllocations.mockResolvedValue({ ...allocations, holds: [{ id: "hold-1", candidate_id: "candidate-1", booking_id: "booking-1", opportunity_id: "opportunity-1", leg_id: "leg-1", event_starts_on: "2026-10-04", event_ends_on: "2026-10-05", quantities: { show: 1 }, resource_ids: ["resource-1"], revision: 1, state: "released", expires_at: "2026-09-20T18:00:00Z", ended_at: "2026-09-11T18:00:00Z" }] });
    view(); const review = (await screen.findByText("Needs review", { selector: "summary" })).parentElement!;
    const advance = within(review).getByRole("button", { name: "Advance to next candidate" }); expect(advance).toBeEnabled(); fireEvent.click(advance); await waitFor(() => expect(api.advanceCandidate).toHaveBeenCalledWith("candidate-1"));
    cleanup();
    api.getPlanner.mockResolvedValue(planner({ candidates: [candidate({ liveHoldId: "hold-1", portfolio: { state: "attention", reason: "Conversation continues under a live hold.", competing: [] } })] }));
    api.getAllocations.mockResolvedValue({ ...allocations, holds: [{ id: "hold-1", candidate_id: "candidate-1", booking_id: "booking-1", opportunity_id: "opportunity-1", leg_id: "leg-1", event_starts_on: "2026-10-04", event_ends_on: "2026-10-05", quantities: { show: 1 }, resource_ids: ["resource-1"], revision: 1, state: "active", expires_at: "2026-09-20T18:00:00Z", ended_at: null }] });
    view(); const held = (await screen.findByText("Needs review", { selector: "summary" })).parentElement!; fireEvent.click(within(held).getByText("Demand, hold and allocation audit", { selector: "summary" }));
    expect(within(held).getByText(/Live hold:/)).toBeInTheDocument(); expect(within(held).getAllByText(/Adventure Show: 1/).length).toBeGreaterThan(0); expect(within(held).getByRole("button", { name: "Release hold" })).toBeEnabled();
  });

  it("saves explicit research geography without implying that saving starts background research", async () => {
    view(); const research = (await screen.findByText("Find more leads", { selector: "summary" })).parentElement!; fireEvent.click(research.querySelector("summary")!);
    fireEvent.click(within(research).getByText(`Find leads for ${opening.title}`, { selector: "summary" }));
    fireEvent.change(within(research).getByLabelText("What qualifies"), { target: { value: "County fairs near the route" } }); fireEvent.change(within(research).getByLabelText("Search location or address"), { target: { value: "Mankato MN" } });
    fireEvent.click(within(research).getByRole("button", { name: "Find location" })); fireEvent.click(await within(research).findByLabelText("Mankato, Minnesota")); fireEvent.click(within(research).getByRole("button", { name: "Save research task" }));
    await waitFor(() => expect(api.requestResearch).toHaveBeenCalledWith(opening.id, expect.objectContaining({ targetCount: 3, qualificationCriteria: expect.objectContaining({ startsOn: opening.startsOn, endsOn: opening.endsOn, geography: expect.objectContaining({ latitude: 44.1, longitude: -93.2, radiusMiles: 100 }) }) })));
    expect(screen.getByText(/does not start web research/)).toBeInTheDocument();
  });
});

describe("exact final draft review", () => {
  it("previews the exact recipient/body and approves its digest before enabling the guarded caller", async () => {
    const content = { to: "fair@example.org", subject: "October dates", body: "Hello fair" };
    const review = { draft: { kind: "office_email", id: "draft-1", organizationId: "organization-1", opportunityId: "opportunity-1", bookingId: "booking-1", eventYear: 2026, revision: 2, state: "submitted", content }, digest: "a".repeat(64), approval: null, approvedHold: null, approvalCurrent: false, dispatch: null, reviewReasons: ["Review intent for this exact final content and recipient."], requiresIntentReview: true };
    api.reviewDraftContent.mockResolvedValueOnce(review).mockResolvedValueOnce({ ...review, approval: {}, approvalCurrent: true, reviewReasons: [], requiresIntentReview: false });
    const changed = vi.fn(); render(<OutreachDraftReviewControl content={content} draftId="draft-1" kind="office_email" onApprovalChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Review final content" }));
    expect(await screen.findByRole("region", { name: "Exact final email preview" })).toHaveTextContent("fair@example.org");
    fireEvent.change(screen.getByLabelText("Approval reason"), { target: { value: "Reviewed recipient, body, and exploratory intent" } }); fireEvent.click(screen.getByRole("button", { name: "Approve this exact final content" }));
    await waitFor(() => expect(api.approveDraft).toHaveBeenCalledWith("office_email", "draft-1", expect.objectContaining({ digest: "a".repeat(64), intent: "exploratory", overrides: content })));
    expect(await screen.findByRole("status")).toHaveTextContent("approved"); expect(changed).toHaveBeenLastCalledWith(true);
  });

  it("blocks the actual opportunity send screen until edits are saved and the saved final body is approved", async () => {
    const originalDraft = { id: "draft-opportunity", opportunityId: "opportunity-1", organizationId: "organization-1", contactId: "contact-1", eventYear: 2026, purpose: "new_outreach", state: "draft", gmailDraftId: null, gmailMessageId: null, gmailThreadId: null, recipientEmail: "fair@example.org", recipientName: "Pat", subject: "October", body: "Original body", scheduledFor: null, sentAt: null, lastFailureCode: null, lastFailureMessage: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" } as const;
    const savedDraft = { ...originalDraft, body: "Saved final body", updatedAt: "2026-09-02T00:00:00Z" };
    auth.apiPatch.mockResolvedValue({ draft: savedDraft });
    const review = { draft: { kind: "opportunity_email", id: originalDraft.id, organizationId: "organization-1", opportunityId: "opportunity-1", bookingId: "booking-1", eventYear: 2026, revision: 2, state: "draft", content: { to: originalDraft.recipientEmail, subject: originalDraft.subject, body: savedDraft.body } }, digest: "b".repeat(64), approval: null, approvedHold: null, approvalCurrent: false, dispatch: null, reviewReasons: ["Review intent"], requiresIntentReview: true };
    api.reviewDraftContent.mockResolvedValueOnce(review).mockResolvedValueOnce({ ...review, approval: {}, approvalCurrent: true, reviewReasons: [], requiresIntentReview: false });
    render(<OpportunityDraftComposer draft={originalDraft} fromAccount="owner@example.org" />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: savedDraft.body } });
    expect(await screen.findByText(/Save changes before review/)).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(auth.apiPatch).toHaveBeenCalledWith("/opportunities/opportunity-1/draft", { draftId: originalDraft.id, subject: originalDraft.subject, body: savedDraft.body }));
    fireEvent.click(screen.getByRole("button", { name: "Review final content" })); await screen.findByText(savedDraft.body);
    fireEvent.change(screen.getByLabelText("Approval reason"), { target: { value: "Reviewed exact saved opportunity message" } }); fireEvent.click(screen.getByRole("button", { name: "Approve this exact final content" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(api.reviewDraftContent).toHaveBeenCalledWith("opportunity_email", originalDraft.id, { to: originalDraft.recipientEmail, subject: originalDraft.subject, body: savedDraft.body });
  });

  it("preserves existing opportunity send and schedule actions when outreach review is disabled", async () => {
    api.getPlanner.mockResolvedValue({ ...planner(), enabled: false, openings: [], candidates: [] });
    const draft = { id: "draft-early-bird", opportunityId: "opportunity-1", organizationId: "organization-1", contactId: "contact-1", eventYear: 2026, purpose: "early_bird_promo", state: "draft", gmailDraftId: null, gmailMessageId: null, gmailThreadId: null, recipientEmail: "fair@example.org", recipientName: "Pat", subject: "Early Bird Promo", body: "Prepared Early Bird body", scheduledFor: null, sentAt: null, lastFailureCode: null, lastFailureMessage: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" } as const;
    auth.apiPost.mockImplementation(async (path: string) => ({ draft, followUpReferenceAt: path.includes("schedule") ? "2099-01-02T12:00:00Z" : "2026-09-10T12:00:00Z" }));
    render(<OpportunityDraftComposer draft={draft as any} fromAccount="owner@example.org" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(screen.queryByLabelText("Final outreach review")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(auth.apiPost).toHaveBeenCalledWith("/opportunities/opportunity-1/draft/send", expect.objectContaining({ draftId: draft.id })));
    fireEvent.change(screen.getByLabelText("Schedule date and time"), { target: { value: "2099-01-02T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(auth.apiPost).toHaveBeenCalledWith("/opportunities/opportunity-1/draft/schedule", expect.objectContaining({ draftId: draft.id, scheduledFor: expect.stringContaining("2099-01-02") })));
  });
});

describe("profile outreach summary", () => {
  it("shows the profile's opening and does not call unverified capacity available", async () => {
    api.getPlanner.mockResolvedValue(planner({ candidates: [candidate({ capacity: { status: "needs_review", reasons: ["Route evidence is stale"] }, capacityDisplayReasons: ["Route evidence is stale"] })] }));
    render(<OutreachProfileSummary organizationId="organization-1" />);
    expect(await screen.findByRole("heading", { name: "Outreach openings" })).toBeInTheDocument();
    expect(screen.getByText(/October route opening · 2026/)).toBeInTheDocument();
    expect(screen.getByText("Availability remains Needs Review.")).toBeInTheDocument();
    expect(screen.queryByText("Verified fit")).not.toBeInTheDocument();
  });
});
