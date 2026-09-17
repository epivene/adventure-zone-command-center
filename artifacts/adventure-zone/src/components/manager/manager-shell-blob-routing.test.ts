import { describe, expect, it } from "vitest";

import type { ManagerMutation } from "@/lib/manager-offline-db";
import type { ManagerBlobRow } from "@/lib/manager-blob-queue";
import {
  findManagerBlobMutation,
  managerBlobMetadataMatches,
  managerBlobUploadPath,
} from "./manager-shell";

const row: ManagerBlobRow = {
  id: "40000000-0000-4000-8000-000000000001",
  legId: "30000000-0000-4000-8000-000000000001",
  receiptId: "40000000-0000-4000-8000-000000000001",
  kind: "year_end_inspection_photo",
  inspectionId: "10000000-0000-4000-8000-000000000001",
  entryId: "20000000-0000-4000-8000-000000000001",
  photoId: "40000000-0000-4000-8000-000000000001",
  blob: new Blob(["photo"], { type: "image/jpeg" }),
  createdAt: "2026-09-17T00:00:00.000Z",
  state: "image_pending",
};

const mutation: ManagerMutation = {
  id: "50000000-0000-4000-8000-000000000001",
  legId: row.legId,
  method: "POST",
  path: `/manager/year-end-inspections/${row.inspectionId}/photos`,
  body: {
    id: row.photoId,
    clientMutationId: "50000000-0000-4000-8000-000000000001",
    entryId: row.entryId,
  },
  createdAt: row.createdAt,
  state: "synced",
};

describe("manager shell blob routing", () => {
  it("recovers a legacy queued inspection photo by matching its photo id", () => {
    expect(findManagerBlobMutation(row, [mutation])).toBe(mutation);
  });

  it("routes a queued inspection photo to its inspection image endpoint", () => {
    expect(managerBlobUploadPath(row, "year_end_inspection_photo")).toBe(
      `/manager/year-end-inspections/${row.inspectionId}/photos/${row.photoId}/image`,
    );
  });

  it("waits for the matching inspection photo metadata to sync", () => {
    expect(managerBlobMetadataMatches(row, mutation)).toBe(true);
    expect(managerBlobMetadataMatches(row, { ...mutation, state: "saved_offline" })).toBe(false);
  });
});
