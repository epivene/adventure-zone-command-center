// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet, apiPost: mocks.apiPost }));

import { RestoreProfileLocationsControl } from "./restore-profile-locations-control";

const profiles = [
  {
    locationId: "20000000-0000-4000-8000-000000000001",
    sourceProfileId: "10000000-0000-4000-8000-000000000002",
    sourceProfileName: "Handmade in Colorado Expo (Estes Park) CO",
    label: "Estes Park, CO",
    city: "Estes Park",
    region: "CO",
  },
  {
    locationId: "20000000-0000-4000-8000-000000000002",
    sourceProfileId: "10000000-0000-4000-8000-000000000003",
    sourceProfileName: "Mile High Global Bazaar (Denver) CO",
    label: "Denver, CO",
    city: "Denver",
    region: "CO",
  },
];

afterEach(cleanup);

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
});

describe("RestoreProfileLocationsControl", () => {
  it("shows the original profiles and requires confirmation before restoring", async () => {
    mocks.apiGet.mockResolvedValue({ profiles });
    mocks.apiPost.mockResolvedValue({
      ok: true,
      restoredLocationCount: 2,
      restoredProfileIds: profiles.map((profile) => profile.sourceProfileId),
    });
    const onRestored = vi.fn();

    render(<RestoreProfileLocationsControl orgId="parent-1" onRestored={onRestored} />);

    expect(await screen.findByText("2 merged profiles can be restored")).toBeVisible();
    expect(screen.getByText("Handmade in Colorado Expo (Estes Park) CO")).toBeVisible();
    expect(screen.getByText("Mile High Global Bazaar (Denver) CO")).toBeVisible();
    expect(mocks.apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Restore separate profiles" }));
    expect(screen.getByText(/This will turn these 2 locations back into separate profiles/i)).toBeVisible();
    expect(mocks.apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, restore 2 profiles" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith(
      "/organizations/parent-1/locations/restore-profiles",
      {},
    ));
    expect(await screen.findByText("Restored 2 separate profiles. They’re ready to add to an Event Family.")).toBeVisible();
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the profile has no reversible merged locations", async () => {
    mocks.apiGet.mockResolvedValue({ profiles: [] });
    const { container } = render(<RestoreProfileLocationsControl orgId="parent-2" />);

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
