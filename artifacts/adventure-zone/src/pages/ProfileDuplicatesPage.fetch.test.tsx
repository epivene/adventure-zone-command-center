// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth-token", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
import { apiGet } from "@/lib/auth-token";
import ProfileDuplicatesPage from "./ProfileDuplicatesPage";
const pair = {
  left: { id: "a", name: "Wyoming State Fair" },
  right: { id: "b", name: "County Fair - Wyoming State Fair" },
  score: 100,
  confidence: "High",
  reasons: [],
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps duplicate suggestions when merge history cannot be fetched", async () => {
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path.endsWith("history")) throw new TypeError("Failed to fetch");
    return { scanned: 2, pairs: [pair] } as any;
  });
  render(<ProfileDuplicatesPage />);
  await screen.findByText("High � 100/100");
  expect(screen.getByText(/Merge history could not be loaded/)).toBeTruthy();
});
it("identifies a scan fetch failure without saying there are no duplicates", async () => {
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (!path.endsWith("history")) throw new TypeError("Failed to fetch");
    return [] as any;
  });
  render(<ProfileDuplicatesPage />);
  await screen.findByText(/Duplicate scan could not be loaded/);
  expect(screen.queryByText(/No suggestions in this filter/)).toBeNull();
});
