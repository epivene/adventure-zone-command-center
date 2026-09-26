import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  getAuthToken,
  onAuthChange,
  setAuthToken,
} from "./auth-token";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("owner session changes", () => {
  it("notifies an open offline workspace when another tab signs out", () => {
    setAuthToken("owner.old-token");
    const listener = vi.fn();
    const unsubscribe = onAuthChange(listener);
    localStorage.removeItem("az_owner_token");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "az_owner_token",
        oldValue: "owner.old-token",
        newValue: null,
        storageArea: localStorage,
      }),
    );
    expect(listener).toHaveBeenCalledWith(null);
    unsubscribe();
  });

  it("does not clear a replacement session because an old request was rejected", async () => {
    setAuthToken("owner.old-token");
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = apiFetch("/auth/me");
    setAuthToken("owner.new-token");
    resolve(new Response("{}", { status: 401 }));
    await pending;
    expect(getAuthToken()).toBe("owner.new-token");
  });
});
