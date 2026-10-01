import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/auth-token", () => mock);
import { WorkRecordReview } from "./WorkRecordReview";
import { reviewLink } from "./client";
afterEach(cleanup);
it("opens the exact linked follow-up instead of the profile overview", async () => {
  const href = reviewLink(
    { kind: "followup", recordId: "target", label: "Review" },
    "profile",
  )!;
  const q = new URL(href, "https://example.test").searchParams;
  mock.apiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      followUps: [
        { id: "other", kind: "Wrong record" },
        {
          id: "target",
          kind: "Call customer",
          dueAt: "2027-02-01T18:00:00Z",
          outcome: "Confirm their dates",
        },
      ],
    }),
  });
  render(
    <WorkRecordReview
      profileId="profile"
      kind={q.get("workReview")}
      recordId={q.get("recordId")}
    />,
  );
  expect(await screen.findByText("Call customer")).toBeTruthy();
  expect(screen.queryByText("Wrong record")).toBeNull();
  expect(screen.getByText("Confirm their dates")).toBeTruthy();
});
it("selects the exact document and reports a missing record without showing another", async () => {
  const href = reviewLink(
    { kind: "document", recordId: "target", label: "Review" },
    "profile",
  )!;
  const q = new URL(href, "https://example.test").searchParams;
  mock.apiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      documents: [
        { id: "other", displayName: "Wrong file" },
        { id: "target", displayName: "Signed contract", fileAvailable: true },
      ],
    }),
  });
  const { rerender } = render(
    <WorkRecordReview
      profileId="profile"
      kind={q.get("workReview")}
      recordId={q.get("recordId")}
    />,
  );
  expect(await screen.findByText("Signed contract")).toBeTruthy();
  expect(screen.queryByText("Wrong file")).toBeNull();
  rerender(
    <WorkRecordReview profileId="profile" kind="document" recordId="missing" />,
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("no longer available"),
  );
});
