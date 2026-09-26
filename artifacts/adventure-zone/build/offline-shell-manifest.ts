import { createHash } from "node:crypto";
import type { Plugin } from "vite";

type BuildFile = { fileName: string; source: string | Uint8Array };
const staticFile = /\.(?:m?js|css|woff2?|ttf|otf|eot|png|jpe?g|svg|gif|webp|avif|ico|wasm)$/i;

export function createOfflineShellManifest(files: BuildFile[], configuredBase: string) {
  if (!configuredBase.startsWith("/") || configuredBase.startsWith("//")) {
    throw new Error("The offline workspace requires a same-origin absolute Vite base path.");
  }
  const base = configuredBase.replace(/\/?$/, "/");
  const included = files.filter((file) => file.fileName === "index.html" || staticFile.test(file.fileName))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "en"));
  if (!included.some((file) => file.fileName === "index.html")) throw new Error("The offline build requires index.html.");
  const hash = createHash("sha256").update(base);
  for (const file of included) hash.update(file.fileName).update("\0").update(file.source).update("\0");
  return {
    version: hash.digest("hex").slice(0, 32),
    shell: `${base}index.html`,
    assets: included.map((file) => `${base}${file.fileName}`),
    integrity: Object.fromEntries(included.map((file) => [
      `${base}${file.fileName}`, createHash("sha256").update(file.source).digest("hex"),
    ])),
  };
}

export function offlineShellManifest(): Plugin {
  let base = "/";
  return {
    name: "adventure-zone-offline-shell-manifest",
    apply: "build",
    enforce: "post",
    configResolved(config) { base = config.base; },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const files = Object.values(bundle).map((file) => ({
          fileName: file.fileName,
          source: file.type === "chunk" ? file.code : file.source,
        }));
        this.emitFile({
          type: "asset",
          fileName: "offline-shell-manifest.json",
          source: JSON.stringify(createOfflineShellManifest(files, base)),
        });
      },
    },
  };
}
