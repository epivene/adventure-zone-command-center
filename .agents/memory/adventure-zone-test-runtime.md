---
name: Adventure Zone test runtime
description: Node and jsdom compatibility constraint for the Adventure Zone Vitest environment.
---

The Adventure Zone Vitest jsdom environment must stay on the jsdom 29 line while this workspace runs Node 20.

**Why:** jsdom 30 resolves undici 8, whose worker implementation calls `worker_threads.markAsUncloneable`; that API is unavailable in Node 20, so Vitest fork workers fail before test files load.

**How to apply:** When upgrading jsdom, Vitest, or the workspace Node runtime, verify the worker startup command first. Move to jsdom 30 only after the runtime provides the required worker API.

Verify PDF extraction against actual PDF bytes in the workflow's runtime, not only the Node version reported by pnpm.

**Why:** pnpm can report Node 24 while its child commands run Node 20. PDF.js uses `Promise.withResolvers`, which Node 20 does not provide, so installation and compilation can pass while extraction fails.

**How to apply:** Preserve compatible standard-API support on Node 20 and test a real document whenever changing PDF.js or the Node toolchain.

For targeted Vitest runs, pass test paths directly via `pnpm --filter <package> exec vitest run ...`, without a standalone `--` separator.

**Why:** A standalone separator forwarded by the package script made Vitest ignore the intended file filters and run the whole suite.

**How to apply:** Use explicit test paths after Vitest options when verifying a focused change.