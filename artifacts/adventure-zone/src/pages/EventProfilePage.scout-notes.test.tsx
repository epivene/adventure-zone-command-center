import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EventProfilePage from "./EventProfilePage";

const { apiGet, apiPatch, openAssistant, setLocation } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  openAssistant: vi.fn(),
  setLocation: vi.fn(),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ profileId: "profile-1" }),
  useSearch: () => "",
  useLocation: () => ["/event-profiles/profile-1", setLocation],
}));
vi.mock("@/lib/auth-token", () => ({ apiGet, apiPatch }));
vi.mock("@/features/assistant/assistant-context", () => ({
  useAssistantContext: () => ({ openAssistant }),
}));
vi.mock("@/actions/scoped-notes", () => ({ listFamilyNotes: vi.fn(async () => []) }));
vi.mock("@/features/event-profiles/historical-event-dates", () => ({ extractHistoricalEventDates: () => [] }));
vi.mock("@/features/profile-research/profile-research-gaps", () => ({ profileResearchGaps: () => [] }));
vi.mock("@/components/event-profiles/event-profile-workspace", () => ({ EventProfileWorkspace: () => null }));
vi.mock("@/components/profiles/simple-full-profile", () => ({
  SimpleFullProfile: ({ profile }: { profile: { notes: unknown[] } }) => (
    <output data-testid="ordinary-note-count">{profile.notes.length}</output>
  ),
}));
vi.mock("@/components/profiles/profile-details-card", () => ({ ProfileDetailsCard: () => null }));
vi.mock("@/components/profiles/profile-primary-actions", () => ({ ProfilePrimaryActions: () => null }));
vi.mock("@/components/profiles/profile-research-panel", () => ({ ProfileResearchPanel: () => null }));
vi.mock("@/components/profiles/attendance-history-panel", () => ({ AttendanceHistoryPanel: () => null }));
vi.mock("@/components/profiles/profile-source-documents", () => ({ ProfileSourceDocuments: () => null }));
vi.mock("@/components/profiles/historical-event-dates", () => ({ HistoricalEventDates: () => null }));
vi.mock("@/components/paper-notes/paper-note-history-sources", () => ({ PaperNoteHistorySources: () => null }));
vi.mock("@/components/assistant/assistant-context-registration", () => ({ AssistantContextRegistration: () => null }));
vi.mock("@/components/assistant/derived-facts-review", () => ({ DerivedFactsReview: () => null }));

function profileResponse() {
  return {
    id: "profile-1",
    place: {
      id: "profile-1",
      name: "Silver Valley Days",
      placeType: "festival_event",
      phone: null,
      address1: null,
      address2: null,
      city: "Kellogg",
      region: "ID",
      postalCode: null,
      website: "https://example.org/silver-valley-days",
      lastResort: false,
      lastResortReason: null,
      actRecordId: null,
    },
    contacts: [],
    selectedContactId: null,
    bookings: [],
    notes: [
      {
        id: "note-1",
        contactId: null,
        bookingId: null,
        kind: "note",
        body: "Human follow-up note",
        occurredAt: "2026-08-20T12:00:00.000Z",
        createdAt: "2026-08-20T12:00:00.000Z",
        updatedAt: "2026-08-20T12:00:00.000Z",
        importedFromAct: false,
        actSourceType: null,
      },
    ],
    scoutNotes: [
      {
        id: "scout-note-1",
        runId: "run-1",
        candidateId: "candidate-1",
        createdAt: "2026-08-19T18:10:00.000Z",
        occurredAt: "2026-08-19T18:10:00.000Z",
        originalQuestion: "Find family-friendly events in Idaho in September 2026",
        criteriaSummary: "Idaho · September 2026",
        fitScore: 88,
        summary: "Strong family fit",
        positives: ["Family audience"],
        cautions: ["Confirm that no inflatable provider is already contracted"],
        coverageGaps: ["Power availability has not been verified"],
        suggestedNextAction: { kind: "call", dueAt: "2026-08-24" },
        sources: [
          {
            url: "https://example.org/silver-valley-days",
            title: "Official Silver Valley Days event page",
            publisher: "Silver Valley Days",
            category: "official_event",
            retrievedAt: "2026-08-19T18:05:00.000Z",
          },
        ],
      },
    ],
    history: [],
    followUps: [],
    groups: [],
    sourceProvenance: [],
    migrationHistory: { contactSourceIds: [], phones: [], notes: [], bookingSourceIds: [], groupSourceIds: [] },
    familyContext: null,
    organizationContext: { parent: null, children: [] },
    assistedCallingEnabled: false,
  };
}

describe("EventProfilePage Scout Notes", () => {
  afterEach(cleanup);

  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/event-profiles/profile-1?")) return Promise.resolve(profileResponse());
      if (url === "/event-wrap-up-ratings/organization/profile-1") return Promise.resolve({ average: null, count: 0 });
      if (url === "/event-profiles/profile-1/photo") return Promise.resolve({ dataUrl: null });
      if (url === "/event-profiles/profile-1/description") return Promise.resolve({ description: null });
      return Promise.resolve({});
    });
  });

  it("shows source-backed Scout Notes separately from ordinary profile Notes", async () => {
    render(<EventProfilePage />);

    expect(await screen.findByRole("heading", { name: "Scout Notes" })).toBeInTheDocument();
    expect(screen.getByText("Strong family fit")).toBeInTheDocument();
    expect(screen.getByText("88% fit")).toBeInTheDocument();
    expect(screen.getByText("Confirm that no inflatable provider is already contracted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Official Silver Valley Days event page" })).toHaveAttribute(
      "href",
      "https://example.org/silver-valley-days",
    );
    expect(screen.getByTestId("ordinary-note-count")).toHaveTextContent("1");
  });
});