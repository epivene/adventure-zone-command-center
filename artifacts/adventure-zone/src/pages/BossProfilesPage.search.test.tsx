import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bossGet: vi.fn() }));

vi.mock("@/lib/boss-auth-context", () => ({ bossGet: mocks.bossGet }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/boss/profiles", vi.fn()],
  useSearch: () => "",
}));

import BossProfilesPage from "./BossProfilesPage";

const emptyPage = { records: [], families: [], total: 0, page: 1, pageCount: 1 };
const matchingPage = {
  ...emptyPage,
  records: [{ id: "profile-1", name: "Rock Springs Fair", city: "Rock Springs", region: "WY", primaryContactName: null, profileImageDataUrl: null, contactCount: 1, bookingCount: 0, locationCount: 1 }],
  total: 1,
};

describe("Boss profile search", () => {
  beforeEach(() => {
    mocks.bossGet.mockReset();
    mocks.bossGet.mockResolvedValueOnce(emptyPage).mockResolvedValueOnce(matchingPage);
  });

  it("searches while Dave types without requiring a Search button", async () => {
    render(<BossProfilesPage />);
    await waitFor(() => expect(mocks.bossGet).toHaveBeenCalledWith("/boss/profiles?"));

    const input = screen.getByRole("textbox", { name: "Search profiles" });
    expect(input).toHaveStyle({ paddingLeft: "3rem" });
    fireEvent.change(input, { target: { value: "rock springs" } });

    await waitFor(() => expect(mocks.bossGet).toHaveBeenCalledWith("/boss/profiles?q=rock+springs"));
    expect(await screen.findByText("Rock Springs Fair")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });

  it("shows search progress until the typed search finishes", async () => {
    let finishSearch!: (value: typeof matchingPage) => void;
    const pendingSearch = new Promise<typeof matchingPage>((resolve) => { finishSearch = resolve; });
    mocks.bossGet.mockReset();
    mocks.bossGet.mockResolvedValueOnce(emptyPage).mockReturnValueOnce(pendingSearch);

    render(<BossProfilesPage />);
    await waitFor(() => expect(mocks.bossGet).toHaveBeenCalledWith("/boss/profiles?"));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Searching profiles" })).not.toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: "Search profiles" }), { target: { value: "rock springs" } });

    expect(screen.getByRole("status", { name: "Searching profiles" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.bossGet).toHaveBeenCalledWith("/boss/profiles?q=rock+springs"));
    finishSearch(matchingPage);
    await waitFor(() => expect(screen.queryByRole("status", { name: "Searching profiles" })).not.toBeInTheDocument());
  });
});
