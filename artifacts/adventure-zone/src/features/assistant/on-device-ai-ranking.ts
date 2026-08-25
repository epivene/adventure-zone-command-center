import type { LocalAssistantDocument } from "./on-device-ai-documents";

function cosine(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const a = Number(left[index] ?? 0);
    const b = Number(right[index] ?? 0);
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function rankLocalDocuments(input: {
  queryEmbedding: number[];
  documentEmbeddings: number[][];
  documents: LocalAssistantDocument[];
}): Array<{ document: LocalAssistantDocument; score: number }> {
  return input.documents
    .map((document, index) => ({
      document,
      score: cosine(input.queryEmbedding, input.documentEmbeddings[index] ?? []),
      index,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ document, score }) => ({ document, score }));
}
