import { it, expect } from "vitest";
import { publicDocumentResults } from "./document-results";
it("exposes document metadata without stored source text or provider reasoning", () => {
  const runs = [
    {
      id: "run",
      turn: {
        providerItems: [{ secret: "reasoning" }],
        results: {
          call: {
            data: {
              view: "document_comparison",
              complete: false,
              sources: [
                {
                  id: "7b054bf0-73a6-44b8-ae68-92aa7d66ddc8",
                  title: "Sample",
                  category: "coi",
                  organizationIds: ["profile"],
                  eventYear: null,
                  version: "hash",
                  complete: false,
                  totalPages: 1,
                  missingPages: [1],
                  storageKey: "private",
                },
              ],
            },
            evidence: [
              {
                text: "private full text",
                retrievedAt: "2026-09-24T00:00:00Z",
              },
            ],
          },
        },
      },
    },
  ];
  const cards = publicDocumentResults(runs as any);
  expect(cards).toHaveLength(1);
  const data = cards[0].data;
  expect(data.view).toBe("document_comparison");
  if (data.view !== "document_comparison") throw new Error("wrong card");
  expect(data.sources[0].missingPages).toEqual([1]);
  expect(JSON.stringify(cards)).not.toMatch(/private|reasoning|providerItems/);
});
