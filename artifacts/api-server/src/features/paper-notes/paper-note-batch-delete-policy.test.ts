import { describe, expect, it } from "vitest";

import { isPaperNoteBatchDeletable } from "./paper-note-intake-repository";

describe("paper note batch delete policy", () => {
  it("allows batches that have not been imported, including review batches", () => {
    expect(isPaperNoteBatchDeletable("draft")).toBe(true);
    expect(isPaperNoteBatchDeletable("review")).toBe(true);
    expect(isPaperNoteBatchDeletable("failed")).toBe(true);
  });

  it("protects batches that are running or already completed/imported", () => {
    expect(isPaperNoteBatchDeletable("queued")).toBe(false);
    expect(isPaperNoteBatchDeletable("extracting")).toBe(false);
    expect(isPaperNoteBatchDeletable("importing")).toBe(false);
    expect(isPaperNoteBatchDeletable("imported")).toBe(false);
    expect(isPaperNoteBatchDeletable("archived")).toBe(false);
  });
});
