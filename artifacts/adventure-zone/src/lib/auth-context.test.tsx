import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";
import { getAuthToken, setAuthToken } from "./auth-token";

const clearOffline = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/features/assistant-workspace/offline-store", () => ({
  clearOfflineWorkspace: clearOffline,
}));
vi.mock("@/features/assistant/assistant-offline-cache", () => ({
  clearAssistantCacheForActor: vi.fn(async () => {}),
}));
vi.mock("@/lib/admin-workspace", () => ({ clearBookingReturnPath: vi.fn() }));

function State() {
  const auth = useAuth();
  return (
    <>
      <output>{String(auth.isSignedIn)}</output>
      <button onClick={auth.signOut}>Sign out</button>
    </>
  );
}
const start = () =>
  render(
    <AuthProvider>
      <State />
    </AuthProvider>,
  );
beforeEach(() => {
  clearOffline.mockClear();
  localStorage.setItem("az_owner_token", "owner.current-token");
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("offline owner session boundary", () => {
  it("revalidates the retained session after reconnecting without deleting local drafts", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    start();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("false"),
    );
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("true"),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(clearOffline).not.toHaveBeenCalled();
    expect(getAuthToken()).toBe("owner.current-token");
  });

  it("ignores an older failed validation after a successful reconnect", async () => {
    let completeOld!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            completeOld = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    start();
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("true"),
    );
    await act(async () => completeOld(new Response("{}", { status: 503 })));
    expect(screen.getByRole("status")).toHaveTextContent("true");
    expect(clearOffline).not.toHaveBeenCalled();
  });

  it("keeps saved data on a transient server failure without opening protected online content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 503 }),
    );
    start();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("false"),
    );
    expect(getAuthToken()).toBe("owner.current-token");
    expect(clearOffline).not.toHaveBeenCalled();
  });

  it("retains the prepared token on a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    start();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("false"),
    );
    expect(getAuthToken()).toBe("owner.current-token");
    expect(clearOffline).not.toHaveBeenCalled();
  });

  it("clears prepared private data when authentication is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401 }),
    );
    start();
    await waitFor(() => expect(clearOffline).toHaveBeenCalled());
    expect(getAuthToken()).toBeNull();
  });

  it("clears prepared data when signing out", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    start();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("true"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(clearOffline).toHaveBeenCalled());
    expect(getAuthToken()).toBeNull();
  });

  it("locks and clears snapshots on cross-tab session replacement", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    start();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("true"),
    );
    act(() => {
      localStorage.setItem("az_owner_token", "owner.replacement");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "az_owner_token",
          newValue: "owner.replacement",
          storageArea: localStorage,
        }),
      );
    });
    await waitFor(() => expect(clearOffline).toHaveBeenCalled());
  });

  it("ignores an old startup rejection after the session changes", async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    start();
    act(() => setAuthToken("owner.replacement"));
    await act(async () => {
      resolve(new Response("{}", { status: 401 }));
    });
    expect(getAuthToken()).toBe("owner.replacement");
    expect(screen.getByRole("status")).toHaveTextContent("true");
  });
});
