import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { ProfileTaskList } from "./ProfileTaskList";
import { workspaceApi } from "@/features/assistant-workspace/api";
vi.mock("@/features/assistant-workspace/api", () => ({
  workspaceApi: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());
const task: any = {
  id: "a",
  version: 1,
  state: "paused",
  pauseReason: "budget",
  scope: {
    objective: "Research contacts",
    eventYear: 2027,
    requestedFields: [],
    taskCapUsd: 1,
  },
  authority: { actionKinds: [], allowedFields: [] },
  items: [],
  changes: [],
  counts: {
    total: 120,
    completed: 0,
    needsReview: 4,
    failed: 0,
    remaining: 116,
  },
};
it("shows a task chooser and refreshes server state after a stale command", async () => {
  vi.mocked(workspaceApi).mockImplementation(async (_path, method) => {
    if (method === "POST") throw Error("ASSISTANT_TASK_CONFLICT");
    return [task, { ...task, id: "b" }];
  });
  render(
    <ProfileTaskList
      conversationId="c"
      initialTasks={[task, { ...task, id: "b" }]}
    />,
  );
  expect(await screen.findByText(/Choose a task below/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Resume" })[0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("task changed");
  expect(
    vi
      .mocked(workspaceApi)
      .mock.calls.filter(([, method]) => method === "GET" || !method).length,
  ).toBeGreaterThan(1);
});
it("disables offline writes and refreshes on reconnect without replaying a command", async () => {
  let online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  vi.mocked(workspaceApi)
    .mockClear()
    .mockResolvedValue([{ ...task, version: 2 }]);
  render(<ProfileTaskList conversationId="c" initialTasks={[task]} />);
  expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  online = true;
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Resume" })).not.toBeDisabled(),
  );
  expect(
    vi.mocked(workspaceApi).mock.calls.some(([, method]) => method === "POST"),
  ).toBe(false);
  expect(workspaceApi).toHaveBeenCalled();
});
