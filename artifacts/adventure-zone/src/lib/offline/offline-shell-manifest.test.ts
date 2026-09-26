// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createOfflineShellManifest } from "../../../build/offline-shell-manifest";

const files = [
  { fileName: "index.html", source: "<script src='/office/assets/main.js'></script>" },
  { fileName: "assets/main.js", source: "import('./offline-lazy.js')" },
  { fileName: "assets/offline-lazy.js", source: "export default 'offline workspace'" },
  { fileName: "assets/main.css", source: "@font-face { src: url('./local.woff2') }" },
  { fileName: "assets/local.woff2", source: new Uint8Array([1, 2, 3]) },
  { fileName: "assets/main.js.map", source: "private source map" },
];

describe("production offline manifest", () => {
  it("includes the shell and every emitted static dependency, including lazy chunks and fonts", () => {
    const manifest = createOfflineShellManifest(files, "/office/");
    expect(manifest.shell).toBe("/office/index.html");
    expect(manifest.assets).toEqual([
      "/office/assets/local.woff2",
      "/office/assets/main.css",
      "/office/assets/main.js",
      "/office/assets/offline-lazy.js",
      "/office/index.html",
    ]);
  });

  it("changes the build version when same-named shell content changes", () => {
    const original = createOfflineShellManifest(files, "/");
    const replacement = createOfflineShellManifest([{ fileName: "index.html", source: "new shell" }, ...files.slice(1)], "/");
    expect(replacement.version).not.toBe(original.version);
    expect(createOfflineShellManifest([...files].reverse(), "/").version).toBe(original.version);
  });

  it("provides content hashes so a mixed deployment cannot be marked ready", () => {
    const manifest = createOfflineShellManifest([{ fileName: "index.html", source: "abc" }, ...files.slice(1)], "/office/");
    expect(manifest.integrity?.["/office/index.html"]).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(Object.keys(manifest.integrity).sort()).toEqual([...manifest.assets].sort());
  });

  it("rejects a build without an HTML entry or with a cross-origin base", () => {
    expect(() => createOfflineShellManifest(files.slice(1), "/")).toThrow();
    expect(() => createOfflineShellManifest(files, "https://cdn.example/")).toThrow();
  });
});
