import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EventDateCoveragePage from "./EventDateCoveragePage";

const api = vi.hoisted(() => ({
  getCoverageProfiles: vi.fn(), getCoverageProfile: vi.fn(), getCoverageRun: vi.fn(),
  startCoverageRun: vi.fn(), retryCoverageItem: vi.fn(), reviewCoverageFact: vi.fn(),
}));
vi.mock("@/features/event-date-coverage/event-date-coverage-api", async (load) => ({ ...(await load<any>()), ...api }));

const page = {
  summary: { booked: 1, confirmed: 2, expected: 3, missing: 4, stale: 5, needs_review: 6 },
  records: [
    { organizationId: "org-1", name: "River Days", city: "Bend", region: "OR", status: "missing", effectiveDate: null, lastKnownEventDate: null, lastResearchedAt: null },
    { organizationId: "org-2", name: "Town Fair", city: null, region: null, status: "expected", effectiveDate: { startsOn: "2027-06-01", endsOn: null, displayStatus: "expected", sourceId: "fact-1" }, lastKnownEventDate: "2027-06-01", lastResearchedAt: null },
  ], total: 2, page: 1, pageSize: 25, pageCount: 1,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><EventDateCoveragePage/></QueryClientProvider>);
}

describe("EventDateCoveragePage", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/settings/event-date-coverage");
    api.getCoverageProfiles.mockResolvedValue(page);
    api.getCoverageProfile.mockResolvedValue({ organizationId: "org-1", facts: [{ id: "fact-1", rationale: "Official calendar", sourceUrl: "https://example.com", sourceTitle: "Organizer" }] });
    api.startCoverageRun.mockResolvedValue({ id: "run-1", status: "queued", items: [] });
    api.getCoverageRun.mockResolvedValue({ id: "run-1", status: "complete", items: [] });
    api.retryCoverageItem.mockResolvedValue({}); api.reviewCoverageFact.mockResolvedValue({});
  });

  it("shows totals, status filters, rows, and source details", async () => {
    renderPage();
    expect(await screen.findByText("River Days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Needs review/ })).toHaveTextContent("6");
    expect(screen.getAllByText("Expected").length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "View evidence" })[0]!);
    expect(await screen.findByText("Official calendar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Organizer" })).toHaveAttribute("href", "https://example.com");
  });

  it("selects rows, starts explicit research, and defaults to the next 25", async () => {
    renderPage(); await screen.findByText("River Days");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select River Days" }));
    await userEvent.click(screen.getByRole("button", { name: "Research selected (1)" }));
    expect(api.startCoverageRun).toHaveBeenCalledWith(
      { organizationIds: ["org-1"], batchSize: 25 },
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Run complete"));
  });

  it("preserves search and status filters in the URL", async () => {
    renderPage(); await screen.findByText("River Days");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date status" }), "missing");
    expect(window.location.search).toContain("status=missing");
  });
});
