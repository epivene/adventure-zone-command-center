// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth-token", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
import { apiGet, apiPost } from "@/lib/auth-token";
import ProfileDuplicatesPage from "./ProfileDuplicatesPage";
const a = {
  id: "a",
  name: "Wyoming State Fair",
  city: "Douglas",
  region: "WY",
  phone: null,
};
const b = {
  id: "b",
  name: "County Fair - Wyoming State Fair",
  city: "Douglas",
  region: "WY",
  phone: "123",
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("scans read-only, compares fields, and requires explicit merge confirmation", async () => {
  vi.mocked(apiGet).mockImplementation(async (path) =>
    path.endsWith("history")
      ? []
      : ({
          scanned: 2,
          pairs: [
            {
              left: a,
              right: b,
              score: 100,
              confidence: "High",
              reasons: ["Same city"],
            },
          ],
        } as any),
  );
  vi.mocked(apiPost).mockResolvedValue({
    profiles: [a, b],
    tables: [],
    fingerprint: "test",
  });
  render(<ProfileDuplicatesPage />);
  const user = userEvent.setup();
  await screen.findByText("High · 100/100");
  expect(apiPost).not.toHaveBeenCalled();
  await user.click(screen.getByText("Compare / Merge"));
  await screen.findByText("Compare every saved field");
  expect(
    (screen.getByText("Merge and archive duplicate") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText("Not set")).toBeTruthy();
  await user.click(screen.getByRole("checkbox"));
  expect(
    (screen.getByText("Merge and archive duplicate") as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(apiPost).toHaveBeenCalledTimes(1);
});
it("skip is temporary and dismissal calls the pair-only endpoint", async () => {
  vi.mocked(apiGet).mockImplementation(async (path) =>
    path.endsWith("history")
      ? []
      : ({
          scanned: 2,
          pairs: [
            { left: a, right: b, score: 100, confidence: "High", reasons: [] },
          ],
        } as any),
  );
  vi.mocked(apiPost).mockResolvedValue({ dismissed: true });
  render(<ProfileDuplicatesPage />);
  const user = userEvent.setup();
  await user.click(await screen.findByText("Skip for now"));
  expect(apiPost).not.toHaveBeenCalled();
  await user.click(screen.getByText("Scan again"));
  await user.click(await screen.findByText("Not duplicates"));
  await waitFor(() =>
    expect(apiPost).toHaveBeenCalledWith("/profile-duplicates/dismiss", {
      ids: ["a", "b"],
    }),
  );
});
