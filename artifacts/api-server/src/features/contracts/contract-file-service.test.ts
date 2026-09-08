import { describe, expect, it } from "vitest";

import {
  ContractFileService,
  ContractFileServiceError,
  type ContractFileMetadataStore,
  type ContractFileRecord,
} from "./contract-file-service";

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const pdf = new TextEncoder().encode("%PDF-1.7\ncontract");

class MemoryMetadataStore implements ContractFileMetadataStore {
  records: ContractFileRecord[] = [];
  failInsert = false;

  async versionContext(versionId: string) {
    return versionId === VERSION_ID ? { organizationId: ORGANIZATION_ID } : null;
  }
  async findByChecksum(contractVersionId: string, sha256Hex: string) {
    return this.records.find((record) => record.contractVersionId === contractVersionId && record.sha256Hex === sha256Hex) ?? null;
  }
  async nextRevision(contractVersionId: string, kind: ContractFileRecord["kind"]) {
    return 1 + Math.max(0, ...this.records.filter((record) => record.contractVersionId === contractVersionId && record.kind === kind).map((record) => record.revision));
  }
  async insert(input: Omit<ContractFileRecord, "id">) {
    if (this.failInsert) throw new Error("metadata unavailable");
    const record = { ...input, id: `file-${this.records.length + 1}` };
    this.records.push(record);
    return record;
  }
  async get(contractVersionId: string, fileId: string) {
    return this.records.find((record) => record.id === fileId && record.contractVersionId === contractVersionId) ?? null;
  }
}

class MemoryObjectStorage {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  signedRequests: Array<{ key: string; expiresInSeconds?: number }> = [];
  deleted: string[] = [];

  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType });
  }
  async getSignedReadUrl(key: string, expiresInSeconds?: number) {
    this.signedRequests.push({ key, expiresInSeconds });
    return `https://private.example/${key}`;
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

function setup() {
  const metadata = new MemoryMetadataStore();
  const storage = new MemoryObjectStorage();
  const service = new ContractFileService(metadata, storage, () => new Date("2026-09-08T18:00:00.000Z"));
  return { metadata, storage, service };
}

describe("ContractFileService", () => {
  it("stores generated PDFs under an organization/version/checksum key", async () => {
    const { metadata, storage, service } = setup();
    const record = await service.storeGenerated({ contractVersionId: VERSION_ID, bytes: pdf, actorId: "owner" });
    expect(record).toMatchObject({ kind: "unsigned_generated", revision: 1, mimeType: "application/pdf", originalFilename: "contract-unsigned.pdf" });
    expect(record.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(record.storageKey).toBe(`contracts/${ORGANIZATION_ID}/${VERSION_ID}/unsigned_generated/1-${record.sha256Hex}.pdf`);
    expect(storage.objects.get(record.storageKey)).toEqual({ bytes: pdf, contentType: "application/pdf" });
    expect(metadata.records).toHaveLength(1);
  });

  it("increments signed revisions and reuses a duplicate checksum", async () => {
    const { metadata, storage, service } = setup();
    const first = await service.storeSigned({ contractVersionId: VERSION_ID, bytes: pdf, mimeType: "application/pdf", originalFilename: "signed-one.pdf", actorId: "owner" });
    const duplicate = await service.storeSigned({ contractVersionId: VERSION_ID, bytes: pdf, mimeType: "application/pdf", originalFilename: "renamed.pdf", actorId: "owner" });
    const second = await service.storeSigned({ contractVersionId: VERSION_ID, bytes: new TextEncoder().encode("%PDF-1.7\nchanged"), mimeType: "application/pdf", originalFilename: "signed-two.pdf", actorId: "owner" });
    expect(duplicate).toEqual(first);
    expect(second.revision).toBe(2);
    expect(metadata.records).toHaveLength(2);
    expect(storage.objects).toHaveLength(2);
  });

  it("rejects non-PDF MIME types, invalid headers, oversized files, and unknown versions", async () => {
    const { service } = setup();
    await expect(service.storeSigned({ contractVersionId: VERSION_ID, bytes: pdf, mimeType: "text/plain", originalFilename: "bad.txt", actorId: "owner" })).rejects.toMatchObject({ code: "CONTRACT_FILE_MIME_INVALID" });
    await expect(service.storeSigned({ contractVersionId: VERSION_ID, bytes: new TextEncoder().encode("not a pdf"), mimeType: "application/pdf", originalFilename: "bad.pdf", actorId: "owner" })).rejects.toMatchObject({ code: "CONTRACT_FILE_CONTENT_INVALID" });
    await expect(service.storeSigned({ contractVersionId: VERSION_ID, bytes: new Uint8Array((20 * 1024 * 1024) + 1), mimeType: "application/pdf", originalFilename: "large.pdf", actorId: "owner" })).rejects.toMatchObject({ code: "CONTRACT_FILE_TOO_LARGE" });
    await expect(service.storeGenerated({ contractVersionId: "missing", bytes: pdf, actorId: "owner" })).rejects.toMatchObject({ code: "CONTRACT_VERSION_NOT_FOUND" });
  });

  it("deletes a newly stored object when metadata insertion fails", async () => {
    const { metadata, storage, service } = setup();
    metadata.failInsert = true;
    await expect(service.storeGenerated({ contractVersionId: VERSION_ID, bytes: pdf, actorId: "owner" })).rejects.toThrow("metadata unavailable");
    expect(storage.objects).toHaveLength(0);
    expect(storage.deleted).toHaveLength(1);
  });

  it("opens only a file owned by the version with a five-minute URL", async () => {
    const { storage, service } = setup();
    const record = await service.storeGenerated({ contractVersionId: VERSION_ID, bytes: pdf, actorId: "owner" });
    await expect(service.open({ contractVersionId: "wrong", fileId: record.id })).rejects.toMatchObject({ code: "CONTRACT_FILE_NOT_FOUND" });
    expect(await service.open({ contractVersionId: VERSION_ID, fileId: record.id })).toBe(`https://private.example/${record.storageKey}`);
    expect(storage.signedRequests).toEqual([{ key: record.storageKey, expiresInSeconds: 300 }]);
  });

  it("uses typed service errors", () => {
    expect(new ContractFileServiceError("TEST", "message")).toMatchObject({ code: "TEST", message: "message" });
  });
});
