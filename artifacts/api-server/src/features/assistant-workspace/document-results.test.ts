import { it, expect } from "vitest";
import { publicDocumentResults } from "./document-results";
it("shows reused reading dates without exposing extraction bodies", () => {
  const data = {
    view: "document_reading",
    documentId: null,
    sourceLabel: "Email attachment",
    eventYear: null,
    version: "hash",
    complete: false,
    totalPages: 1,
    missingPages: [1],
    cacheHit: true,
    extractedAt: "2026-09-25T00:00:00Z",
    pages: [{ text: "private document" }],
  };
  const cards = publicDocumentResults([
    {
      id: "run",
      turn: {
        results: {
          c: {
            data,
            evidence: [
              { retrievedAt: "2026-09-25T01:00:00Z", text: "private document" },
            ],
          },
        },
      },
    },
  ] as any);
  expect(cards[0]).toMatchObject({
    retrievedAt: "2026-09-25T01:00:00Z",
    data: {
      cacheHit: true,
      extractedAt: "2026-09-25T00:00:00Z",
      missingPages: [1],
    },
  });
  expect(JSON.stringify(cards)).not.toContain("private document");
});
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
it("projects sourced research without provider state and excludes unsafe saved citation URLs", () => {
  const make = (url: string) => [
    {
      id: "run",
      turn: {
        providerItems: [{ secret: "hidden" }],
        results: {
          call: {
            evidence: [],
            data: {
              view: "public_research",
              query: "Public fair dates",
              model: "selected",
              complete: false,
              parts: [
                {
                  text: "Historical listing",
                  citations: [
                    { url, title: "Fair", startIndex: 0, endIndex: 10 },
                  ],
                },
              ],
              consultedSources: [],
              warnings: [],
              providerState: "hidden",
            },
          },
        },
      },
    },
  ];
  const safe = publicDocumentResults(make("https://city.example/fair") as any);
  expect(safe).toHaveLength(1);
  expect(JSON.stringify(safe)).not.toContain("hidden");
  expect(
    publicDocumentResults(make("http://127.0.0.1/private") as any),
  ).toEqual([]);
});
