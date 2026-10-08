import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const artifactDirectory = fileURLToPath(new URL("../", import.meta.url));
const runtimePackages = ["react-markdown", "remark-gfm"];
const previewPackages = [...runtimePackages, "vite"];

export function missingPreviewDependencies(artifactDir = artifactDirectory) {
  const manifestPath = join(artifactDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const name of runtimePackages) {
    if (!manifest.dependencies?.[name]) {
      throw new Error(`${name} must be declared in the CRM's runtime dependencies.`);
    }
  }
  if (!manifest.devDependencies?.vite && !manifest.dependencies?.vite) {
    throw new Error("Vite must be declared in the CRM's dependencies.");
  }
  const require = createRequire(manifestPath);
  return previewPackages.filter(name => {
    const localPackage = join(artifactDir, "node_modules", name);
    if (!existsSync(localPackage)) return true;
    try {
      // Do not accept a package accidentally resolved from another workspace.
      return !realpathSync(require.resolve(name)).startsWith(realpathSync(localPackage) + sep);
    } catch {
      return true;
    }
  });
}

function installLockedWorkspace({ command, args, cwd }) {
  return new Promise((resolveInstall, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    let interrupted = false;
    const interrupt = () => {
      interrupted = true;
      child.kill("SIGTERM");
    };
    const cleanup = () => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    child.once("error", error => { cleanup(); reject(error); });
    child.once("exit", (code, signal) => {
      cleanup();
      if (code === 0 && !interrupted) resolveInstall();
      else reject(new Error(`Locked dependency installation failed (${signal ?? code ?? "interrupted"}).`));
    });
  });
}

export async function ensurePreviewDependencies({
  artifactDir = artifactDirectory,
  workspaceDir = resolve(artifactDir, "../.."),
  runInstall = installLockedWorkspace,
  log = console.info,
} = {}) {
  const missing = missingPreviewDependencies(artifactDir);
  if (!missing.length) return { repaired: false };
  log(`[Adventure Zone] Missing preview dependencies: ${missing.join(", ")}. Restoring the frozen workspace installation.`);
  await runInstall({
    command: "pnpm",
    args: ["install", "--frozen-lockfile", "--prefer-offline"],
    cwd: workspaceDir,
  });
  const remaining = missingPreviewDependencies(artifactDir);
  if (remaining.length) throw new Error(`Preview dependencies are still missing: ${remaining.join(", ")}.`);
  return { repaired: true };
}
