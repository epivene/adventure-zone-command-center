import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileDesignStudioPicker } from "./ProfileDesignStudioPicker";
import { designStudioApi } from "@/lib/design-studio-api";

const { setLocation } = vi.hoisted(() => ({ setLocation: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/profiles/p1", setLocation] }));

describe("ProfileDesignStudioPicker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocation.mockReset();
    vi.spyOn(designStudioApi, "listTemplates").mockResolvedValue([
      { id: "t1", name: "Mini Zone prepaid", type: "proposal", templateFamily: "proposal", state: "active" },
    ]);
  });

  it("creates a draft linked to the open profile", async () => {
    const instantiate = vi.spyOn(designStudioApi, "instantiateTemplate").mockResolvedValue({
      id: "d1",
      name: "Mini Zone prepaid | 2027",
      type: "proposal",
      status: "draft",
    });
    render(
      <ProfileDesignStudioPicker
        open
        onOpenChange={() => undefined}
        organizationId="00000000-0000-4000-8000-000000000001"
        contactId="00000000-0000-4000-8000-000000000002"
        bookingId="00000000-0000-4000-8000-000000000003"
        documentYear={2027}
      />,
    );
    fireEvent.click(await screen.findByRole("tab", { name: "Proposals (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Use this template" }));
    await waitFor(() => expect(instantiate).toHaveBeenCalledWith("t1", {
      linkedOrganizationId: "00000000-0000-4000-8000-000000000001",
      linkedContactId: "00000000-0000-4000-8000-000000000002",
      linkedBookingId: "00000000-0000-4000-8000-000000000003",
      documentYear: 2027,
    }));
    expect(setLocation).toHaveBeenCalledWith("/design-studio/d1");
  });
});
