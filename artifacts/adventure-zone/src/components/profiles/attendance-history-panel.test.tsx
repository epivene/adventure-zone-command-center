// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  officeGet: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet }));
vi.mock("@/lib/office-auth-context", () => ({ officeGet: mocks.officeGet }));

import { AttendanceHistoryPanel } from "./attendance-history-panel";

const history = [{
  id: "h1",
  year: 2026,
  month: "AUGUST",
  status: "attended" as const,
  sourceEventName: "County Fair",
  sourceLocation: "Miles City MT",
  organizationLocationId: null,
}];

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.officeGet.mockReset();
});

describe("AttendanceHistoryPanel", () => {
  it("loads owner history from the owner profile endpoint", async () => {
    mocks.apiGet.mockResolvedValue({ history });
    render(<AttendanceHistoryPanel mode="owner" profileId="11111111-1111-4111-8111-111111111111" />);
    expect(await screen.findByRole("heading", { name: "Attendance history" })).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith("/event-profiles/11111111-1111-4111-8111-111111111111/attendance-history");
    expect(mocks.officeGet).not.toHaveBeenCalled();
  });

  it("loads Office history only from the Office-filtered endpoint", async () => {
    mocks.officeGet.mockResolvedValue({ history });
    render(<AttendanceHistoryPanel mode="office" profileId="22222222-2222-4222-8222-222222222222" />);
    expect(await screen.findByRole("heading", { name: "Attendance history" })).toBeInTheDocument();
    expect(mocks.officeGet).toHaveBeenCalledWith("/office/profiles/22222222-2222-4222-8222-222222222222/attendance-history");
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });

  it("does not break the profile when history cannot be loaded", async () => {
    mocks.apiGet.mockRejectedValue(new Error("offline"));
    const { container } = render(<AttendanceHistoryPanel mode="owner" profileId="33333333-3333-4333-8333-333333333333" />);
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
