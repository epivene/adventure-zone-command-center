import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensurePreviewDependencies, missingPreviewDependencies } from "./preview-dependencies.mjs";

function fixture(t) {
  const workspaceDir = mkdtempSync(join(tmpdir(), "az-preview-dependencies-"));
  const artifactDir = join(workspaceDir, "artifacts", "crm");
  mkdirSync(artifactDir, { recursive: true });
  const manifest = {
    dependencies: { "react-markdown": "^10.1.0", "remark-gfm": "^4.0.1" },
    devDependencies: { vite: "catalog:" },
  };
  writeFileSync(join(artifactDir, "package.json"), JSON.stringify(manifest));
  t.after(() => rmSync(workspaceDir, { recursive: true, force: true }));
  function install(name, root = artifactDir) {
    const directory = join(root, "node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name, main: "index.js" }));
    writeFileSync(join(directory, "index.js"), "module.exports = {};");
  }
  return { workspaceDir, artifactDir, manifest, install };
}

test("a complete local installation starts without reinstalling", async t => {
  const f = fixture(t);
  ["react-markdown", "remark-gfm", "vite"].forEach(name => f.install(name));
  assert.deepEqual(missingPreviewDependencies(f.artifactDir), []);
  const result = await ensurePreviewDependencies({ ...f, runInstall: () => assert.fail("unnecessary install") });
  assert.deepEqual(result, { repaired: false });
});

test("missing renderer packages are restored using the frozen workspace lockfile", async t => {
  const f = fixture(t);
  f.install("vite");
  let calls = 0;
  const options = {
    ...f, log() {},
    runInstall(command) {
      calls++;
      assert.deepEqual(command, {
        command: "pnpm", args: ["install", "--frozen-lockfile", "--prefer-offline"], cwd: f.workspaceDir,
      });
      f.install("react-markdown");
      f.install("remark-gfm");
    },
  };
  assert.deepEqual(await ensurePreviewDependencies(options), { repaired: true });
  assert.deepEqual(await ensurePreviewDependencies(options), { repaired: false });
  assert.equal(calls, 1);
});

test("packages resolved only from the workspace root do not hide missing artifact links", t => {
  const f = fixture(t);
  ["react-markdown", "remark-gfm", "vite"].forEach(name => f.install(name, f.workspaceDir));
  assert.deepEqual(missingPreviewDependencies(f.artifactDir), ["react-markdown", "remark-gfm", "vite"]);
});

test("dangling package links are detected", t => {
  const f = fixture(t);
  f.install("react-markdown");
  f.install("vite");
  symlinkSync(join(f.workspaceDir, "absent"), join(f.artifactDir, "node_modules", "remark-gfm"));
  assert.deepEqual(missingPreviewDependencies(f.artifactDir), ["remark-gfm"]);
});

test("an install failure stops startup instead of dropping Markdown rendering", async t => {
  const f = fixture(t);
  await assert.rejects(ensurePreviewDependencies({
    ...f, log() {}, runInstall() { throw new Error("installation failed"); },
  }), /installation failed/);
});

test("an incomplete repair is rejected before Vite starts", async t => {
  const f = fixture(t);
  await assert.rejects(ensurePreviewDependencies({ ...f, log() {}, runInstall() {} }), /still missing: react-markdown, remark-gfm, vite/);
});

test("missing runtime declarations fail explicitly without installing untracked packages", async t => {
  const f = fixture(t);
  delete f.manifest.dependencies["remark-gfm"];
  writeFileSync(join(f.artifactDir, "package.json"), JSON.stringify(f.manifest));
  await assert.rejects(ensurePreviewDependencies({ ...f, runInstall: () => assert.fail("must not install") }), /remark-gfm must be declared/);
});
