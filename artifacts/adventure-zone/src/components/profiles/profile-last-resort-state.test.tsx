import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useProfileLastResortState } from "./profile-last-resort-action";
const apiGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("@/actions/organizations", () => ({ setLastResortAction: vi.fn() }));
beforeEach(() => apiGet.mockReset());
it("uses the loaded profile without another request and accepts updated props", () => {
  const { result, rerender } = renderHook(({ value }) => useProfileLastResortState("a", value), { initialProps: { value: { lastResort: true, lastResortReason: "Past experience" } } });
  expect(result.current.state).toEqual({ lastResort: true, lastResortReason: "Past experience" });
  rerender({ value: { lastResort: false, lastResortReason: "" } });
  expect(result.current.state?.lastResort).toBe(false);
  expect(apiGet).not.toHaveBeenCalled();
});
it("still refreshes explicitly after a saved status change", async () => {
  apiGet.mockResolvedValue({ place: { lastResort: true, lastResortReason: "Updated" } });
  const { result } = renderHook(() => useProfileLastResortState("a", { lastResort: false, lastResortReason: null }));
  await act(async () => { await result.current.refresh(); });
  expect(apiGet).toHaveBeenCalledTimes(1);
  expect(result.current.state?.lastResortReason).toBe("Updated");
});
it("loads status for callers without an existing profile", async () => {
  apiGet.mockResolvedValue({ place: { lastResort: true, lastResortReason: "Existing" } });
  const { result } = renderHook(() => useProfileLastResortState("a"));
  await waitFor(() => expect(result.current.state?.lastResort).toBe(true));
  expect(apiGet).toHaveBeenCalledTimes(1);
});
it("ignores an old response after switching profiles", async () => {
  let resolveOld!: (value: unknown) => void;
  apiGet.mockImplementation(() => new Promise(resolve => { resolveOld = resolve; }));
  const { result, rerender } = renderHook(({ id, supplied }: { id: string; supplied?: { lastResort: boolean; lastResortReason: string | null } }) => useProfileLastResortState(id, supplied), { initialProps: { id: "a" } });
  rerender({ id: "b", supplied: { lastResort: false, lastResortReason: null } });
  await act(async () => { resolveOld({ place: { lastResort: true, lastResortReason: "Old profile" } }); });
  expect(result.current.state).toEqual({ lastResort: false, lastResortReason: null });
});
