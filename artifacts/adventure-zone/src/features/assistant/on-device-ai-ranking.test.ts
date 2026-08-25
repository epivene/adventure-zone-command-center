import { describe, expect, it } from "vitest";

import { rankLocalDocuments } from "./on-device-ai-ranking";
import type { LocalAssistantDocument } from "./on-device-ai-documents";

const documents: LocalAssistantDocument[] = [
  { id: "a", text: "power requirements", sourceIds: [], kind: "brief" },
  { id: "b", text: "water hookup", sourceIds: [], kind: "brief" },
  { id: "c", text: "insurance certificate", sourceIds: [], kind: "brief" },
];

describe("rankLocalDocuments", () => {
  it("orders documents by cosine similarity", () => {
    const ranked = rankLocalDocuments({
      queryEmbedding: [1, 0],
      documentEmbeddings: [[1, 0], [0.6, 0.8], [-1, 0]],
      documents,
    });
    expect(ranked.map((item) => item.document.id)).toEqual(["a", "b", "c"]);
    expect(ranked[0]?.score).toBeCloseTo(1, 6);
    expect(ranked[1]?.score).toBeCloseTo(0.6, 6);
    expect(ranked[2]?.score).toBeCloseTo(-1, 6);
  });

  it("treats zero vectors as zero similarity instead of NaN", () => {
    const ranked = rankLocalDocuments({
      queryEmbedding: [0, 0],
      documentEmbeddings: [[1, 0], [0, 0], [0, 1]],
      documents,
    });
    expect(ranked.every((item) => Number.isFinite(item.score))).toBe(true);
    expect(ranked.every((item) => item.score === 0)).toBe(true);
  });

  it("keeps original document order for equal scores", () => {
    const ranked = rankLocalDocuments({
      queryEmbedding: [1, 0],
      documentEmbeddings: [[1, 0], [1, 0], [1, 0]],
      documents,
    });
    expect(ranked.map((item) => item.document.id)).toEqual(["a", "b", "c"]);
  });

  it("ignores embeddings without a corresponding document", () => {
    const ranked = rankLocalDocuments({
      queryEmbedding: [1, 0],
      documentEmbeddings: [[1, 0], [0, 1], [-1, 0], [0.5, 0.5]],
      documents,
    });
    expect(ranked).toHaveLength(3);
  });
});
