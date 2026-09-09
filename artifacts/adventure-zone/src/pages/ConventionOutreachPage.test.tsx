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
});
