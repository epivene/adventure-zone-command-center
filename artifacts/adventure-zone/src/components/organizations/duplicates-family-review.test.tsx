import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DuplicatesView, type DuplicateGroup } from "./duplicates-view";

const { apiGet, apiPost, toast } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/auth-token", () => ({ apiGet, apiPost }));
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
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      organizations: {
        records: [
          organization(
            "33333333-3333-4333-8333-333333333333",
            "Water Lantern Festival",
            "",
            "",
          ),
        ],
        page: 1,
        pageCount: 1,
        pageSize: 50,
        total: 1,
      },
    });
    apiPost.mockReset();
    apiPost.mockResolvedValue({ ok: true });
    toast.mockReset();
  });

  it("shows safe family review outcomes without offering a destructive merge", () => {
    render(
      <DuplicatesView groups={[locationCandidate]} onRefresh={vi.fn().mockResolvedValue([])} />,
    );

    expect(screen.queryByRole("button", { name: "Merge duplicates" })).not.toBeInTheDocument();
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

  it("never exposes destructive merge controls after selecting a family record", () => {
    const thirdId = "44444444-4444-4444-8444-444444444444";
    const fourthId = "55555555-5555-4555-8555-555555555555";
    const secondFamily: DuplicateGroup = {
      ...locationCandidate,
      groupKey: `organization-family:${thirdId}|${fourthId}`,
      candidateIds: [thirdId, fourthId],
      organizations: [
        organization(thirdId, "Water Lantern Festival - Boston, MA", "Boston", "MA"),
        organization(fourthId, "Water Lantern Festival - Phoenix, AZ", "Phoenix", "AZ"),
      ],
    };
    render(
      <DuplicatesView
        groups={[locationCandidate, secondFamily]}
        onRefresh={vi.fn().mockResolvedValue([])}
      />,
    );

    const first = within(
      screen.getByTestId(`duplicate-group-${locationCandidate.groupKey}`),
    );
    const second = within(
      screen.getByTestId(`duplicate-group-${secondFamily.groupKey}`),
    );
    fireEvent.click(first.getByRole("radio", { name: /denver/i }));

    expect(first.getByRole("radio", { name: /denver/i })).toBeChecked();
    expect(first.queryByRole("button", { name: "Merge duplicates" })).not.toBeInTheDocument();
    expect(second.queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    expect(second.queryByRole("button", { name: "Merge duplicates" })).not.toBeInTheDocument();
  });

  it("shows ambiguous exact-name locations for manual review and excludes them from destructive bulk merge", () => {
    const ambiguous: DuplicateGroup = {
      ...locationCandidate,
      classification: "ambiguous_location_candidate",
      evidence: [
        { family: "name", label: "exact organization names agree" },
        { family: "location", label: "locations differ" },
      ],
    };
    render(
      <DuplicatesView groups={[ambiguous, duplicate]} onRefresh={vi.fn().mockResolvedValue([])} />,
    );

    const card = within(screen.getByTestId(`duplicate-group-${ambiguous.groupKey}`));
    expect(card.getByText(/ambiguous location match/i)).toBeInTheDocument();
    expect(card.queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Merge duplicates" })).not.toBeInTheDocument();
    expect(card.getByRole("button", { name: "Same organization—make locations" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Not related" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge all 1 group" })).toBeInTheDocument();
  });

  it.each([
    {
      label: "Denver, Denver, and Austin",
      cities: [["Denver", "CO"], ["Denver", "CO"], ["Austin", "TX"]],
    },
    {
      label: "Denver, Austin, and an incomplete location",
      cities: [["Denver", "CO"], ["Austin", "TX"], ["", ""]],
    },
  ])("keeps every member of $label out of destructive merge", ({ cities }) => {
    const thirdId = "44444444-4444-4444-8444-444444444444";
    const ambiguous: DuplicateGroup = {
      ...locationCandidate,
      classification: "ambiguous_location_candidate",
      candidateIds: [FIRST_ID, SECOND_ID, thirdId],
      organizations: [
        organization(FIRST_ID, "Water Lantern Festival", cities[0]![0]!, cities[0]![1]!),
        organization(SECOND_ID, "Water Lantern Festival", cities[1]![0]!, cities[1]![1]!),
        organization(thirdId, "Water Lantern Festival", cities[2]![0]!, cities[2]![1]!),
      ],
    };
    render(
      <DuplicatesView groups={[ambiguous, duplicate]} onRefresh={vi.fn().mockResolvedValue([])} />,
    );

    const card = within(screen.getByTestId(`duplicate-group-${ambiguous.groupKey}`));
    expect(card.queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Merge duplicates" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge all 1 group" })).toBeInTheDocument();
  });

  it("keeps same-address cross-city records in manual review and out of bulk merge", () => {
    const ambiguous: DuplicateGroup = {
      ...locationCandidate,
      classification: "ambiguous_location_candidate",
      evidence: [
        { family: "name", label: "exact organization names agree" },
        { family: "location", label: "locations differ" },
        { family: "address", label: "street addresses repeat across different locations" },
      ],
      organizations: [
        organization(FIRST_ID, "Water Lantern Festival", "Denver", "CO"),
        organization(SECOND_ID, "Water Lantern Festival", "Austin", "TX"),
      ],
    };
    render(
      <DuplicatesView groups={[ambiguous, duplicate]} onRefresh={vi.fn().mockResolvedValue([])} />,
    );

    const card = within(screen.getByTestId(`duplicate-group-${ambiguous.groupKey}`));
    expect(card.getByText(/street addresses repeat/i)).toBeInTheDocument();
    expect(card.queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Merge duplicates" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge all 1 group" })).toBeInTheDocument();
  });


  it("shows the manual warning and strong evidence for a shared-website exact-name bucket", () => {
    const thirdId = "44444444-4444-4444-8444-444444444444";
    const ambiguous: DuplicateGroup = {
      ...locationCandidate,
      classification: "ambiguous_location_candidate",
      groupKey: `organization-family:${FIRST_ID}|${SECOND_ID}|${thirdId}`,
      candidateIds: [FIRST_ID, SECOND_ID, thirdId],
      evidence: [
        { family: "name", label: "exact organization names agree" },
        { family: "website", label: "website domains agree" },
        { family: "location", label: "locations differ" },
      ],
      organizations: [
        organization(FIRST_ID, "Water Lantern Festival", "Denver", "CO"),
        organization(SECOND_ID, "Water Lantern Festival", "Austin", "TX"),
        organization(thirdId, "Water Lantern Festival", "Boston", "MA"),
      ],
    };

    render(
      <DuplicatesView groups={[ambiguous, duplicate]} onRefresh={vi.fn().mockResolvedValue([])} />,
    );

    const card = within(screen.getByTestId(`duplicate-group-${ambiguous.groupKey}`));
    expect(card.getByText(/ambiguous location match/i)).toBeInTheDocument();
    expect(card.getByText(/same website domain/i)).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Merge duplicates" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge all 1 group" })).toBeInTheDocument();
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
    fireEvent.change(await within(dialog).findByLabelText("Existing parent"), {
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
