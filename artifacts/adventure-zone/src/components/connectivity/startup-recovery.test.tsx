import { lazy, Suspense } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartupRecovery } from "./startup-recovery";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  localStorage.clear();
});

describe("startup recovery", () => {
  it("keeps recovery controls visible after an offline lazy chunk rejects, without changing saved data", async () => {
    vi.stubEnv("BASE_URL", "/office/");
    window.history.replaceState({}, "", "/office/assistant/workspace/conversation-one?view=draft#draft-one");
    localStorage.setItem("az_owner_token", "retained-session");
    const savedData = vi.spyOn(Storage.prototype, "removeItem");
    const clearData = vi.spyOn(Storage.prototype, "clear");
    // React reports the intentionally rejected chunk; the assertion is on recovery UI.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const UnavailablePage = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));

    render(<StartupRecovery><Suspense fallback={<p>Opening page…</p>}><UnavailablePage /></Suspense></StartupRecovery>);

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open saved offline workspace" })).toHaveAttribute("href", "/office/assistant/offline");
    const retry = screen.getByRole("button", { name: "Try again" });
    const browserWindow = window;
    const reload = vi.fn();
    // jsdom's native Location.reload is non-configurable and cannot navigate.
    // Replace only this browser boundary; the rendered recovery and click are real.
    vi.stubGlobal("window", new Proxy(browserWindow, {
      get(target, key, receiver) {
        return key === "location"
          ? { href: browserWindow.location.href, reload }
          : Reflect.get(target, key, receiver);
      },
    }));
    fireEvent.click(retry);
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem("az_owner_token")).toBe("retained-session");
    expect(savedData).not.toHaveBeenCalled();
    expect(clearData).not.toHaveBeenCalled();
  });
});
