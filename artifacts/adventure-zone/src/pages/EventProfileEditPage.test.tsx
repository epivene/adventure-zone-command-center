import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const apiPatch = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPatch }));
vi.mock("wouter", () => ({
  useParams: () => ({ profileId: "10000000-0000-4000-8000-000000000001" }),
  useLocation: () => ["/event-profiles/10000000-0000-4000-8000-000000000001/edit", navigate],
}));

import EventProfileEditPage from "./EventProfileEditPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventProfileEditPage", () => {
  it("saves optional profile fields as blank", async () => {
    apiGet.mockResolvedValue({
      place: {
        name: "Water Lantern Festival",
        phone: "701-555-0100",
        address1: null,
        address2: null,
        city: "Fargo",
        region: "ND",
        postalCode: null,
        website: "https://example.com",
      },
    });
    apiPatch.mockResolvedValue({ ok: true });

    render(<EventProfileEditPage />);

    await screen.findByDisplayValue("Water Lantern Festival");
    fireEvent.change(screen.getByLabelText("Office phone"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(
      "/event-profiles/10000000-0000-4000-8000-000000000001",
      expect.objectContaining({ phone: "", website: "", address1: "", address2: "", postalCode: "" }),
    ));
    expect(navigate).toHaveBeenCalledWith("/event-profiles/10000000-0000-4000-8000-000000000001");
  });
});
