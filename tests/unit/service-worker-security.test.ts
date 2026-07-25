import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

type WorkerEvent = {
  request?: {
    destination: string;
    method: string;
    mode: string;
    url: string;
  };
  respondWith?: (response: Promise<Response>) => void;
  waitUntil?: (work: Promise<unknown>) => void;
};

function loadServiceWorker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const added: string[][] = [];
  const stored: string[] = [];
  const cache = {
    addAll: vi.fn(async (urls: string[]) => {
      added.push(urls);
    }),
    match: vi.fn(async () => undefined),
    put: vi.fn(async (request: { url: string }) => {
      stored.push(request.url);
    }),
  };
  const caches = {
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => ["azcc-shell-old"]),
    match: vi.fn(async () => undefined),
    open: vi.fn(async () => cache),
  };
  const fetch = vi.fn(async () => new Response("network"));
  const self = {
    addEventListener: (
      type: string,
      listener: (event: WorkerEvent) => void,
    ) => listeners.set(type, listener),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: "https://command-center.test" },
    skipWaiting: vi.fn(async () => undefined),
  };

  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL,
    caches,
    fetch,
    self,
  });

  return { added, cache, caches, fetch, listeners, stored };
}

async function dispatchInstall(worker: ReturnType<typeof loadServiceWorker>) {
  let work: Promise<unknown> | undefined;
  worker.listeners.get("install")?.({
    waitUntil: (promise) => {
      work = promise;
    },
  });
  await work;
}

async function dispatchFetch(
  worker: ReturnType<typeof loadServiceWorker>,
  request: NonNullable<WorkerEvent["request"]>,
) {
  let response: Promise<Response> | undefined;
  worker.listeners.get("fetch")?.({
    request,
    respondWith: (promise) => {
      response = promise;
    },
  });
  await response;
}

describe("service worker cache boundary", () => {
  it("pre-caches only public manifest and icon assets", async () => {
    const worker = loadServiceWorker();

    await dispatchInstall(worker);

    expect(worker.added).toEqual([
      [
        "/manifest.webmanifest",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
      ],
    ]);
  });

  it("never intercepts private API or document requests", async () => {
    const worker = loadServiceWorker();

    await dispatchFetch(worker, {
      destination: "",
      method: "GET",
      mode: "cors",
      url: "https://command-center.test/api/bookings?include=contacts,notes",
    });
    await dispatchFetch(worker, {
      destination: "document",
      method: "GET",
      mode: "navigate",
      url: "https://command-center.test/bookings/booking-1",
    });

    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.stored).toEqual([]);
  });

  it("caches same-origin framework static assets after a successful response", async () => {
    const worker = loadServiceWorker();

    await dispatchFetch(worker, {
      destination: "script",
      method: "GET",
      mode: "cors",
      url: "https://command-center.test/_next/static/chunks/app.js",
    });

    expect(worker.fetch).toHaveBeenCalledOnce();
    expect(worker.stored).toEqual([
      "https://command-center.test/_next/static/chunks/app.js",
    ]);
  });

  it("does not cache auth responses even when they look like static resources", async () => {
    const worker = loadServiceWorker();

    await dispatchFetch(worker, {
      destination: "script",
      method: "GET",
      mode: "cors",
      url: "https://command-center.test/sign-in/session.js",
    });

    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.stored).toEqual([]);
  });
});
