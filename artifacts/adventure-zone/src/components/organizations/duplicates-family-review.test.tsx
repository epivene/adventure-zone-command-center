import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DuplicatesView, type DuplicateGroup } from "./duplicates-view";

const { apiPost, toast } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/auth-token", () => ({ apiPost }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

function organization(id: string, name: string, city: string, region: string) {
  return {
    id,
    name,
    city,
    region,
    contactCount: 0,
    bookingCount: 0,
    primaryContactName: null,
    lastResort: false,
    lastResortReason: null,
    lastResortChangedAt: null,
    parent: null,
    locationCount: 0,
  } as any;
}

const locationCandidate: DuplicateGroup = {
  normalizedName: "water lantern festival",
  city: "",
  region: "",
  classification: "location_candidate",
  groupKey: `organization-family:${FIRST_ID}|${SECOND_ID}`,
  candidateIds: [FIRST_ID, SECOND_ID],
  evidence: [
    { family: "website", label: "website domains agree" },
    { family: "location", label: "locations differ" },
  ],
  organizations: [
    organization(FIRST_ID, "Water Lantern Festival - Denver, CO", "Denver", "CO"),
    organization(SECOND_ID, "Water Lantern Festival - Austin, TX", "Austin", "TX"),
  ],
};

const duplicate: DuplicateGroup = {
  normalizedName: "same place",
  city: "Denver",
  region: "CO",
  classification: "duplicate",
  groupKey: null,
  candidateIds: [FIRST_ID, SECOND_ID],
  evidence: [],
  organizations: [
    organization(FIRST_ID, "Same Place", "Denver", "CO"),
    organization(SECOND_ID, "Same Place", "Denver", "CO"),
  ],
};

describe("DuplicatesView family review", () => {
  afterEach(cleanup);
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ ok: true });
    toast.mockReset();
  });

  it("shows the three review outcomes and explains the evidence and locations", () => {
    render(
      <DuplicatesView groups={[locationCandidate]} onRefresh={vi.fn().mockResolvedValue([])} />,
    );

    expect(screen.getByRole("button", { name: "Merge duplicates" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Same organization—make locations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not related" })).toBeInTheDocument();
    expect(screen.getByText(/same website domain/i)).toBeInTheDocument();
    expect(screen.getByText("Denver, CO")).toBeInTheDocument();
    expect(screen.getByText("Austin, TX")).toBeInTheDocument();
  });

  it("does not preselect destructive merge for a location candidate and excludes it from bulk merge", () => {
    render(
      <DuplicatesView
        groups={[locationCandidate, duplicate]}
        onRefresh={vi.fn().mockResolvedValue([])}
      />,
    );

    expect(
      within(screen.getByTestId(`duplicate-group-${locationCandidate.groupKey}`))
        .queryByRole("radio", { checked: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Merge all 1 group" }),
    ).toBeInTheDocument();
  });

  it("creates a parent for a reviewed family and refreshes server results", async () => {
    const onRefresh = vi.fn().mockResolvedValue([]);
    render(<DuplicatesView groups={[locationCandidate]} onRefresh={onRefresh} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Same organization—make locations" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Make organization locations" });
    fireEvent.change(within(dialog).getByLabelText("Parent organization name"), {
      target: { value: "Water Lantern Festival" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create parent and make locations" }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/organizations/family-review", {
        action: "make_locations",
        candidateIds: [FIRST_ID, SECOND_ID],
        parent: { kind: "new", name: "Water Lantern Festival" },
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("can select an existing parent for a reviewed family", async () => {
    render(
      <DuplicatesView groups={[locationCandidate]} onRefresh={vi.fn().mockResolvedValue([])} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Same organization—make locations" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Make organization locations" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Use an existing parent" }));
    fireEvent.change(within(dialog).getByLabelText("Existing parent ID"), {
      target: { value: "33333333-3333-4333-8333-333333333333" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Make locations" }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/organizations/family-review", {
        action: "make_locations",
        candidateIds: [FIRST_ID, SECOND_ID],
        parent: {
          kind: "existing",
          parentId: "33333333-3333-4333-8333-333333333333",
        },
      }),
    );
  });

  it("stores not-related and refreshes server results", async () => {
    const onRefresh = vi.fn().mockResolvedValue([]);
    render(<DuplicatesView groups={[locationCandidate]} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: "Not related" }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/organizations/family-review", {
        action: "not_related",
        candidateIds: [FIRST_ID, SECOND_ID],
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});
