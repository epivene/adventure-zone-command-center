import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiFetch: fetcher }));
vi.mock("@/lib/boss-auth-context", () => ({ bossFetch: fetcher }));
vi.mock("wouter", () => ({
  useSearch: () => "?edition=edition-1",
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
import ConventionOutreachPage from "./ConventionOutreachPage";
const edition = {
  id: "edition-1",
  convention: "Heartland",
  year: 2026,
  summary: "I found returning contacts.",
  recommendation: "I want to try these events.",
  sources: "Convention directory",
  revision: 2,
  member_count: 2,
  unresolved_count: 1,
  archived_at: null,
};
const data = {
  sourceKey: "one",
  event: "County Fair",
  contact: "Sam",
  email: "fair@example.com",
  group: "replacement",
  outcome: "not_contacted",
  attendance: "association_only",
  notes: "They already have inflatables.",
  reason: "I would offer to replace the current provider.",
  sources: "Directory entry",
  nextAction: "Confirm the event contact",
};
beforeEach(() => {
  fetcher.mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === "PATCH")
      return new Response(JSON.stringify({ edition }));
    if (path.endsWith("/edition-1"))
      return new Response(
        JSON.stringify({
          edition,
          members: [
            {
              id: "one",
              edition_id: edition.id,
              revision: 1,
              organization_id: "profile-1",
              contact_id: null,
              data,
            },
            {
              id: "two",
              edition_id: edition.id,
              revision: 1,
              organization_id: null,
              contact_id: null,
              data: {
                ...data,
                sourceKey: "two",
                event: "Sweet Corn Festival",
                group: "special",
              },
            },
          ],
          review: null,
          history: [],
        }),
      );
    return new Response(JSON.stringify({ editions: [edition] }));
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("convention workspace", () => {
  it("turns the live convention roster into a printable game sheet", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<ConventionOutreachPage boss />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Convention Game" }),
    );

    expect(
      screen.getByRole("table", {
        name: "Heartland 2026 convention game",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Met" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Follow up" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Event info" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Next action" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Open linked profile")).toBeInTheDocument();
    expect(screen.getByText("Profile needed")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open County Fair profile" }),
    ).toHaveAttribute(
      "href",
      "/boss/profiles/profile-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Print Game Sheet" }));
    expect(print).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Email group"), {
      target: { value: "replacement" },
    });
    expect(screen.queryByText("Sweet Corn Festival")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(screen.getByText(/Replacement only/)).toBeInTheDocument();
    print.mockRestore();
  });

  it("lets Dave fill out and save a linked convention card", async () => {
    render(<ConventionOutreachPage boss />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Convention Game" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Fill out County Fair convention card",
      }),
    );

    fireEvent.click(screen.getByLabelText("Met at convention"));
    fireEvent.click(screen.getByLabelText("Interested"));
    fireEvent.click(screen.getByLabelText("Follow-up needed"));
    fireEvent.change(screen.getByLabelText("Person spoken to"), {
      target: { value: "Taylor, fair manager" },
    });
    fireEvent.change(screen.getByLabelText("Convention notes"), {
      target: { value: "Wants the five-attraction package." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save convention card" }),
    );

    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/boss/conventions/edition-1/members/one/convention-response",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            revision: 1,
            conventionResponse: {
              met: true,
              interested: true,
              followUp: true,
              contact: "Taylor, fair manager",
              notes: "Wants the five-attraction package.",
            },
          }),
        }),
      ),
    );
  });

  it("links profiles through the admin path in Game view", async () => {
    render(<ConventionOutreachPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Convention Game" }),
    );

    expect(
      screen.getByRole("link", { name: "Open County Fair profile" }),
    ).toHaveAttribute(
      "href",
      "/profiles/profile-1",
    );
  });

  it("keeps replacement and special-handling contacts visible in the simple view", async () => {
    render(<ConventionOutreachPage boss />);
    expect(await screen.findByText("County Fair")).toBeInTheDocument();
    expect(screen.getByText("Sweet Corn Festival")).toBeInTheDocument();
    expect(screen.getByText(/Replacement only/)).toBeInTheDocument();
    expect(screen.getByText(/Keep out of bulk email/)).toBeInTheDocument();
    expect(screen.queryByText("Apply import")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit convention notes")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Profile" })).toHaveAttribute(
      "href",
      "/boss/profiles/profile-1",
    );
    fireEvent.change(screen.getByLabelText("Email group"), {
      target: { value: "replacement" },
    });
    expect(screen.queryByText("Sweet Corn Festival")).not.toBeInTheDocument();
  });
  it("saves first-person plan notes with the revision shown to the owner", async () => {
    render(<ConventionOutreachPage />);
    fireEvent.click(await screen.findByText("Edit convention notes"));
    fireEvent.change(screen.getByLabelText("What I found"), {
      target: { value: "I checked the directory." },
    });
    fireEvent.click(screen.getByText("Save convention notes"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/conventions/edition-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            revision: 2,
            summary: "I checked the directory.",
            recommendation: edition.recommendation,
            sources: edition.sources,
            archived: false,
          }),
        }),
      ),
    );
  });
  it("shows a failed load and offers a retry", async () => {
    fetcher.mockRejectedValueOnce(new Error("Connection interrupted"));
    render(<ConventionOutreachPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection interrupted",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
  it("keeps the newest profile search results when an older request finishes last", async () => {
    const original = fetcher.getMockImplementation()!;
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const newResponse = new Promise<Response>((resolve) => {
      resolveNew = resolve;
    });
    fetcher.mockImplementation((path: string, options?: RequestInit) => {
      if (path.includes("/profile-search?q=old")) return oldResponse;
      if (path.includes("/profile-search?q=new")) return newResponse;
      return original(path, options);
    });

    render(<ConventionOutreachPage />);
    expect(await screen.findByText("Sweet Corn Festival")).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Edit notes / link profile",
      })[1],
    );
    const profileSearch = screen.getByLabelText("Find profile");
    fireEvent.change(profileSearch, { target: { value: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));
    fireEvent.change(profileSearch, { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));

    resolveNew(
      new Response(
        JSON.stringify({
          profiles: [
            {
              organizationId: "new-profile",
              contactId: "new-contact",
              name: "Newest Fair",
              contact: "Current Contact",
              email: "current@example.com",
            },
          ],
        }),
      ),
    );
    expect(
      await screen.findByRole("button", { name: /Newest Fair/ }),
    ).toBeInTheDocument();

    resolveOld(new Response(JSON.stringify({ profiles: [] })));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Newest Fair/ }),
      ).toBeInTheDocument(),
    );
  });
  it("searches the current visible profile query when the input is ahead of React state", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((path: string, options?: RequestInit) => {
      if (path.includes("/profile-search?q=visible")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              profiles: [
                {
                  organizationId: "visible-profile",
                  contactId: "visible-contact",
                  name: "Visible Fair",
                  contact: "Current Contact",
                  email: "current@example.com",
                },
              ],
            }),
          ),
        );
      }
      if (path.includes("/profile-search")) {
        return Promise.resolve(new Response(JSON.stringify({ profiles: [] })));
      }
      return original(path, options);
    });

    render(<ConventionOutreachPage />);
    expect(await screen.findByText("Sweet Corn Festival")).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Edit notes / link profile",
      })[1],
    );
    const profileSearch = screen.getByLabelText(
      "Find profile",
    ) as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(profileSearch, "visible");
    fireEvent.click(screen.getByRole("button", { name: "Search profiles" }));

    expect(
      await screen.findByRole("button", { name: /Visible Fair/ }),
    ).toBeInTheDocument();
  });
});
