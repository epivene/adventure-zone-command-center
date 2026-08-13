import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import { HierarchyControls } from "./hierarchy-controls";

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPost }));

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_TWO_ID = "22222222-2222-4222-8222-222222222222";
const PARENT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PARENT_ID = "44444444-4444-4444-8444-444444444444";

function profile(overrides: Partial<EventProfile> = {}): EventProfile {
  return {
    id: PROFILE_ID,
    place: {
      id: PROFILE_ID,
      name: "Adventure Zone Reno",
      placeType: "event",
      phone: "555-0100",
      address1: null,
      address2: null,
      city: "Reno",
      region: "NV",
      postalCode: null,
      website: "https://reno.example",
      lastResort: false,
      lastResortReason: null,
      actRecordId: null,
    },
    contacts: [],
    selectedContactId: null,
    bookings: [],
    notes: [],
    followUps: [],
    groups: [],
    sourceProvenance: [],
    parent: null,
    locations: [],
    rollups: {
      locationCount: 0,
      upcomingBookingCount: 0,
      overdueFollowUpCount: 0,
      travelLegs: [],
      mostRecentContactAt: null,
    },
    ...overrides,
  };
}

function organization(
  id: string,
  name: string,
  options: { parent?: { id: string; name: string; website: string | null } | null; locationCount?: number } = {},
) {
  return {
    id,
    name,
    city: null,
    region: null,
    lastResort: false,
    lastResortReason: null,
    lastResortChangedAt: null,
    contactCount: 0,
    bookingCount: 0,
    primaryContactName: null,
    parent: options.parent ?? null,
    locationCount: options.locationCount ?? 0,
  };
}

describe("HierarchyControls", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockResolvedValue({
      organizations: {
        records: [
          organization(PARENT_ID, "Eligible Parent"),
          organization(
            "55555555-5555-4555-8555-555555555555",
            "Existing Child",
            {
              parent: {
                id: PARENT_ID,
                name: "Eligible Parent",
                website: null,
              },
            },
          ),
          organization(
            "66666666-6666-4666-8666-666666666666",
            "Parent With Locations",
            { locationCount: 2 },
          ),
        ],
        total: 3,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
      travelLegs: [],
    });
    apiPost.mockResolvedValue({ ok: true });
  });

  it("creates a new parent from selected location profiles", async () => {
    const onRefresh = vi.fn();
    const parentProfile = profile({
      id: "77777777-7777-4777-8777-777777777777",
      place: {
        ...profile().place,
        id: "77777777-7777-4777-8777-777777777777",
        name: "Current Family",
      },
      locations: [
        {
          id: PROFILE_ID,
          name: "Adventure Zone Reno",
          address1: null,
          address2: null,
          city: "Reno",
          region: "NV",
          postalCode: null,
          website: null,
          localStatus: null,
          nextFollowUp: null,
          nextBooking: null,
          travelLeg: null,
          primaryContactName: null,
        },
        {
          id: LOCATION_TWO_ID,
          name: "Adventure Zone Boise",
          address1: null,
          address2: null,
          city: "Boise",
          region: "ID",
          postalCode: null,
          website: null,
          localStatus: null,
          nextFollowUp: null,
          nextBooking: null,
          travelLeg: null,
          primaryContactName: null,
        },
      ],
    });

    render(<HierarchyControls profile={parentProfile} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Adventure Zone Reno" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Adventure Zone Boise" }));
    fireEvent.change(screen.getByLabelText("Parent name"), {
      target: { value: "Adventure Zone" },
    });
    fireEvent.change(screen.getByLabelText("Parent website"), {
      target: { value: "https://adventure.example" },
    });
    fireEvent.change(screen.getByLabelText("Parent phone"), {
      target: { value: "555-0199" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create parent" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/organizations/hierarchy/create-parent",
        {
          name: "Adventure Zone",
          website: "https://adventure.example",
          phone: "555-0199",
          childIds: [PROFILE_ID, LOCATION_TWO_ID],
        },
      );
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("selects only an eligible existing parent", async () => {
    const onRefresh = vi.fn();
    render(<HierarchyControls profile={profile()} onRefresh={onRefresh} />);

    const select = await screen.findByRole("combobox", {
      name: "Existing parent",
    });
    expect(
      within(select).getByRole("option", { name: "Eligible Parent" }),
    ).toBeInTheDocument();
    expect(
      within(select).queryByRole("option", { name: "Existing Child" }),
    ).not.toBeInTheDocument();
    expect(
      within(select).queryByRole("option", { name: "Parent With Locations" }),
    ).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: PARENT_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Add to parent" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/organizations/hierarchy/parent",
        { childId: PROFILE_ID, parentId: PARENT_ID },
      );
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("moves a child to a different eligible parent", async () => {
    apiGet.mockResolvedValueOnce({
      organizations: {
        records: [organization(OTHER_PARENT_ID, "Other Eligible Parent")],
        total: 1,
        page: 1,
        pageSize: 50,
        pageCount: 1,
      },
      travelLegs: [],
    });
    const onRefresh = vi.fn();
    render(
      <HierarchyControls
        profile={profile({
          parent: {
            id: PARENT_ID,
            name: "Current Parent",
            website: null,
          },
        })}
        onRefresh={onRefresh}
      />,
    );

    const select = await screen.findByRole("combobox", {
      name: "Existing parent",
    });
    fireEvent.change(select, { target: { value: OTHER_PARENT_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Move location" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/organizations/hierarchy/parent",
        { childId: PROFILE_ID, parentId: OTHER_PARENT_ID },
      );
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("confirms ungrouping with the preservation copy", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const onRefresh = vi.fn();
    render(
      <HierarchyControls
        profile={profile({
          parent: {
            id: PARENT_ID,
            name: "Current Parent",
            website: null,
          },
        })}
        onRefresh={onRefresh}
      />,
    );

    const ungroup = screen.getByRole("button", { name: "Ungroup location" });
    fireEvent.click(ungroup);

    expect(confirm).toHaveBeenCalledWith(
      "This removes the organization link only. Local history will stay on this profile.",
    );
    expect(apiPost).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(ungroup);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/organizations/hierarchy/ungroup",
        { childId: PROFILE_ID },
      );
    });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows a hierarchy conflict without refreshing", async () => {
    apiPost.mockRejectedValueOnce(
      new Error("This profile already owns locations and cannot become a location."),
    );
    const onRefresh = vi.fn();
    render(<HierarchyControls profile={profile()} onRefresh={onRefresh} />);

    const select = await screen.findByRole("combobox", {
      name: "Existing parent",
    });
    fireEvent.change(select, { target: { value: PARENT_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Add to parent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This profile already owns locations and cannot become a location.",
    );
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
