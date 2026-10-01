import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/auth-token", () => mock);
import { WorkQueue } from "./WorkQueue";
const activity = {
  id: "a",
  profileId: "p",
  eventYear: 2027,
  bookingId: null,
  queue: "replies",
  title: "Fair reply",
  nextAction: "Review the reply",
  assignedTo: { kind: "connection", id: "com" },
  status: "draft_ready",
  dueAt: null,
  progress: { completed: 20, total: 64, summary: "44 profiles remain" },
  links: [
    {
      kind: "email",
      url: "https://mail.google.com/mail/u/0/#all/abc",
      label: "Customer email",
    },
  ],
  revision: 1,
  createdAt: "2026-10-01T15:00:00Z",
  updatedAt: "2026-10-01T15:00:00Z",
};
const response = (data: any, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
beforeEach(() => {
  mock.apiFetch.mockReset();
  mock.apiFetch.mockImplementation((path: string) =>
    path.includes("/actors")
      ? response([{ kind: "connection", id: "com", label: "Com" }])
      : response({ items: [activity], nextCursor: null }),
  );
});
afterEach(cleanup);
it("shows progress, next action, owner and safe review links", async () => {
  render(<WorkQueue />);
  expect(await screen.findByText("Fair reply")).toBeTruthy();
  expect(screen.getByText("20 of 64 completed")).toBeTruthy();
  expect(screen.getByText("44 profiles remain")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Customer email" }).getAttribute("href"),
  ).toContain("https://mail.google.com");
  expect(screen.getAllByText(/Com/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Last updated/)).toBeTruthy();
});
it("preserves unsaved text after a revision conflict", async () => {
  render(<WorkQueue />);
  await screen.findByText("Fair reply");
  fireEvent.click(screen.getByRole("button", { name: "Edit work" }));
  fireEvent.change(screen.getByLabelText("Next action"), {
    target: { value: "My edited wording" },
  });
  mock.apiFetch.mockImplementation((path: string, init: any) =>
    init?.method === "PATCH"
      ? response(
          {
            error: "WORK_REVISION_CONFLICT",
            current: { ...activity, revision: 2 },
          },
          409,
        )
      : response({ items: [activity], nextCursor: null }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("changed"),
  );
  expect(
    (screen.getByLabelText("Next action") as HTMLTextAreaElement).value,
  ).toBe("My edited wording");
});
it.each([true, false])("reconciles edits with refresh=%s", async (refresh) => {
  let latest = activity;
  mock.apiFetch.mockImplementation((path: string, init: any) =>
    path.includes("/actors")
      ? response([])
      : init?.method === "PATCH"
        ? response({ error: "WORK_REVISION_CONFLICT", current: latest }, 409)
        : response({ items: [latest], nextCursor: null }),
  );
  render(<WorkQueue />);
  await screen.findByText("Fair reply");
  fireEvent.click(screen.getByRole("button", { name: "Edit work" }));
  fireEvent.change(screen.getByLabelText("Next action"), {
    target: { value: "Keep my wording" },
  });
  latest = {
    ...activity,
    revision: 2,
    nextAction: "Com correction",
    status: "waiting_customer",
  };
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  if (refresh) {
    fireEvent.click(screen.getByRole("button", { name: "Refresh work" }));
    await screen.findByText("Com correction");
  }
  expect(
    (screen.getByLabelText("Next action") as HTMLTextAreaElement).value,
  ).toBe("Keep my wording");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Use latest version and keep my changes",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(
      mock.apiFetch.mock.calls.filter(([, i]) => i?.method === "PATCH"),
    ).toHaveLength(2),
  );
  const body = JSON.parse(
    mock.apiFetch.mock.calls.filter(([, i]) => i?.method === "PATCH")[1][1]
      .body,
  );
  expect(body.revision).toBe(2);
  expect(body.patch).toEqual({ nextAction: "Keep my wording" });
});
it("handles empty results, errors, and blocks executable links", async () => {
  mock.apiFetch.mockImplementation((p: string) =>
    p.includes("/actors")
      ? response([])
      : response({
          items: [
            {
              ...activity,
              links: [
                { kind: "email", label: "Unsafe", url: "javascript:alert(1)" },
              ],
            },
          ],
          nextCursor: null,
        }),
  );
  render(<WorkQueue />);
  await screen.findByText("Fair reply");
  expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
  cleanup();
  mock.apiFetch.mockImplementation(() =>
    response({ items: [], nextCursor: null }),
  );
  render(<WorkQueue />);
  expect(await screen.findByText("No matching work.")).toBeTruthy();
  cleanup();
  mock.apiFetch.mockImplementation(() =>
    response({ error: "Unavailable" }, 500),
  );
  render(<WorkQueue />);
  expect(await screen.findByRole("alert")).toBeTruthy();
});
it("discards an old response after the profile changes", async () => {
  let resolveOld: (v: any) => void = () => {};
  mock.apiFetch.mockImplementation((p: string) =>
    p.includes("/actors")
      ? response([])
      : p.includes("profileId=old")
        ? new Promise((r) => {
            resolveOld = r;
          })
        : response({
            items: [{ ...activity, title: "New event" }],
            nextCursor: null,
          }),
  );
  const { rerender } = render(<WorkQueue profileId="old" />);
  rerender(<WorkQueue profileId="new" />);
  await screen.findByText("New event");
  resolveOld({
    ok: true,
    json: async () => ({ items: [activity], nextCursor: null }),
  });
  await waitFor(() => expect(screen.queryByText("Fair reply")).toBeNull());
});
it("loads another page and applies status filters", async () => {
  mock.apiFetch.mockImplementation((path: string) =>
    path.includes("/actors")
      ? response([])
      : path.includes("status=blocked")
        ? response({
            items: [
              {
                ...activity,
                id: "blocked",
                title: "Blocked event",
                status: "blocked",
              },
            ],
            nextCursor: null,
          })
        : path.includes("cursor=next")
          ? response({
              items: [{ ...activity, id: "b", title: "Second event" }],
              nextCursor: null,
            })
          : response({ items: [activity], nextCursor: "next" }),
  );
  render(<WorkQueue />);
  await screen.findByText("Fair reply");
  fireEvent.click(screen.getByRole("button", { name: "Load more work" }));
  await screen.findByText("Second event");
  fireEvent.change(screen.getByLabelText("Filter status"), {
    target: { value: "blocked" },
  });
  await screen.findByText("Blocked event");
  expect(screen.queryByText("Fair reply")).toBeNull();
});
it("keeps the exact existing due time when only next action changes", async () => {
  const dated = { ...activity, dueAt: "2027-06-10T15:30:00Z" };
  mock.apiFetch.mockImplementation((path: string, init: any) =>
    path.includes("/actors")
      ? response([])
      : init?.method === "PATCH"
        ? response({ ...dated, ...JSON.parse(init.body).patch, revision: 2 })
        : response({ items: [dated], nextCursor: null }),
  );
  render(<WorkQueue />);
  await screen.findByText("Fair reply");
  fireEvent.click(screen.getByRole("button", { name: "Edit work" }));
  fireEvent.change(screen.getByLabelText("Next action"), {
    target: { value: "Updated action" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(
      mock.apiFetch.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(true),
  );
  const body = JSON.parse(
    mock.apiFetch.mock.calls.find(([, init]) => init?.method === "PATCH")![1]
      .body,
  );
  expect(body.patch.dueAt).toBeUndefined();
});
