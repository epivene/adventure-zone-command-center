// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareOfflineShell, isOfflineShellReady } from "./workspace-shell";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function browser({ ready = false, failure = "", registered = true } = {}) {
  const registrations: Array<{ url: string; scope: string }> = [];
  const active = {
    state: "activated",
    postMessage(message: { type: string }, ports: MessagePort[]) {
      const port = ports[0]!;
      if (message.type === "OFFLINE_SHELL_STATUS") port.postMessage({ type: "ready", ready });
      else if (message.type === "PREPARE_OFFLINE_SHELL") {
        port.postMessage({ type: "progress", completed: 1, total: 3 });
        port.postMessage(failure ? { type: "error", error: failure } : { type: "complete" });
      } else throw new Error("Unexpected shell command");
    },
  };
  const registration = { scope: "https://workspace.example/office/", active, installing: null, waiting: null };
  vi.stubEnv("BASE_URL", "/office/");
  vi.stubGlobal("window", { location: { origin: "https://workspace.example" } });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: async (url: string, options: { scope: string }) => { registrations.push({ url, scope: options.scope }); return registration; },
      getRegistration: async () => registered ? registration : undefined,
    },
  });
  return registrations;
}

describe("offline shell client", () => {
  it("uses the configured base and forwards preparation progress before completion", async () => {
    const registrations = browser();
    const progress: number[][] = [];
    await prepareOfflineShell((done, total) => progress.push([done, total]));
    expect(registrations).toEqual([{ url: "/office/sw.js", scope: "/office/" }]);
    expect(progress).toEqual([[1, 3]]);
  });

  it("rejects preparation when the worker cannot store the complete build", async () => {
    browser({ failure: "Storage quota exceeded" });
    await expect(prepareOfflineShell()).rejects.toThrow("Storage quota exceeded");
  });

  it("requires confirmed cache readiness rather than an installed worker", async () => {
    browser({ ready: false });
    expect(await isOfflineShellReady()).toBe(false);
    browser({ ready: true });
    expect(await isOfflineShellReady()).toBe(true);
  });

  it("does not create a worker during a readiness check", async () => {
    const registrations = browser({ registered: false });
    expect(await isOfflineShellReady()).toBe(false);
    expect(registrations).toEqual([]);
  });

  it("reports unsupported browsers as unavailable and rejects preparation", async () => {
    vi.stubGlobal("navigator", {});
    expect(await isOfflineShellReady()).toBe(false);
    await expect(prepareOfflineShell()).rejects.toThrow(/not supported/i);
  });
});
