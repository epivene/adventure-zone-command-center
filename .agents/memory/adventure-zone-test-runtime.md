---
name: Adventure Zone test runtime
description: Node and jsdom compatibility constraint for the Adventure Zone Vitest environment.
---

The Adventure Zone Vitest jsdom environment must stay on the jsdom 29 line while this workspace runs Node 20.

**Why:** jsdom 30 resolves undici 8, whose worker implementation calls `worker_threads.markAsUncloneable`; that API is unavailable in Node 20, so Vitest fork workers fail before test files load.

**How to apply:** When upgrading jsdom, Vitest, or the workspace Node runtime, verify the worker startup command first. Move to jsdom 30 only after the runtime provides the required worker API.