import { join } from "node:path";
import { artifactDirectory, ensurePreviewDependencies } from "./preview-dependencies.mjs";

let server;
try {
  await ensurePreviewDependencies();
  const { createServer } = await import("vite");
  server = await createServer({
    configFile: join(artifactDirectory, "vite.config.ts"),
    server: { host: "0.0.0.0" },
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      try { await server.close(); }
      finally { process.exit(0); }
    });
  }
  await server.listen();
  console.info("[Adventure Zone] Vite preview ready.");
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
} catch (error) {
  if (server) await server.close();
  console.error("[Adventure Zone] Preview startup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
