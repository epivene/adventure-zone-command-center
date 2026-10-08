// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const origin = "https://workspace.example";
const base = `${origin}/office/`;
const source = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

function worker() {
  const listeners = new Map<string, (event: any) => void>();
  const stored = new Map<string, Map<string, Response>>();
  const network = new Map<string, Response>();
  const requested: string[] = [];
  const intercepted: string[] = [];
  let offline = false;
  let evictOnWrite = "";
  const key = (input: string | { url: string }) => typeof input === "string" ? new URL(input, origin).href : input.url;
  const fetch = async (input: string | { url: string }) => {
    const url = key(input);
    requested.push(url);
    if (offline || !network.has(url)) throw new Error("Network unavailable");
    return network.get(url)!.clone();
  };
  const open = async (name: string) => {
    if (!stored.has(name)) stored.set(name, new Map());
    const entries = stored.get(name)!;
    return {
      match: async (input: string | { url: string }) => entries.get(key(input))?.clone(),
      put: async (input: string | { url: string }, value: Response) => { entries.set(key(input), value.clone()); if (key(input) === evictOnWrite) entries.delete(key(input)); },
      addAll: async (inputs: string[]) => { for (const input of inputs) entries.set(key(input), await fetch(input)); },
    };
  };
  const caches = {
    open,
    has: async (name: string) => stored.has(name),
    keys: async () => [...stored.keys()],
    delete: async (name: string) => stored.delete(name),
    match: async (input: string | { url: string }) => {
      for (const entries of stored.values()) if (entries.has(key(input))) return entries.get(key(input))!.clone();
    },
  };
  runInNewContext(source, {
    self: { registration: { scope: base }, location: new URL(`${base}sw.js`), clients: { claim: async () => {} }, skipWaiting() {}, addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener) },
    URL, Response, Request, Headers, fetch, caches, crypto: globalThis.crypto, console,
  });
  return {
    stored, network, requested, intercepted,
    disconnect() { offline = true; },
    evictDuringPreparation(path: string) { evictOnWrite = new URL(path, base).href; },
    publish(version = "one", assetUrl = "/office/assets/main-one.js") {
      const assets = ["/office/index.html", assetUrl, "/office/assets/main.css", "/office/assets/font.woff2"];
      const contents = [`<html>${version}</html>`, `console.log('${version}')`, "body {}", "font"];
      const types = ["text/html", "application/javascript", "text/css", "font/woff2"];
      const integrity: Record<string, string> = {};
      assets.forEach((url, index) => {
        integrity[url] = createHash("sha256").update(contents[index]!).digest("hex");
        network.set(`${origin}${url}`, new Response(contents[index], { headers: { "Content-Type": types[index]! } }));
      });
      network.set(`${base}offline-shell-manifest.json`, Response.json({ version, shell: "/office/index.html", assets, integrity }));
    },
    async lifecycle(type: string) {
      const pending: Promise<unknown>[] = [];
      listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
      await Promise.all(pending);
    },
    async message(type: string) {
      const replies: any[] = [];
      const pending: Promise<unknown>[] = [];
      listeners.get("message")?.({ data: { type }, ports: [{ postMessage: (value: unknown) => replies.push(value) }], waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
      await Promise.all(pending);
      return replies;
    },
    async request(path: string, mode = "navigate", destination = "document") {
      let response: Promise<Response> | undefined;
      listeners.get("fetch")?.({ request: { url: new URL(path, base).href, method: "GET", mode, destination, headers: new Headers() }, respondWith: (promise: Promise<Response>) => { intercepted.push(path); response = promise; } });
      return response;
    },
  };
}

describe("explicit production offline shell", () => {
  it("leaves Vite source modules outside production cache validation", async () => {
    const app = worker();
    for (const path of ["src/index.css", "src/mobile-compact.css", "@vite/client", "@fs/workspace/src/styles.css", "node_modules/.vite/deps/example.js"]) {
      expect(await app.request(path, "cors", "script")).toBeUndefined();
    }
    expect(app.intercepted).toEqual([]);
    expect(app.requested).toEqual([]);
  });

  it("does not cache anything during worker installation", async () => {
    const app = worker();
    app.publish();
    await app.lifecycle("install");
    expect(app.requested).toEqual([]);
    expect([...app.stored.values()].flatMap((cache) => [...cache.keys()])).toEqual([]);
  });

  it("shows a self-contained recovery page when reopened offline before preparation", async () => {
    const app = worker();
    await app.lifecycle("install");
    app.disconnect();
    const response = (await app.request("assistant/workspace/c1"))!;
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Offline workspace is not ready");
    expect(html).toContain("Prepare for offline");
    expect(html).toContain('href="https://workspace.example/office/assistant/workspace"');
    expect(html).not.toMatch(/<script|<link|<img/i);
    expect(app.stored.size).toBe(0);
  });

  it("reports ready only after every shell, script, stylesheet and font is stored", async () => {
    const app = worker();
    app.publish();
    expect(await app.message("OFFLINE_SHELL_STATUS")).toEqual([{ type: "ready", ready: false }]);
    const replies = await app.message("PREPARE_OFFLINE_SHELL");
    expect(replies).toContainEqual({ type: "progress", completed: 4, total: 4 });
    expect(replies.at(-1)).toEqual({ type: "complete" });
    expect(await app.message("OFFLINE_SHELL_STATUS")).toEqual([{ type: "ready", ready: true }]);
    app.disconnect();
    expect(await (await app.request("assistant/offline"))!.text()).toBe("<html>one</html>");
    expect(await (await app.request("assets/main-one.js", "cors", "script"))!.text()).toBe("console.log('one')");
    expect(await (await app.request("assets/font.woff2", "cors", "font"))!.text()).toBe("font");
  });

  it("retains a previously complete shell when a replacement download fails", async () => {
    const app = worker();
    app.publish();
    await app.message("PREPARE_OFFLINE_SHELL");
    app.publish("two", "/office/assets/main-two.js");
    app.network.delete(`${base}assets/main-two.js`);
    expect((await app.message("PREPARE_OFFLINE_SHELL")).at(-1)?.type).toBe("error");
    expect(await app.message("OFFLINE_SHELL_STATUS")).toEqual([{ type: "ready", ready: true }]);
    app.disconnect();
    expect(await (await app.request("assistant/offline"))!.text()).toBe("<html>one</html>");
    expect((await app.request("assets/main-two.js", "cors", "script"))!.type).toBe("error");
  });

  it("revokes readiness after a required file is evicted", async () => {
    const app = worker();
    app.publish();
    await app.message("PREPARE_OFFLINE_SHELL");
    for (const cache of app.stored.values()) cache.delete(`${base}assets/main.css`);
    expect(await app.message("OFFLINE_SHELL_STATUS")).toEqual([{ type: "ready", ready: false }]);
    app.disconnect();
    const recovery = (await app.request("assistant/offline"))!;
    expect(await recovery.text()).toContain("Offline workspace is not ready");
    expect((await app.request("assets/missing.js", "cors", "script"))!.type).toBe("error");
  });

  it("does not publish preparation when storage loses a file during the download", async () => {
    const app = worker();
    app.publish();
    app.evictDuringPreparation("assets/main.css");
    expect((await app.message("PREPARE_OFFLINE_SHELL")).at(-1)?.type).toBe("error");
    expect(await app.message("OFFLINE_SHELL_STATUS")).toEqual([{ type: "ready", ready: false }]);
  });

  it("rejects HTML returned for a script and never substitutes the navigation shell", async () => {
    const app = worker();
    app.publish();
    app.network.set(`${base}assets/main-one.js`, new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } }));
    expect((await app.message("PREPARE_OFFLINE_SHELL")).at(-1)?.type).toBe("error");
    expect(await app.message("OFFLINE_SHELL_STATUS")).toEqual([{ type: "ready", ready: false }]);
    expect((await app.request("assets/main-one.js", "cors", "script"))!.type).toBe("error");
  });

  it("rejects a shell from a different deployment even when every response has a valid MIME type", async () => {
    const app = worker();
    app.publish();
    app.network.set(`${base}index.html`, new Response("<html>another deployment</html>", { headers: { "Content-Type": "text/html" } }));
    expect((await app.message("PREPARE_OFFLINE_SHELL")).at(-1)?.type).toBe("error");
    expect(await app.message("OFFLINE_SHELL_STATUS")).toEqual([{ type: "ready", ready: false }]);
  });

  it("leaves authenticated API requests and cross-origin requests outside the shell cache", async () => {
    const app = worker();
    app.publish();
    await app.message("PREPARE_OFFLINE_SHELL");
    expect(await app.request("/api/assistant/conversations", "cors", "")).toBeUndefined();
    expect(await app.request("api/private.js", "cors", "script")).toBeUndefined();
    expect(await app.request("https://other.example/app.js", "cors", "script")).toBeUndefined();
    expect(await app.request("/outside/assistant/offline")).toBeUndefined();
    expect(app.intercepted).toEqual([]);
  });

  it("rejects manifests that include private or cross-origin resources", async () => {
    for (const unsafe of ["/office/api/private.js", "https://other.example/app.js", "/api/private", "/outside/main.js"]) {
      const app = worker();
      app.publish();
      app.network.set(`${base}offline-shell-manifest.json`, Response.json({ version: "bad", shell: "/office/index.html", assets: ["/office/index.html", unsafe], integrity: { "/office/index.html": "0".repeat(64), [unsafe]: "0".repeat(64) } }));
      expect((await app.message("PREPARE_OFFLINE_SHELL")).at(-1)?.type).toBe("error");
      expect(app.requested).toEqual([`${base}offline-shell-manifest.json`]);
    }
  });
});
