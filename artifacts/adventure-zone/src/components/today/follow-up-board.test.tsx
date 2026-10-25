import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowUpBoard } from "./follow-up-board";
import { apiGet, apiPost } from "@/lib/auth-token";
vi.mock("@/lib/auth-token", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
const reminder = {
  id: "reminder",
  source: "followup",
  revision: "exact revision",
  bucket: "today",
  organizationId: "profile",
  contactId: null,
  bookingId: null,
  name: "County Fair",
  nextAction: "Ask about quote",
  dueAt: "2026-10-24T16:00:00Z",
  status: "contacted",
};
function pages() {
  vi.mocked(apiGet).mockImplementation(
    async (path) =>
      ({
        items: path.includes("bucket=today") ? [reminder] : [],
        total: path.includes("bucket=today") ? 1 : 0,
        counts: { needsNextStep: 32, overdue: 0, today: 1, upcoming: 0 },
        offset: 0,
        limit: 25,
        timeZone: "America/Denver",
        checkedAt: "2026-10-24T16:00:00Z",
      }) as never,
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("FollowUpBoard", () => {
  it("shows the event year and sends it to COM", async () => {
    pages();
    const original = vi.mocked(apiGet).getMockImplementation()!;
    vi.mocked(apiGet).mockImplementation(async (path) => {
      const page: any = await original(path);
      return {
        ...page,
        items: page.items.map((item: any) => ({ ...item, eventYear: 2027 })),
      };
    });
    vi.mocked(apiPost).mockResolvedValue({
      profile: { name: "County Fair" },
      notes: [],
      emails: [],
      bookings: [],
      approvedTemplate: null,
      templateChoices: [],
    });
    render(<FollowUpBoard />);
    expect(await screen.findByText("2027 season")).toBeVisible();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Draft with COM for County Fair",
      }),
    );
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/com/draft-context",
        expect.objectContaining({ eventYear: 2027 }),
      ),
    );
  });
  it("keeps missing-next-step totals prominent even when another bucket is selected", async () => {
    pages();
    render(<FollowUpBoard />);
    expect(
      await screen.findByRole("alert", { name: "Missing next steps" }),
    ).toHaveTextContent("32");
    expect(
      screen.getByRole("heading", { name: /Needs a next step/ }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: /Overdue/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Due today/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Coming up/ })).toBeVisible();
  });
  it("snoozes using the displayed revision", async () => {
    pages();
    vi.mocked(apiPost).mockResolvedValue({});
    render(<FollowUpBoard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Snooze County Fair 7 days" }),
    );
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/follow-ups/reminder/snooze",
        expect.objectContaining({ expectedRevision: "exact revision" }),
      ),
    );
  });
  it("requires a reason when completing without a next action", async () => {
    pages();
    render(<FollowUpBoard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Complete County Fair" }),
    );
    fireEvent.change(screen.getByLabelText("Outcome"), {
      target: { value: "Organizer declined" },
    });
    fireEvent.click(screen.getByLabelText("No further action"));
    expect(
      screen.getByRole("button", { name: "Save decision" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Not booking this season" },
    });
    expect(screen.getByRole("button", { name: "Save decision" })).toBeEnabled();
  });
  it("refreshes after a stale response and discards the stale completion form", async () => {
    pages();
    vi.mocked(apiPost).mockRejectedValue(
      new Error("This item changed. Refresh before trying again."),
    );
    render(<FollowUpBoard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Snooze County Fair 7 days" }),
    );
    expect(await screen.findByText(/This item changed/)).toBeVisible();
    await waitFor(() =>
      expect(vi.mocked(apiGet).mock.calls.length).toBeGreaterThanOrEqual(8),
    );
  });
  it("prepares COM context with approved HTML and recent emails", async () => {
    pages();
    vi.mocked(apiPost).mockResolvedValue({
      profile: { name: "County Fair" },
      notes: [],
      emails: [{ subject: "Budget question", snippet: "What is the quote?" }],
      bookings: [],
      approvedTemplate: {
        id: "template",
        subject: "The Adventure Zone",
        html: "<p>Approved HTML</p>",
      },
      templateChoices: [],
    });
    render(<FollowUpBoard />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Draft with COM for County Fair",
      }),
    );
    expect(await screen.findByLabelText("Approved template HTML")).toHaveValue(
      "<p>Approved HTML</p>",
    );
    expect(screen.getByText("Budget question")).toBeVisible();
    expect(apiPost).toHaveBeenCalledWith(
      "/com/draft-context",
      expect.objectContaining({ profileId: "profile", purpose: "follow_up" }),
    );
  });
});
