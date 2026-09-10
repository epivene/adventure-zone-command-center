import { evaluateOutreach } from "../../../../api-server/src/features/outreach-planner/outreach-policy";
import { applyPortfolioPriority } from "../../../../api-server/src/features/outreach-planner/outreach-portfolio";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getPlanner: vi.fn(), getAllocations: vi.fn(), createOpening: vi.fn(), setOpeningStatus: vi.fn(),
  searchOpportunities: vi.fn(), searchProfiles: vi.fn(), admitProfile: vi.fn(), bindOpportunity: vi.fn(), addCandidate: vi.fn(),
  patchCandidate: vi.fn(), checkCandidate: vi.fn(), reviewHistory: vi.fn(), linkAttempt: vi.fn(), reviewSource: vi.fn(), reviewInbound: vi.fn(), advanceCandidate: vi.fn(),
  saveCandidateDemand: vi.fn(), createHold: vi.fn(), releaseHold: vi.fn(), extendHold: vi.fn(), requestResearch: vi.fn(), saveResearchResults: vi.fn(),
  getRecoveryCatalog: vi.fn(), saveCommittedDemand: vi.fn(), changeCommitment: vi.fn(), saveRouteAnchor: vi.fn(), revokeRouteAnchor: vi.fn(), reviewImportedSource: vi.fn(),
  reviewDraftContent: vi.fn(), approveDraft: vi.fn(), assignOfficeIdentity: vi.fn(), getDispatches: vi.fn(), reconcileDispatch: vi.fn(),
}));
const trip = vi.hoisted(() => ({ geocodeAddressAction: vi.fn() }));
const auth = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiPut: vi.fn() }));
vi.mock("@/features/outreach-planner/outreach-api", async (original) => ({ ...(await original()), ...api }));
vi.mock("@/actions/trips", async (original) => ({ ...(await original()), ...trip }));
vi.mock("@/lib/auth-token", () => auth);

import { AssistantContextProvider, useAssistantContext } from "@/features/assistant/assistant-context";
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
function ScoutPrefillProbe() { return <output data-testid="scout-prefill">{JSON.stringify(useAssistantContext().scoutLaunchPrefill)}</output>; }
function view() { return render(<AssistantContextProvider><OutreachPlanner /></AssistantContextProvider>); }

beforeEach(() => {
  vi.resetAllMocks();
  api.getPlanner.mockResolvedValue(planner()); api.getAllocations.mockResolvedValue(allocations);
  for (const name of ["createOpening", "setOpeningStatus", "addCandidate", "patchCandidate", "checkCandidate", "reviewHistory", "linkAttempt", "reviewSource", "reviewInbound", "advanceCandidate", "saveCandidateDemand", "createHold", "releaseHold", "extendHold", "requestResearch", "saveCommittedDemand", "changeCommitment", "saveRouteAnchor", "revokeRouteAnchor", "reviewImportedSource", "approveDraft", "assignOfficeIdentity", "reconcileDispatch"] as const) api[name].mockResolvedValue({});
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

  it("resolves an unlinked profile candidate with explicit evidence and preserves failed inputs", async () => {
    const unlinked = candidate({ bookingId: null, eventStartsAt: null, eventEndsAt: null, capacity: { status: "needs_review", reasons: ["Unknown event identity"] } });
    api.getPlanner.mockResolvedValueOnce(planner({ candidates: [unlinked] })).mockResolvedValueOnce(planner({ candidates: [candidate({ capacity: { status: "needs_review", reasons: [] } })] }));
    api.searchProfiles.mockResolvedValue([{ organizationId: "organization-1", organizationName: "County Fair", bookings: [{ id: "booking-1", name: "County Fair verified event", startsAt: "2026-10-04T14:00:00Z", endsAt: "2026-10-05T22:00:00Z" }] }, { organizationId: "other", bookings: [{ id: "other-booking", name: "Wrong profile event", startsAt: "2026-10-04", endsAt: "2026-10-05" }] }]);
    api.bindOpportunity.mockRejectedValueOnce(new Error("Unresolved delivery: reconcile first")).mockResolvedValueOnce({ reused: false });
    render(<OutreachProfileSummary organizationId="organization-1" />);
    fireEvent.click(await screen.findByText("Resolve event identity", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Find matching bookings" }));
    const select = await screen.findByLabelText("Verified matching event");
    expect(api.searchProfiles).toHaveBeenCalledWith("County Fair", 2026);
    expect(screen.queryByRole("option", { name: /Wrong profile/ })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "booking-1" } });
    expect(screen.getByText("Current opportunity year: 2026")).toBeInTheDocument();
    expect(screen.getByText(/Actual event dates:/)).toHaveTextContent("Oct 4");
    const submit = screen.getByRole("button", { name: "Confirm event identity" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Identity resolution reason"), { target: { value: "Organizer confirmed this annual event" } });
    fireEvent.change(screen.getByLabelText("Identity evidence / source reference"), { target: { value: "https://fair.example/event" } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this booking/ }));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unresolved delivery");
    expect(select).toHaveValue("booking-1");
    expect(screen.getByLabelText("Identity resolution reason")).toHaveValue("Organizer confirmed this annual event");
    expect(screen.getByLabelText("Identity evidence / source reference")).toHaveValue("https://fair.example/event");
    expect(screen.getByRole("checkbox", { name: /I confirm this booking/ })).toBeChecked();
    expect(api.bindOpportunity).toHaveBeenCalledWith("opportunity-1", { bookingId: "booking-1", confirmedEventYear: 2026, confirmedSameEvent: true, reason: "Organizer confirmed this annual event", sourceReference: "https://fair.example/event" });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByText("Resolve event identity")).not.toBeInTheDocument());
    expect(screen.getByText("Availability remains Needs Review.")).toBeInTheDocument();
    expect(api.admitProfile).not.toHaveBeenCalled(); expect(api.addCandidate).not.toHaveBeenCalled();
  });

  it("exposes event identity resolution on candidate needs-review controls", async () => {
    api.getPlanner.mockResolvedValue(planner({ candidates: [candidate({ bookingId: null, capacity: { status: "needs_review", reasons: [] }, portfolio: { state: "needs_review", reason: "Event identity needs review", competing: [] } })] }));
    view();
    expect((await screen.findAllByText("Resolve event identity", { selector: "summary" })).length).toBeGreaterThan(0);
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
    render(<AssistantContextProvider><OutreachPlanner /><ScoutPrefillProbe /></AssistantContextProvider>); const research = (await screen.findByText("Find more leads", { selector: "summary" })).parentElement!; fireEvent.click(research.querySelector("summary")!);
    fireEvent.click(within(research).getByText(`Find leads for ${opening.title}`, { selector: "summary" }));
    fireEvent.change(within(research).getByLabelText("What qualifies"), { target: { value: "County fairs near the route" } }); fireEvent.change(within(research).getByLabelText("Search location or address"), { target: { value: "Mankato MN" } });
    fireEvent.click(within(research).getByRole("button", { name: "Find location" })); fireEvent.click(await within(research).findByLabelText("Mankato, Minnesota")); fireEvent.click(within(research).getByRole("button", { name: "Save research task" }));
    await waitFor(() => expect(api.requestResearch).toHaveBeenCalledWith(opening.id, expect.objectContaining({ targetCount: 3, qualificationCriteria: expect.objectContaining({ startsOn: opening.startsOn, endsOn: opening.endsOn, geography: expect.objectContaining({ latitude: 44.1, longitude: -93.2, radiusMiles: 100 }) }) })));
    expect(screen.getByText(/does not start web research/)).toBeInTheDocument();
    fireEvent.click(within(research).getByRole("button", { name: "Open Lead Scout with saved criteria" }));
    expect(screen.getByTestId("scout-prefill")).toHaveTextContent('"anchorLabel":"Mankato, Minnesota"'); expect(screen.getByTestId("scout-prefill")).toHaveTextContent('"radiusMiles":100'); expect(screen.getByTestId("scout-prefill")).toHaveTextContent("Adventure Show: 1"); expect(screen.getByTestId("scout-prefill")).toHaveTextContent("target 3 distinct qualifying profiles");
  });

  it("clears hidden candidate selections when switching source mode", async () => {
    api.searchOpportunities.mockResolvedValue([{ id: "opportunity-hidden", organizationId: "organization-hidden", bookingId: null, organizationName: "Hidden Expo", eventYear: 2026, status: "needs_review", suggestions: [] }]);
    api.searchProfiles.mockResolvedValue([{ organizationId: "organization-visible", organizationName: "Visible Fair", city: "Mankato", region: "MN", protectedReason: null, suggestions: [], bookings: [] }]);
    api.admitProfile.mockResolvedValue({ opportunityId: "opportunity-visible", organizationId: "organization-visible", bookingId: null, eventYear: 2026, reused: false, reason: "Reviewed visible profile" });
    view(); const route = (await screen.findByText(/Route openings and backups/, { selector: "summary" })).parentElement!; fireEvent.click(route.querySelector("summary")!);
    const picker = within(route).getByText("Add an existing opportunity or saved Scout profile", { selector: "summary" }).parentElement!; fireEvent.click(picker.querySelector("summary")!);
    fireEvent.change(within(picker).getByLabelText("Search by name"), { target: { value: "Hidden" } }); fireEvent.click(within(picker).getByRole("button", { name: "Search" })); fireEvent.click(await within(picker).findByRole("button", { name: /Hidden Expo/ }));
    fireEvent.click(within(picker).getByRole("button", { name: "Saved profile" }));
    expect(within(picker).queryByRole("button", { name: "Add to opening" })).not.toBeInTheDocument();
    fireEvent.change(within(picker).getByLabelText("Search by name"), { target: { value: "Visible" } }); fireEvent.click(within(picker).getByRole("button", { name: "Search" })); fireEvent.click(await within(picker).findByRole("button", { name: /Visible Fair/ }));
    fireEvent.change(within(picker).getByLabelText("Classification/admission reason"), { target: { value: "Reviewed visible profile" } }); fireEvent.click(within(picker).getByRole("button", { name: "Add to opening" }));
    await waitFor(() => expect(api.addCandidate).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opportunity-visible" })));
    expect(api.addCandidate).not.toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opportunity-hidden" }));
  });

  it("persists an explicitly reviewed convention end date after admission", async () => {
    api.searchProfiles.mockResolvedValue([{ organizationId: "organization-convention", organizationName: "Convention Fair", city: "Omaha", region: "NE", protectedReason: null, suggestions: [{ tier: "convention", reason: "2025 convention member", conventionYear: 2025 }], bookings: [] }]);
    api.admitProfile.mockResolvedValue({ opportunityId: "opportunity-convention", organizationId: "organization-convention", bookingId: null, eventYear: 2026, reused: false, reason: "Reviewed convention lead" });
    api.addCandidate.mockResolvedValue(candidate({ id: "candidate-convention", opportunityId: "opportunity-convention", organizationId: "organization-convention", conventionEndsOn: null }));
    view(); const route = (await screen.findByText(/Route openings and backups/, { selector: "summary" })).parentElement!; fireEvent.click(route.querySelector("summary")!);
    const picker = within(route).getByText("Add an existing opportunity or saved Scout profile", { selector: "summary" }).parentElement!; fireEvent.click(picker.querySelector("summary")!); fireEvent.click(within(picker).getByRole("button", { name: "Saved profile" }));
    fireEvent.change(within(picker).getByLabelText("Search by name"), { target: { value: "Convention" } }); fireEvent.click(within(picker).getByRole("button", { name: "Search" })); fireEvent.click(await within(picker).findByRole("button", { name: /Convention Fair/ }));
    fireEvent.change(within(picker).getByLabelText(/^Reviewed convention end date/), { target: { value: "2026-09-18" } }); fireEvent.change(within(picker).getByLabelText("Classification/admission reason"), { target: { value: "Reviewed convention lead and actual convention end date" } }); fireEvent.click(within(picker).getByRole("button", { name: "Add to opening" }));
    await waitFor(() => expect(api.patchCandidate).toHaveBeenCalledWith("candidate-convention", { conventionEndsOn: "2026-09-18", reason: "Reviewed convention lead and actual convention end date" }));
  });

  it("classifies a post-chain actual source as an additional attempt", async () => {
    api.getPlanner.mockResolvedValue(planner({ candidates: [candidate({ outreach: { state: "waiting", dueAt: "2026-09-20T12:00:00Z", reason: "Wait after the latest actual attempt.", nextStage: null } })] }));
    view(); const waiting = (await screen.findByText(/Waiting \/ follow-ups/, { selector: "summary" })).parentElement!; fireEvent.click(waiting.querySelector("summary")!);
    fireEvent.click(within(waiting).getByText("Actual contact history and source review", { selector: "summary" }));
    fireEvent.change(within(waiting).getByLabelText("Successful send or completed call"), { target: { value: "source-1" } }); fireEvent.change(within(waiting).getByLabelText("What you checked"), { target: { value: "Reviewed completed call after the three-stage chain" } });
    fireEvent.click(within(waiting).getByRole("button", { name: "Reviewed as additional attempt" }));
    await waitFor(() => expect(api.reviewSource).toHaveBeenCalledWith("candidate-1", { sourceId: "source-1", classification: "additional_attempt", confirmedEventYear: 2026, reason: "Reviewed completed call after the three-stage chain" }));
  });

  it("counts distinct qualified opportunities instead of source rows", async () => {
    api.getPlanner.mockResolvedValue(planner({ researchTasks: [{ id: "research-1", openingId: opening.id, criteria: "County fairs", targetCount: 3, status: "pending", createdAt: "2026-09-10T00:00:00Z", results: [{ opportunityId: "opportunity-1", sourceUrl: "https://one.example", note: "Primary source", qualified: true }, { opportunityId: "opportunity-1", sourceUrl: "https://two.example", note: "Second source", qualified: true }] }] }));
    view(); const research = (await screen.findByText(/Find more leads/, { selector: "summary" })).parentElement!; fireEvent.click(research.querySelector("summary")!);
    expect(within(research).getByText("Pending · 1 of 3 qualifying profiles")).toBeInTheDocument();
  });

  it("preserves a fill reason after failure and allows a deliberate retry", async () => {
    api.setOpeningStatus.mockRejectedValueOnce(new Error("Opening changed elsewhere")).mockResolvedValueOnce({});
    view(); const route = (await screen.findByText(/Route openings and backups/, { selector: "summary" })).parentElement!; fireEvent.click(route.querySelector("summary")!);
    const reason = within(route).getByLabelText("Fill or close reason"); fireEvent.change(reason, { target: { value: "All verified capacity is committed" } }); fireEvent.click(within(route).getByRole("button", { name: "Mark filled" }));
    expect(await within(route).findByRole("alert")).toHaveTextContent("Opening changed elsewhere"); expect(reason).toHaveValue("All verified capacity is committed");
    fireEvent.click(within(route).getByRole("button", { name: "Mark filled" }));
    await waitFor(() => expect(api.setOpeningStatus).toHaveBeenCalledTimes(2));
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

  it("keeps owner delivery unavailable after a failed flag check and restores enabled review on retry", async () => {
    api.getPlanner.mockRejectedValueOnce(new Error("Planner flag unavailable")).mockResolvedValueOnce(planner());
    const draft = { id: "draft-flag-retry", opportunityId: "opportunity-1", organizationId: "organization-1", contactId: "contact-1", eventYear: 2026, purpose: "new_outreach", state: "draft", gmailDraftId: null, gmailMessageId: null, gmailThreadId: null, recipientEmail: "fair@example.org", recipientName: "Pat", subject: "October", body: "Prepared body", scheduledFor: null, sentAt: null, lastFailureCode: null, lastFailureMessage: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" } as const;
    render(<OpportunityDraftComposer draft={draft as any} fromAccount="owner@example.org" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Planner flag unavailable");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Schedule" })).toBeDisabled();
    expect(screen.queryByLabelText("Final outreach review")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry outreach review check" }));

    expect(await screen.findByLabelText("Final outreach review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(api.getPlanner).toHaveBeenCalledTimes(2);
  });

  it("assigns unknown Office identity by name/year and exposes only its exact live hold", async () => {
    const content = { to: "fair@example.org", subject: "Offer", body: "Exact offer" };
    const unknown = { draft: { kind: "office_email", id: "draft-unknown", organizationId: "organization-1", opportunityId: null, bookingId: null, eventYear: null, revision: 1, state: "submitted", content }, digest: "d".repeat(64), approval: null, approvedHold: null, approvalCurrent: false, dispatch: null, reviewReasons: ["Assign event identity."], requiresIntentReview: true };
    const known = { ...unknown, draft: { ...unknown.draft, opportunityId: "opportunity-2026", bookingId: "booking-2026", eventYear: 2026, revision: 2 }, digest: "e".repeat(64), reviewReasons: ["Review intent."] };
    api.reviewDraftContent.mockResolvedValueOnce(unknown).mockResolvedValueOnce(known);
    api.searchOpportunities.mockResolvedValue([{ id: "opportunity-2026", organizationId: "organization-1", bookingId: "booking-2026", organizationName: "County Fair", eventYear: 2026, status: "prospecting", suggestions: [] }]);
    api.getAllocations.mockResolvedValue({ ...allocations, holds: [{ id: "hold-match", candidate_id: "candidate-1", booking_id: "booking-2026", opportunity_id: "opportunity-2026", leg_id: "leg-1", event_starts_on: "2026-10-04", event_ends_on: "2026-10-05", quantities: { show: 1 }, resource_ids: ["resource-1"], revision: 1, state: "active", expires_at: "2026-09-20T12:00:00Z", ended_at: null }, { id: "hold-other", candidate_id: "candidate-2", booking_id: "booking-other", opportunity_id: "opportunity-other", leg_id: "leg-1", event_starts_on: "2026-11-04", event_ends_on: "2026-11-05", quantities: { show: 1 }, resource_ids: ["resource-1"], revision: 1, state: "active", expires_at: "2026-09-20T12:00:00Z", ended_at: null }] });
    render(<OutreachDraftReviewControl content={content} draftId="draft-unknown" kind="office_email" />);
    fireEvent.click(screen.getByRole("button", { name: "Review final content" })); await screen.findByLabelText("Assign Office draft event identity");
    fireEvent.change(screen.getByLabelText("Opportunity name"), { target: { value: "County" } }); fireEvent.change(screen.getByLabelText("Event year"), { target: { value: "2026" } }); fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Verified opportunity"), { target: { value: "opportunity-2026" } }); fireEvent.change(screen.getByLabelText("Identity review reason"), { target: { value: "Matched the 2026 County Fair event" } }); fireEvent.click(screen.getByRole("button", { name: "Assign identity and refresh review" }));
    await waitFor(() => expect(api.assignOfficeIdentity).toHaveBeenCalledWith("draft-unknown", { opportunityId: "opportunity-2026", reason: "Matched the 2026 County Fair event" }));
    await waitFor(() => expect(screen.queryByLabelText("Assign Office draft event identity")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Intent"), { target: { value: "specific_offer" } });
    expect(await screen.findByRole("option", { name: /Expires/ })).toHaveValue("hold-match"); expect(screen.queryByRole("option", { name: /hold-other/ })).not.toBeInTheDocument();
  });

  it("does not reload an old Office preview when content changes during identity assignment", async () => {
    let resolveAssignment!: () => void;
    const oldContent = { to: "old@example.org", subject: "Old offer", body: "Old exact body" };
    const newContent = { to: "new@example.org", subject: "New offer", body: "New exact body" };
    const unknown = { draft: { kind: "office_email", id: "draft-identity-stale", organizationId: "organization-1", opportunityId: null, bookingId: null, eventYear: null, revision: 1, state: "submitted", content: oldContent }, digest: "9".repeat(64), approval: {}, approvedHold: null, approvalCurrent: true, dispatch: null, reviewReasons: ["Assign event identity."], requiresIntentReview: false };
    api.reviewDraftContent.mockResolvedValueOnce(unknown);
    api.searchOpportunities.mockResolvedValue([{ id: "opportunity-2026", organizationId: "organization-1", bookingId: "booking-2026", organizationName: "County Fair", eventYear: 2026, status: "prospecting", suggestions: [] }]);
    api.assignOfficeIdentity.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveAssignment = resolve; }));
    const changed = vi.fn();
    const rendered = render(<OutreachDraftReviewControl content={oldContent} draftId="draft-identity-stale" kind="office_email" onApprovalChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Review final content" }));
    await screen.findByLabelText("Assign Office draft event identity");
    fireEvent.change(screen.getByLabelText("Opportunity name"), { target: { value: "County" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Verified opportunity"), { target: { value: "opportunity-2026" } });
    fireEvent.change(screen.getByLabelText("Identity review reason"), { target: { value: "Matched the verified 2026 event" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign identity and refresh review" }));

    rendered.rerender(<OutreachDraftReviewControl content={newContent} draftId="draft-identity-stale" kind="office_email" onApprovalChange={changed} />);
    resolveAssignment();

    await waitFor(() => expect(screen.getByRole("button", { name: "Review final content" })).toBeEnabled());
    expect(api.reviewDraftContent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Old exact body")).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it("ignores stale review and approval responses after exact content changes", async () => {
    let resolveReview!: (value: any) => void;
    const oldContent = { to: "old@example.org", subject: "Old", body: "Old body" };
    const newContent = { to: "new@example.org", subject: "New", body: "New body" };
    const oldReview = { draft: { kind: "office_email", id: "draft-stale", organizationId: "organization-1", opportunityId: "opportunity-1", bookingId: "booking-1", eventYear: 2026, revision: 1, state: "submitted", content: oldContent }, digest: "f".repeat(64), approval: {}, approvedHold: null, approvalCurrent: true, dispatch: null, reviewReasons: [], requiresIntentReview: false };
    api.reviewDraftContent.mockImplementationOnce(() => new Promise((resolve) => { resolveReview = resolve; }));
    const changed = vi.fn(); const rendered = render(<OutreachDraftReviewControl content={oldContent} draftId="draft-stale" kind="office_email" onApprovalChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Review final content" })); rendered.rerender(<OutreachDraftReviewControl content={newContent} draftId="draft-stale" kind="office_email" onApprovalChange={changed} />); resolveReview(oldReview);
    await waitFor(() => expect(screen.getByRole("button", { name: "Review final content" })).toBeEnabled()); expect(screen.queryByText("Old body")).not.toBeInTheDocument(); expect(changed).not.toHaveBeenLastCalledWith(true);

    api.reviewDraftContent.mockResolvedValueOnce({ ...oldReview, draft: { ...oldReview.draft, content: newContent }, digest: "1".repeat(64), approvalCurrent: false, approval: null, reviewReasons: ["Review intent"] });
    fireEvent.click(screen.getByRole("button", { name: "Review final content" })); await screen.findByText("New body"); fireEvent.change(screen.getByLabelText("Approval reason"), { target: { value: "Reviewed current content" } });
    let resolveApproval!: () => void; api.approveDraft.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveApproval = resolve; })); fireEvent.click(screen.getByRole("button", { name: "Approve this exact final content" }));
    rendered.rerender(<OutreachDraftReviewControl content={{ ...newContent, body: "Newest body" }} draftId="draft-stale" kind="office_email" onApprovalChange={changed} />); resolveApproval();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review final content" })).toBeEnabled()); expect(screen.queryByText("New body")).not.toBeInTheDocument(); expect(changed).not.toHaveBeenLastCalledWith(true);
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


describe("final review planner contracts", () => {
  it("renders Advance from real policy and portfolio output and preserves hold protection", async () => {
    const c = candidate({ tier: "strong", eventStartsAt: "2026-12-01T12:00:00Z", sources: { ...candidate().sources, choices: [] } });
    const at = new Date("2026-09-30T18:00:00Z");
    c.outreach = evaluateOutreach({ tier: "strong", status: "ready_to_contact", attempts: ["initial", "follow_up_1", "follow_up_2"].map((stage, i) => ({ id: stage, stage, occurredAt: `2026-09-${String([1, 4, 11][i]).padStart(2, "0")}T18:00:00Z`, successful: true })) as any, meaningfulReplyAt: null, decisionDueAt: null, conventionEndsOn: null, operationalStartsOn: "2026-12-01", blockedReason: null }, at) as typeof c.outreach;
    const dto = planner({ candidates: [c] });
    // A real missing-capacity portfolio result is needs_review. Advancement
    // releases advisory pursuit and does not require or promise availability.
    applyPortfolioPriority(dto as any, null, at);
    expect(c.outreach.state).toBe("advance"); expect(c.portfolio.state).toBe("needs_review");
    api.getPlanner.mockResolvedValue(dto); view();
    const review = (await screen.findByText(/Needs review/)).closest("details")!;
    const advance = within(review).getByRole("button", { name: "Advance to next candidate" });
    expect(advance).toBeEnabled(); fireEvent.click(advance);
    await waitFor(() => expect(api.advanceCandidate).toHaveBeenCalledWith(c.id));
  });
  it("shows late released reply attention before routine outreach and supports classification then an explicit resume decision", async () => {
    const c = candidate({ releasedAt: "2026-09-08T18:00:00Z", outreach: { state: "needs_review", reason: "Late reply requires fresh availability and explicit decision", dueAt: null, nextStage: null }, portfolio: { state: "attention", reason: "Late reply on released pursuit", competing: [] }, capacity: { status: "conflict", reasons: ["Already held"] }, sources: { ...candidate().sources, inboundObservations: [{ id: "late-1", messageId: "message-late", receivedAt: "2026-09-09T18:00:00Z", state: "needs_review" }] } });
    api.getPlanner.mockResolvedValue(planner({ candidates: [c] })); view();
    const review = (await screen.findByText(/Needs review/)).closest("details")!;
    const contact = screen.getByText(/Contact next/).closest("details")!;
    expect(review.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(review).getByText("Conflict")).toHaveClass("bg-rose-50");
    fireEvent.click(within(review).getByText("Actual contact history and source review"));
    fireEvent.change(within(review).getByLabelText("Message"), { target: { value: "late-1" } });
    fireEvent.change(within(review).getByLabelText("What you checked"), { target: { value: "Read exact event reply" } });
    fireEvent.change(within(review).getByLabelText("Source reference"), { target: { value: "Gmail message-late" } });
    fireEvent.click(within(review).getByRole("button", { name: "Save inbound review" }));
    await waitFor(() => expect(api.reviewInbound).toHaveBeenCalledWith("late-1", expect.objectContaining({ classification: "meaningful_reply", opportunityId: c.opportunityId })));
    fireEvent.click(within(review).getByText("Decision, snooze, classification and rank"));
    fireEvent.change(within(review).getByLabelText(/Decision due/), { target: { value: "2026-09-11T12:00" } });
    fireEvent.change(within(review).getByLabelText("Audit reason"), { target: { value: "Decide to revisit after fresh check" } });
    fireEvent.click(within(review).getByRole("button", { name: "Recheck availability and resume pursuit" }));
    await waitFor(() => expect(api.patchCandidate).toHaveBeenCalledWith(c.id, expect.objectContaining({ resumeReleased: true, decisionDueAt: expect.any(String), reason: "Decide to revisit after fresh check" })));
    expect(api.createHold).not.toHaveBeenCalled();
  });
  it("requires deliberate reconciliation of one identifiable exact payload among two uncertain Office deliveries", async () => {
    const make = (id: string) => ({ id, draftKind: "office_email", draftId: `draft-${id}`, state: "uncertain", reviewAfter: "2026-09-01T12:00:00Z", lastError: `Provider timeout ${id}`, confirmation: null, payload: { organizationId: "organization-1", opportunityId: "opportunity-1", bookingId: "booking-1", eventYear: 2026, gmailDraftId: `gmail-${id}`, gmailThreadId: `thread-${id}`, content: { to: `${id}@example.com`, subject: `Subject ${id}`, body: `Exact final body ${id}` } } });
    api.getDispatches.mockResolvedValue([make("one"), make("two")]); view();
    fireEvent.click(await screen.findByText(/Needs review/));
    fireEvent.click(screen.getByText("Uncertain delivery reconciliation"));
    fireEvent.click(screen.getByRole("button", { name: "Load delivery review" }));
    const select = await screen.findByLabelText("Delivery");
    fireEvent.change(select, { target: { value: "two" } });
    const evidence = screen.getByRole("region", { name: "Selected delivery evidence" });
    expect(within(evidence).getByText("Exact final body two")).toBeVisible();
    expect(evidence).toHaveTextContent("two@example.com"); expect(evidence).toHaveTextContent("Subject two"); expect(evidence).toHaveTextContent("draft-two"); expect(evidence).toHaveTextContent("Provider timeout two");
    const save = screen.getByRole("button", { name: "Save provider reconciliation" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Verified outcome"), { target: { value: "not_sent" } });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I verified this exact provider operation/));
    fireEvent.change(screen.getByLabelText("Provider source reference"), { target: { value: "Provider search for draft-two" } });
    const form = screen.getByText("Uncertain delivery reconciliation").closest("details")!;
    fireEvent.change(within(form).getByLabelText("What you checked"), { target: { value: "Exact payload and terminated operation checked" } });
    fireEvent.click(save);
    await waitFor(() => expect(api.reconcileDispatch).toHaveBeenCalledWith("two", expect.objectContaining({ outcome: "not_sent", providerOperationTerminated: true, sourceReference: "Provider search for draft-two" })));
    fireEvent.change(select, { target: { value: "one" } });
    expect(screen.getByLabelText("Verified outcome")).toHaveValue("");
    expect(screen.getByLabelText(/I verified this exact provider operation/)).not.toBeChecked();
  });
  it("saves explicit urgent timeline review and exposes dedicated renewal dates", async () => {
    api.getPlanner.mockResolvedValue(planner({ candidates: [candidate({ tier: "dedicated" })] })); view();
    const contact = (await screen.findByText(/Contact next/)).closest("details")!;
    fireEvent.click(within(contact).getByText("Decision, snooze, classification and rank"));
    expect(within(contact).getByLabelText(/Renewal review \/ decision due/)).toBeVisible();
    expect(within(contact).getByLabelText("Cadence days")).toHaveValue("3,10,15");
    expect(within(contact).getByLabelText("Minimum gap days")).toHaveValue(3);
    expect(within(contact).getByText(/Default is day 3, day 10, and day 15/)).toBeVisible();
    fireEvent.change(within(contact).getByLabelText("Audit reason"), { target: { value: "Reviewed urgent dates" } });
    fireEvent.change(within(contact).getByLabelText("Cadence days"), { target: { value: "2,4,6" } });
    fireEvent.change(within(contact).getByLabelText("Minimum gap days"), { target: { value: "2" } });
    fireEvent.change(within(contact).getByLabelText("Cadence override reason"), { target: { value: "Owner urgent review" } });
    fireEvent.click(within(contact).getByLabelText(/I reviewed the urgent operational timeline/));
    fireEvent.click(within(contact).getByRole("button", { name: "Save cadence override" }));
    await waitFor(() => expect(api.patchCandidate).toHaveBeenCalledWith("candidate-1", expect.objectContaining({ cadenceOverride: { days: [2,4,6], minimumGapDays: 2, reason: "Owner urgent review", timelineReviewed: true } })));
  });
});
