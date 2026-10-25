import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { FinalOpportunityDecision } from "./final-opportunity-decision";
import { apiPost } from "@/lib/auth-token";
vi.mock("@/lib/auth-token", () => ({ apiPost: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("requires a final reason and submits the exact source revision with the new status", async () => {
  vi.mocked(apiPost).mockResolvedValue({});
  const saved = vi.fn();
  render(
    <FinalOpportunityDecision
      id="opportunity"
      revision="exact"
      status="booked"
      year={2027}
      onSaved={saved}
      onCancel={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Save status and next step" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Final decision"), {
    target: { value: "none" },
  });
  fireEvent.change(screen.getByLabelText("No further action reason"), {
    target: { value: "Planning is complete" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save status and next step" }),
  );
  await waitFor(() =>
    expect(apiPost).toHaveBeenCalledWith(
      "/work-queue/decide",
      expect.objectContaining({
        expectedRevision: "exact",
        finalStatus: "booked",
        nextAction: null,
        noFurtherActionReason: "Planning is complete",
      }),
    ),
  );
  expect(saved).toHaveBeenCalled();
});
