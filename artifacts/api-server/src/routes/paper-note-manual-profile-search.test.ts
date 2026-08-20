import { describe, expect, it, vi } from "vitest";

import { createPaperNoteManualProfileSearchRouter } from "./paper-note-manual-profile-search";

describe("paper note manual profile search route", () => {
  it("creates a router around the bounded search service", () => {
    const search = vi.fn();
    const router = createPaperNoteManualProfileSearchRouter({ search });
    expect(router).toBeTruthy();
  });
});
