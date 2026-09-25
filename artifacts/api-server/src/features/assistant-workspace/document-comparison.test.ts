import { it, expect, vi } from "vitest";
import { compareDocuments } from "./document-comparison";
import { emptySelection } from "./contracts";
const ctx: any = {
  actor: { id: "owner", role: "owner" },
  selection: { ...emptySelection(), organizationIds: ["org"] },
  signal: new AbortController().signal,
};
const source = (id: string, partial = false) => ({
  status: partial ? "partial" : "ok",
  data: {
    totalPages: partial ? 1 : 3,
    missingPages: partial ? [1] : [],
    pages: [{ page: 1, text: "Invoice $7,650; deposit $3,825; printed name" }],
  },
  evidence: [
    {
      id,
      kind: "document",
      recordId: id,
      eventYear: 2027,
      version: "sha",
      complete: !partial,
      text: "Invoice is not a payment receipt",
    },
  ],
  receipts: [],
  code: null,
});
it("preserves per-document incompleteness and never confirms payment/signature/coverage", async () => {
  const reader = {
    read: vi.fn(async (_c, s) => source(s.documentId, s.documentId === "scan")),
  };
  const out = await compareDocuments(
    ctx,
    [
      { documentId: "text", expectedVersion: null },
      { documentId: "scan", expectedVersion: null },
    ],
    reader as any,
    async (id) => ({
      id,
      title: id,
      category: id === "scan" ? "coi" : "contract",
      organizationIds: ["org"],
      eventYear: 2027,
    }),
  );
  expect(out.status).toBe("partial");
  expect((out.data as any).sources[1]).toMatchObject({
    complete: false,
    missingPages: [1],
  });
  expect((out.data as any).assertions).toEqual({
    contractExecution: "unverified",
    paymentReceived: "unverified",
    currentInsurance: "unverified",
  });
  expect(out.receipts).toEqual([]);
});
it("blocks a changed source revision and sources outside the selected customer set", async () => {
  const reader = { read: async (_c: any, s: any) => source(s.documentId) };
  const load = async (id: string) => ({
    id,
    title: id,
    category: "contract",
    organizationIds: ["org"],
    eventYear: 2027,
  });
  expect(
    (
      await compareDocuments(
        ctx,
        [
          { documentId: "a", expectedVersion: "old" },
          { documentId: "b", expectedVersion: null },
        ],
        reader as any,
        load,
      )
    ).code,
  ).toBe("ASSISTANT_DOCUMENT_CHANGED");
  expect(
    (
      await compareDocuments(
        ctx,
        [
          { documentId: "a", expectedVersion: null },
          { documentId: "b", expectedVersion: null },
        ],
        reader as any,
        async (id) => ({ ...(await load(id)), organizationIds: ["another"] }),
      )
    ).status,
  ).toBe("blocked");
});
it("retains visual usage when a later source is missing or changed", async () => {
  const reader = {
    read: async (_c: any, s: any) => ({
      ...source(s.documentId),
      usage: { inputTokens: 40, outputTokens: 10 },
    }),
  };
  const out = await compareDocuments(
    ctx,
    [
      { documentId: "a", expectedVersion: null },
      { documentId: "b", expectedVersion: null },
    ],
    reader as any,
    async (id) => {
      if (id === "b") throw new Error("deleted");
      return {
        id,
        title: id,
        category: "contract",
        organizationIds: ["org"],
        eventYear: 2027,
      };
    },
  );
  expect(out.code).toBe("ASSISTANT_DOCUMENT_UNAVAILABLE");
  expect(out.usage).toEqual({ inputTokens: 40, outputTokens: 10 });
});
it("stops comparison after uncertain billed extraction and retains known usage", async () => {
  const read = vi.fn(async () => ({
    ...source("a", true),
    usageUnknown: true,
    usage: { inputTokens: 20, outputTokens: 3 },
  }));
  const out = await compareDocuments(
    ctx,
    ["a", "b"].map((documentId) => ({ documentId, expectedVersion: null })),
    { read } as any,
    async (id) => ({
      id,
      title: id,
      category: "contract",
      organizationIds: ["org"],
      eventYear: 2027,
    }),
  );
  expect(read).toHaveBeenCalledTimes(1);
  expect(out.usageUnknown).toBe(true);
  expect(out.usage).toEqual({ inputTokens: 20, outputTokens: 3 });
});
