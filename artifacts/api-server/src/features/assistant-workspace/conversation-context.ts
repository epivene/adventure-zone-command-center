import { createHash } from "node:crypto";
import type { Selection, Turn } from "./contracts";

export type HistoricalMessage = Turn & {
  id: string;
  sequence: number;
  createdAt: string;
  runId: string | null;
  requestedScope: Selection | null;
  resultScope: Selection | null;
};
export type ConversationMemory = {
  schemaVersion: 1;
  throughSequence: number;
  totalMessageCount: number;
  recentMessageCount: number;
  omittedMessageCount: number;
  complete: false;
  fingerprint: string;
  recentSources: Omit<HistoricalMessage, "text">[];
  entries: (Omit<HistoricalMessage, "text" | "id"> & {
    messageId: string;
    excerpt: string;
    truncated: boolean;
  })[];
};
export type SavedConversationContext = {
  sourceMessageId: string;
  sourceSequence: number;
  turns: Turn[];
  memory: ConversationMemory;
};
// Input is a bounded, ordered suffix ending at the run's canonical user message.
// Exact quotes preserve source wording, but never attest to actions or completeness.
export function buildConversationContext(
  messages: HistoricalMessage[],
  totalMessageCount: number,
): SavedConversationContext {
  const source = messages.at(-1);
  if (!source || source.role !== "user")
    throw new Error("ASSISTANT_SOURCE_MESSAGE_MISSING");
  const recent = messages.slice(-6);
  const older = messages.slice(0, -recent.length).slice(-24);
  const entries = older.map(({ id, text, ...provenance }) => ({
    ...provenance,
    messageId: id,
    excerpt: text.slice(0, 1200),
    truncated: text.length > 1200,
  }));
  return {
    sourceMessageId: source.id,
    sourceSequence: source.sequence,
    turns: recent.map(({ role, text, attachments }) => ({
      role,
      text,
      ...(attachments?.length ? { attachments } : {}),
    })),
    memory: {
      schemaVersion: 1,
      throughSequence: source.sequence,
      totalMessageCount,
      recentMessageCount: recent.length,
      omittedMessageCount: Math.max(
        0,
        totalMessageCount - recent.length - entries.length,
      ),
      complete: false,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(messages))
        .digest("hex"),
      recentSources: recent.map(({ text: _text, ...source }) => source),
      entries,
    },
  };
}
