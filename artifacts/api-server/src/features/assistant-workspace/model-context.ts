import { createHash } from "node:crypto";
import type { Evidence, ToolResult } from "./contracts";
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
// PostgreSQL JSONB can reorder object keys on checkpoint restore.
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function sourceKey(e: Evidence) {
  return digest(
    canonical({
      id: e.id,
      kind: e.kind,
      recordId: e.recordId,
      eventYear: e.eventYear,
      occurredAt: e.occurredAt,
      version: e.version,
      complete: e.complete,
      text: e.text,
    }),
  );
}
function sourceInData(e: Evidence, data: unknown): boolean {
  if (typeof data === "string" && data === e.text) return true;
  try {
    const source = canonical(JSON.parse(e.text));
    if (
      source === canonical(data) ||
      (Array.isArray(data) && data.some((row) => canonical(row) === source))
    )
      return true;
  } catch {
    /* Non-JSON source text is compared only against known full renderings. */
  }
  if (
    e.kind === "email" &&
    object(data) &&
    Array.isArray(data.messages) &&
    data.messages.every(
      (m: any) =>
        object(m) &&
        typeof m.id === "string" &&
        typeof m.direction === "string" &&
        typeof m.bodyText === "string",
    )
  ) {
    return (
      e.text ===
      data.messages
        .map((m: any) => `[${m.id}; ${m.direction}]\n${m.bodyText}`)
        .join("\n\n")
    );
  }
  return false;
}
function compactResult(result: ToolResult) {
  let data = result.data;
  // Keep complete PDF evidence (including visual transcription) once, with structured page status.
  if (
    object(data) &&
    Array.isArray(data.pages) &&
    data.pages.length &&
    data.pages.every(
      (p: any) =>
        object(p) &&
        typeof p.page === "number" &&
        typeof p.text === "string" &&
        typeof p.state === "string",
    )
  ) {
    const rendered = data.pages
      .map((p: any) => `[Page ${p.page}; ${p.state}]\n${p.text}`)
      .join("\n\n");
    const source = result.evidence.find(
      (e) =>
        e.kind === "document" &&
        (e.text === rendered ||
          e.text.startsWith(
            rendered + "\n\n[Visual transcription; requires verification]\n",
          )),
    );
    if (source)
      data = {
        ...data,
        pages: data.pages.map(({ text: _text, ...page }: any) => ({
          ...page,
          textSourceEvidenceId: source.id,
        })),
      };
  }
  return {
    ...result,
    data,
    evidence: result.evidence.map((e) =>
      sourceInData(e, data)
        ? { ...e, text: "Full source content is in this result's data." }
        : e,
    ),
  };
}
/** Model-only view: never mutate or truncate saved sources, receipts or checkpoints. */
export function projectModelContext(
  evidence: Evidence[],
  providerItems: unknown[],
) {
  const represented = new Set<string>(),
    priorResults = new Map<string, string>();
  const items = providerItems.map((item) => {
    if (
      !object(item) ||
      item.type !== "function_call_output" ||
      typeof item.output !== "string" ||
      typeof item.call_id !== "string"
    )
      return item;
    let result: ToolResult;
    try {
      const value = JSON.parse(item.output);
      if (
        !object(value) ||
        !("data" in value) ||
        !Array.isArray(value.receipts) ||
        !Array.isArray(value.evidence) ||
        !value.evidence.every(
          (e: any) =>
            object(e) && typeof e.id === "string" && typeof e.text === "string",
        )
      )
        return item;
      result = value as ToolResult;
    } catch {
      return item;
    }
    const keys = result.evidence.map(sourceKey);
    keys.forEach((key) => represented.add(key));
    const key = digest(
      canonical({
        status: result.status,
        code: result.code,
        data: result.data,
        evidence: keys,
        screenshots: result.screenshots,
      }),
    );
    const prior = result.receipts.length ? undefined : priorResults.get(key);
    if (!prior) priorResults.set(key, item.call_id);
    const projected = prior
      ? {
          ...result,
          data: { sourceResultCallId: prior },
          evidence: result.evidence.map((e) => ({
            ...e,
            text: `Full source content is in tool result ${prior}.`,
          })),
        }
      : compactResult(result);
    return { ...item, output: JSON.stringify(projected) };
  });
  const remaining = new Map<string, Evidence>();
  for (const e of evidence) {
    const key = sourceKey(e);
    if (!represented.has(key)) remaining.set(key, e);
  }
  return { evidence: [...remaining.values()], providerItems: items };
}
