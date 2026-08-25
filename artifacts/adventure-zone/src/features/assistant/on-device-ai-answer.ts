import type { AssistantCachedSnapshot } from "./assistant-offline-cache";
import type { ClientAssistantAnswer } from "./on-device-ai-client-types";
import { buildLocalAssistantDocuments } from "./on-device-ai-documents";
import { rankLocalDocuments } from "./on-device-ai-ranking";
import { routeLocalAssistantQuestion } from "./on-device-ai-router";
import { embedLocalTexts, isOnDeviceAiEnabled } from "./on-device-ai-runtime";

const STRONG_MATCH = 0.48;
const QUERY_TIMEOUT_MS = 8_000;

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error("On-device AI timed out.")), milliseconds);
    promise.then(
      (value) => { clearTimeout(handle); resolve(value); },
      (error) => { clearTimeout(handle); reject(error); },
    );
  });
}

export async function tryOnDeviceSemanticAnswer(
  question: string,
  snapshot: AssistantCachedSnapshot,
): Promise<ClientAssistantAnswer | null> {
  if (routeLocalAssistantQuestion(question) !== "semantic_cached_search") return null;
  if (!isOnDeviceAiEnabled()) return null;

  const documents = buildLocalAssistantDocuments(snapshot);
  if (!documents.length) return null;

  try {
    const embeddings = await timeout(
      embedLocalTexts([question, ...documents.map((document) => document.text)]),
      QUERY_TIMEOUT_MS,
    );
    const queryEmbedding = embeddings[0];
    if (!queryEmbedding) return null;
    const ranked = rankLocalDocuments({
      queryEmbedding,
      documentEmbeddings: embeddings.slice(1),
      documents,
    });
    const top = ranked[0];
    if (!top || top.score < STRONG_MATCH) return null;

    const matches = ranked
      .filter((item) => item.score >= STRONG_MATCH)
      .slice(0, 3);
    const sourceIds = [...new Set(matches.flatMap((item) => item.document.sourceIds))];
    const sourceSet = new Set(sourceIds);
    const sources = snapshot.context.sources.filter((source) => sourceSet.has(source.id));
    const lines = matches.map((item) => `• ${item.document.text}`);

    return {
      text: `I found this in the saved Command Center context:\n${lines.join("\n")}`,
      mode: "on_device",
      confidence: top.score >= 0.68 ? "high" : "medium",
      sources,
      needsAdmin: false,
    };
  } catch {
    return null;
  }
}
