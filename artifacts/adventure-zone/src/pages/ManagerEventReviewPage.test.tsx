// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerEventReviewPage from "./ManagerEventReviewPage";

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (path: string) => {
    if (path === "/manager/reviews/due") {
      return { reviewsDue: [{ id: "booking-a", name: "Old Fair" }] };
    }
    return {};
  }),
  queue: vi.fn(async (mutation: any) => ({ ...mutation, state: "saved_offline" })),
  flush: vi.fn(async () => []),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ manager: { legId: "leg-a" }, managerApi: mocks.api }),
}));
vi.mock("@/lib/manager-sync-queue", () => ({
  queueManagerMutation: mocks.queue,
  flushManagerMutationQueue: mocks.flush,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ManagerEventReviewPage", () => {
  it("queues an event review with 0-5 rating and return recommendation", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<ManagerEventReviewPage />);
    expect(await screen.findByText("Old Fair")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Event rating"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Feedback"), { target: { value: "Great site" } });
    fireEvent.change(screen.getByLabelText("Recommend return"), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(1));
    expect(mocks.queue.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        path: "/manager/reviews",
        body: expect.objectContaining({ bookingId: "booking-a", rating: 5, recommendReturn: "yes" }),
      }),
    );
  });
});
