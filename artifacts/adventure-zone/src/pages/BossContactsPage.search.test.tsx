import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BossContactsPage from "./BossContactsPage";
import { bossGet } from "@/lib/boss-auth-context";

vi.mock("@/lib/boss-auth-context", () => ({ bossGet: vi.fn() }));

describe("Boss contact search", () => {
  beforeEach(() => vi.mocked(bossGet).mockReset());

  it("asks the server for forgiving contact, profile, and phone matches", async () => {
    vi.mocked(bossGet)
      .mockResolvedValueOnce({ contacts: [] })
      .mockResolvedValueOnce({ contacts: [{ id: "contact-1", firstName: "Mary", lastName: "Johnson", organizationName: "Rock Springs Fair", jobTitle: "Director", region: "Wyoming" }] });

    render(<BossContactsPage />);
    await waitFor(() => expect(bossGet).toHaveBeenCalledWith("/boss/contacts"));

    const input = screen.getByTestId("input-contacts-search");
    expect(input).toHaveStyle({ paddingLeft: "3rem" });
    fireEvent.change(input, { target: { value: "wryomin" } });

    await waitFor(() => expect(bossGet).toHaveBeenCalledWith("/boss/contacts?q=wryomin"));
    expect(await screen.findByText("Mary Johnson")).toBeInTheDocument();
    expect(screen.getByText(/Rock Springs Fair/)).toBeInTheDocument();
    expect(screen.getByText(/Director/)).toBeInTheDocument();
  });

  it("keeps the current contacts visible while a new search is loading", async () => {
    let finishSearch!: (value: { contacts: never[] }) => void;
    vi.mocked(bossGet)
      .mockResolvedValueOnce({ contacts: [{ id: "contact-1", firstName: "Mary", lastName: "Johnson", organizationName: "Rock Springs Fair" }] })
      .mockImplementationOnce(() => new Promise((resolve) => { finishSearch = resolve as typeof finishSearch; }));

    render(<BossContactsPage />);
    expect(await screen.findByText("Mary Johnson")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-contacts-search"), { target: { value: "mary" } });
    await waitFor(() => expect(bossGet).toHaveBeenCalledWith("/boss/contacts?q=mary"));

    expect(screen.getByText("Mary Johnson")).toBeInTheDocument();
    finishSearch({ contacts: [] });
  });
});
