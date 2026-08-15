// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportScheduleIssue } from "./report-schedule-issue";

const api = vi.fn(async () => ({}));
const queue = vi.fn(async (mutation) => ({ ...mutation, state: "saved_offline" }));
const flush = vi.fn(async () => [{ id: "mutation-1", legId: "leg-a", method: "POST", path: "/manager/issues", body: {}, createdAt: "now", state: "synced" }]);

vi.mock("@/lib/manager-auth-context", () => ({ useManagerAuth: () => ({ manager: { legId: "leg-a", legName: "Leg A", managerName: null }, managerApi: api }) }));
vi.mock("@/lib/manager-sync-queue", () => ({ queueManagerMutation: queue, flushManagerMutationQueue: flush }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ReportScheduleIssue", () => {
  it("queues a stable id before syncing the report", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    render(<ReportScheduleIssue bookingId="00000000-0000-4000-8000-000000000002" />);
    fireEvent.change(screen.getByLabelText("What needs fixing?"), { target: { value: "Starts an hour later" } });
    fireEvent.click(screen.getByRole("button", { name: "Report issue" }));
    await waitFor(() => expect(queue).toHaveBeenCalledTimes(1));
    expect(queue.mock.calls[0][0].id).toBe("00000000-0000-4000-8000-000000000001");
    expect(queue.mock.calls[0][0].body.clientMutationId).toBe("00000000-0000-4000-8000-000000000001");
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
  });
});
