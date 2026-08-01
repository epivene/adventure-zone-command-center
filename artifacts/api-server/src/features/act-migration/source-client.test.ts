/**
 * Unit tests for HttpActMigrationSourceClient.
 *
 * Covers:
 * - Stable $orderby applied in both projected and plain mode
 * - Projected→plain fallback via empty first page
 * - Projected→plain fallback via HTTP error (endpoint rejects $select/$expand)
 * - Normal pagination: items returned with correct nextSkip
 * - Plain-mode requests: correct nextSkip, no second fallback loop
 */

import { describe, expect, it, vi } from "vitest";
import { HttpActMigrationSourceClient } from "@/features/act-migration/source-client";
import { ActApiError } from "@/features/act-sync/act-errors";
import type { ActTransport } from "@/features/act-sync/act-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTransport(
  handler: (input: { path: string; query: Record<string, string> }) => unknown,
): ActTransport {
  return {
    requestJson: vi.fn().mockImplementation(handler),
  } as unknown as ActTransport;
}

/** Return an OData-wrapped page. */
function odataPage(items: unknown[]) {
  return { value: items };
}

const PROJECTED: { skip: number; top: number; queryMode: "projected" } = {
  skip: 0, top: 10, queryMode: "projected",
};
const PLAIN: { skip: number; top: number; queryMode: "plain" } = {
  skip: 0, top: 10, queryMode: "plain",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HttpActMigrationSourceClient", () => {
  describe("$orderby stability", () => {
    it("includes $orderby=id in projected mode", async () => {
      const transport = makeTransport(() => odataPage([{ id: "1" }]));
      const client = new HttpActMigrationSourceClient(transport);

      await client.listNotes(PROJECTED);

      const { query } = vi.mocked(transport.requestJson).mock.calls[0]![0]!;
      expect(query?.["$orderby"]).toBe("id");
    });

    it("includes $orderby=id in plain mode", async () => {
      const transport = makeTransport(() => odataPage([{ id: "1" }]));
      const client = new HttpActMigrationSourceClient(transport);

      await client.listNotes(PLAIN);

      const { query } = vi.mocked(transport.requestJson).mock.calls[0]![0]!;
      expect(query?.["$orderby"]).toBe("id");
    });

    it("does not include $select/$expand in plain mode", async () => {
      const transport = makeTransport(() => odataPage([]));
      const client = new HttpActMigrationSourceClient(transport);

      await client.listNotes(PLAIN);

      const { query } = vi.mocked(transport.requestJson).mock.calls[0]![0]!;
      expect(query?.["$select"]).toBeUndefined();
      expect(query?.["$expand"]).toBeUndefined();
    });

    it("includes $select and $expand in projected mode", async () => {
      const transport = makeTransport(() => odataPage([{ id: "1" }]));
      const client = new HttpActMigrationSourceClient(transport);

      await client.listNotes(PROJECTED);

      const { query } = vi.mocked(transport.requestJson).mock.calls[0]![0]!;
      expect(query?.["$select"]).toBeDefined();
      expect(query?.["$expand"]).toBeDefined();
    });
  });

  describe("projected→plain fallback via empty first page", () => {
    it("returns queryMode='plain' with nextSkip=0 when projected first page is empty", async () => {
      const transport = makeTransport(() => odataPage([]));
      const client = new HttpActMigrationSourceClient(transport);

      const page = await client.listNotes(PROJECTED);

      expect(page.queryMode).toBe("plain");
      expect(page.nextSkip).toBe(0);
      expect(page.items).toHaveLength(0);
    });

    it("does NOT trigger fallback on non-first empty pages (skip > 0)", async () => {
      const transport = makeTransport(() => odataPage([]));
      const client = new HttpActMigrationSourceClient(transport);

      const page = await client.listNotes({ skip: 100, top: 10, queryMode: "projected" });

      // Not a fallback — just end of stream
      expect(page.queryMode).toBe("projected");
      expect(page.nextSkip).toBeNull();
    });
  });

  describe("projected→plain fallback via HTTP error", () => {
    it("returns queryMode='plain' when projected request throws an ActApiError", async () => {
      let callCount = 0;
      const transport = makeTransport(() => {
        callCount++;
        throw new ActApiError("unavailable", false);
      });
      const client = new HttpActMigrationSourceClient(transport);

      const page = await client.listNotes(PROJECTED);

      expect(callCount).toBe(1);
      expect(page.queryMode).toBe("plain");
      expect(page.nextSkip).toBe(0);
      expect(page.items).toHaveLength(0);
    });

    it("re-throws errors from non-first projected pages (partial import failure is explicit)", async () => {
      const transport = makeTransport(() => {
        throw new ActApiError("unavailable", false);
      });
      const client = new HttpActMigrationSourceClient(transport);

      await expect(
        client.listNotes({ skip: 100, top: 10, queryMode: "projected" }),
      ).rejects.toThrow(ActApiError);
    });

    it("re-throws errors from plain-mode requests (no double-fallback)", async () => {
      const transport = makeTransport(() => {
        throw new ActApiError("unavailable", false);
      });
      const client = new HttpActMigrationSourceClient(transport);

      await expect(client.listNotes(PLAIN)).rejects.toThrow(ActApiError);
    });
  });

  describe("pagination", () => {
    it("computes nextSkip as skip + items.length when page is non-empty", async () => {
      const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
      const transport = makeTransport(() => odataPage(items));
      const client = new HttpActMigrationSourceClient(transport);

      const page = await client.listNotes({ skip: 20, top: 10, queryMode: "projected" });

      expect(page.nextSkip).toBe(23); // 20 + 3
      expect(page.items).toHaveLength(3);
    });

    it("returns nextSkip=null when page is empty (end of stream, plain mode)", async () => {
      const transport = makeTransport(() => odataPage([]));
      const client = new HttpActMigrationSourceClient(transport);

      const page = await client.listNotes({ skip: 50, top: 10, queryMode: "plain" });

      expect(page.nextSkip).toBeNull();
    });

    it("returns items from an array-valued OData response", async () => {
      const transport = makeTransport(() => odataPage([{ id: "x" }]));
      const client = new HttpActMigrationSourceClient(transport);

      const page = await client.listNotes(PLAIN);

      expect(page.items).toEqual([{ id: "x" }]);
    });

    it("returns items from a top-level array response (non-OData)", async () => {
      const transport = makeTransport(() => [{ id: "y" }]);
      const client = new HttpActMigrationSourceClient(transport);

      const page = await client.listNotes(PLAIN);

      expect(page.items).toEqual([{ id: "y" }]);
    });
  });
});
