import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bossGet: vi.fn() }));
vi.mock("@/lib/boss-auth-context", () => ({ bossGet: mocks.bossGet }));
import BossProfilesPage from "./BossProfilesPage";

const emptyPage = { records: [], families: [], travelLegs: [], total: 0, page: 1, pageSize: 50, pageCount: 1 };
const matchingPage = {
  ...emptyPage,
  records: [{ id: "profile-1", name: "Rock Springs Fair", city: "Rock Springs", region: "WY", primaryContactName: null, contactCount: 1, bookingCount: 0, locationCount: 1 }],
  total: 1,
};
beforeEach(() => {
  window.history.replaceState(null, "", "/boss/profiles");
  mocks.bossGet.mockReset();
  mocks.bossGet.mockResolvedValueOnce(emptyPage).mockResolvedValue(matchingPage);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Boss profile directory parity", () => {
  it("searches while Dave types and preserves sorting in profile and back links", async () => {
    window.history.replaceState(null, "", "/boss/profiles?sort=name_asc");
    render(<BossProfilesPage />);
    await waitFor(() => expect(mocks.bossGet).toHaveBeenCalledWith("/boss/profiles?sort=name_asc"));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Searching profiles" })).not.toBeInTheDocument());
    const input = screen.getByRole("searchbox", { name: "Search profiles" });
    expect(input).toHaveStyle({ paddingLeft: "3rem" });
    fireEvent.change(input, { target: { value: "rock springs" } });
    await waitFor(() => expect(mocks.bossGet).toHaveBeenCalledWith("/boss/profiles?q=rock+springs&sort=name_asc"));
    const link = await screen.findByRole("link", { name: "Open Rock Springs Fair profile" });
    expect(new URLSearchParams(link.getAttribute("href")!.split("?")[1]).get("returnTo")).toBe("/boss/profiles?q=rock+springs&sort=name_asc");
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Export/ })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("name_asc");
    expect(screen.queryByRole("combobox", { name: "Strategy" })).not.toBeInTheDocument();
  });

  it("shows progress until the typed search finishes", async () => {
    let finishSearch!: (value: typeof matchingPage) => void;
    mocks.bossGet.mockReset();
    mocks.bossGet.mockResolvedValueOnce(emptyPage).mockReturnValueOnce(new Promise((resolve) => { finishSearch = resolve; }));
    render(<BossProfilesPage />);
    await screen.findByRole("searchbox", { name: "Search profiles" });
    await waitFor(() => expect(screen.queryByRole("status", { name: "Searching profiles" })).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole("searchbox", { name: "Search profiles" }), { target: { value: "rock springs" } });
    expect(screen.getByRole("status", { name: "Searching profiles" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.bossGet).toHaveBeenCalledWith("/boss/profiles?q=rock+springs"));
    finishSearch(matchingPage);
    await waitFor(() => expect(screen.queryByRole("status", { name: "Searching profiles" })).not.toBeInTheDocument());
  });
});
