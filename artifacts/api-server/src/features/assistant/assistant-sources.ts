import type {
  AssistantSourceKind,
  AssistantSourceReference,
} from "./assistant-types";

function safeSourceToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function assistantSourceId(
  kind: AssistantSourceKind,
  recordId: string,
): string {
  return `src_${kind}_${safeSourceToken(recordId)}`;
}

export function assistantSource(input: {
  kind: AssistantSourceKind;
  recordId: string;
  label: string;
  occurredAt: Date | string | null;
}): AssistantSourceReference {
  return {
    id: assistantSourceId(input.kind, input.recordId),
    kind: input.kind,
    recordId: input.recordId,
    label: input.label,
    occurredAt:
      input.occurredAt instanceof Date
        ? input.occurredAt.toISOString()
        : input.occurredAt,
  };
}

export function uniqueAssistantSources(
  sources: readonly AssistantSourceReference[],
): AssistantSourceReference[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}
