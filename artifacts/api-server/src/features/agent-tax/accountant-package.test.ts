import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import type { Pool } from "pg";
import type { PrivateObjectStorage } from "@/lib/private-object-storage";
import { MAX_PACKAGE_RECORDS, writeAccountantPackage, type PackageRecord } from "./accountant-package";
import { AgentTaxService } from "./service";

function record(): PackageRecord {
  const id = randomUUID();
  return { id, tax_year: 2026, date_text: "2026-01-01", entry_type: "expense", title: "Test",
    category: "other", amount_cents: 100, payment_method: "cash", counterparty: null, notes: null,
    booking_id: null, booking_label: null, revision: 1, storage_key: `agent-tax/${id}/${randomUUID()}`,
    file_name: "../../unsafe.pdf", file_mime: "application/pdf", file_size: 4 };
}
function sink() {
  const chunks: Buffer[] = [];
  return { chunks, writable: new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }) };
}

describe("bounded accountant ZIP streaming", () => {
  it("aborts rather than completing a ZIP when a receipt is missing, too large or truncated", async () => {
    for (const source of [
      () => Readable.from((async function* () { throw new Error("missing private receipt"); yield Buffer.alloc(0); })()),
      () => Readable.from([Buffer.alloc(5)]),
      () => Readable.from([Buffer.alloc(3)]),
    ]) {
      const storage = { openReadStream: source } as unknown as PrivateObjectStorage;
      const { chunks, writable } = sink();
      await expect(writeAccountantPackage([record()], 2026, storage, writable)).rejects.toThrow();
      const bytes = Buffer.concat(chunks);
      expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(false);
      expect(bytes.includes(Buffer.from("manifest.json"))).toBe(false);
      expect(writable.destroyed).toBe(true);
    }
  });
  it("opens only one receipt at a time and never uses buffered or signed reads", async () => {
    let active = 0, maximum = 0;
    const storage = {
      get: vi.fn(), getSignedReadUrl: vi.fn(),
      openReadStream: vi.fn(() => Readable.from((async function* () {
        active++; maximum = Math.max(maximum, active);
        try { yield Buffer.from("test"); } finally { active--; }
      })())),
    } as unknown as PrivateObjectStorage;
    const { writable } = sink();
    await writeAccountantPackage(Array.from({ length: 100 }, record), 2026, storage, writable);
    expect(maximum).toBe(1); expect(active).toBe(0);
    expect(storage.get).not.toHaveBeenCalled(); expect(storage.getSignedReadUrl).not.toHaveBeenCalled();
  });
  it("stops the storage stream after a client disconnect and releases the concurrent-export gate", async () => {
    let opened!: () => void;
    const started = new Promise<void>(resolve => { opened = resolve; });
    const source = new Readable({ read() { opened(); } });
    const storage = { openReadStream: vi.fn(() => source) } as unknown as PrivateObjectStorage;
    const query = vi.fn().mockResolvedValue({ rows: [record()] });
    const service = new AgentTaxService({ query } as unknown as Pool, storage, true);
    const { writable } = sink();
    const download = service.accountantPackage(2026, writable);
    // Attach rejection handler before destroying the client.
    const failed = expect(download).rejects.toThrow();
    await started;
    await expect(service.accountantPackage(2026, sink().writable)).rejects.toMatchObject({ status: 429 });
    writable.destroy(new Error("client disconnected"));
    await failed;
    expect(source.destroyed).toBe(true);
    query.mockResolvedValue({ rows: [] });
    await service.accountantPackage(2026, sink().writable);
  });
  it("applies an explicit metadata bound before opening files or writing any bytes", async () => {
    const query = vi.fn().mockResolvedValue({ rows: Array.from({ length: MAX_PACKAGE_RECORDS + 1 }, record) });
    const storage = { openReadStream: vi.fn() } as unknown as PrivateObjectStorage;
    const service = new AgentTaxService({ query } as unknown as Pool, storage, true);
    const { chunks, writable } = sink();
    await expect(service.accountantPackage(2026, writable)).rejects.toMatchObject({ status: 413 });
    expect(query.mock.calls[0][1]).toEqual([2026, MAX_PACKAGE_RECORDS + 1]);
    expect(chunks).toEqual([]); expect(storage.openReadStream).not.toHaveBeenCalled();
    writable.destroy();
  });
});
