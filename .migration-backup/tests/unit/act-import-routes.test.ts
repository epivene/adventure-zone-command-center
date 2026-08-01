import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner" })),
}));

vi.mock("@/features/import/act-matcher", () => ({
  previewActImport: vi.fn(async () => ({
    runId: "run-1",
    sourceFileName: "contacts.csv",
    rows: [],
    summary: { new: 0, change: 0, duplicate: 0, conflict: 0, error: 0 },
  })),
  applyActImport: vi.fn(async (runId: string) => ({
    runId,
    appliedRowIds: [],
    skippedRowIds: [],
    failedRows: [],
  })),
}));

import { POST as applyImport } from "@/app/api/import/act/apply/route";
import { POST as previewImport } from "@/app/api/import/act/preview/route";
import { requireOwner } from "@/lib/auth/require-owner";

beforeEach(() => {
  vi.mocked(requireOwner).mockResolvedValue({ userId: "owner" });
});

describe("Act import API", () => {
  it("requires owner authorization before reading a preview upload", async () => {
    vi.mocked(requireOwner).mockRejectedValueOnce(new Error("Not authorized"));
    const request = new Request("http://localhost/api/import/act/preview", {
      method: "POST",
      body: new FormData(),
    });

    await expect(previewImport(request)).rejects.toThrow("Not authorized");
  });

  it("rejects preview requests without a CSV file", async () => {
    const request = new Request("http://localhost/api/import/act/preview", {
      method: "POST",
      body: new FormData(),
    });

    const response = await previewImport(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose an Act! CSV file to preview.",
    });
  });

  it("rejects malformed apply payloads without starting an import", async () => {
    const request = new Request("http://localhost/api/import/act/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "", approvedRowIds: "row-2" }),
    });

    const response = await applyImport(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Choose a valid import run and approved rows.",
    });
  });
});
