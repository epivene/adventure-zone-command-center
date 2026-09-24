import type { RunContext, ToolResult } from "./contracts";
import type { DocumentReader } from "./document-reader";
import { blocked, result } from "./read-tools";
export type ComparisonSource = {
  id: string;
  title: string;
  category: string;
  organizationIds: string[];
  eventYear: number | null;
};
export async function compareDocuments(
  context: RunContext,
  sources: { documentId: string; expectedVersion: string | null }[],
  reader: Pick<DocumentReader, "read">,
  metadata: (id: string) => Promise<ComparisonSource>,
): Promise<ToolResult> {
  if (
    sources.length < 2 ||
    sources.length > 4 ||
    new Set(sources.map((s) => s.documentId)).size !== sources.length
  )
    return blocked("ASSISTANT_COMPARISON_ARGUMENTS_INVALID");
  const outputs: ToolResult[] = [];
  const items = [];
  let chars = 0;
  const withUsage = (output: ToolResult): ToolResult => ({
    ...output,
    usage: outputs.reduce(
      (s, o) => ({
        inputTokens: s.inputTokens + (o.usage?.inputTokens ?? 0),
        outputTokens: s.outputTokens + (o.usage?.outputTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0 },
    ),
  });
  for (const source of sources) {
    if (context.signal.aborted)
      return withUsage(blocked("ASSISTANT_CANCELLED"));
    let info: ComparisonSource;
    try {
      info = await metadata(source.documentId);
    } catch {
      return withUsage(blocked("ASSISTANT_DOCUMENT_UNAVAILABLE"));
    }
    if (
      !info.organizationIds.some((id) =>
        context.selection.organizationIds.includes(id),
      )
    )
      return withUsage(blocked("ASSISTANT_TARGET_NOT_IN_BATCH"));
    let output: ToolResult;
    try {
      output = await reader.read(context, { documentId: source.documentId });
    } catch {
      return withUsage(blocked("ASSISTANT_DOCUMENT_UNAVAILABLE"));
    }
    outputs.push(output);
    if (!output.evidence.length)
      return withUsage({
        ...output,
        data: { documentId: source.documentId, complete: false },
      });
    const evidence = output.evidence[0];
    if (source.expectedVersion && source.expectedVersion !== evidence.version)
      return withUsage(blocked("ASSISTANT_DOCUMENT_CHANGED"));
    chars += output.evidence.reduce((s, e) => s + e.text.length, 0);
    if (chars > 400000)
      return withUsage(blocked("ASSISTANT_COMPARISON_CONTEXT_LIMIT"));
    const data = output.data as {
      totalPages?: number;
      missingPages?: number[];
    };
    items.push({
      ...info,
      version: evidence.version,
      complete: evidence.complete,
      totalPages: data?.totalPages ?? null,
      missingPages: data?.missingPages ?? [],
      reviewPath: `/business-documents`,
    });
  }
  const complete = outputs.every(
    (o) => o.status === "ok" && o.evidence.every((e) => e.complete),
  );
  const usage = outputs.reduce(
    (s, o) => ({
      inputTokens: s.inputTokens + (o.usage?.inputTokens ?? 0),
      outputTokens: s.outputTokens + (o.usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  return {
    ...result(
      {
        view: "document_comparison",
        sources: items,
        complete,
        assertions: {
          contractExecution: "unverified",
          paymentReceived: "unverified",
          currentInsurance: "unverified",
        },
        reviewFocus: [
          "Event, customer and year",
          "Package, scope, dates, arrival and departure",
          "Price arithmetic, deposit, balance and due dates",
          "Power, water, space and operating requirements",
          "Cancellation, weather and relocation clauses",
          "Signature fields, invoice/payment distinction and COI policy period",
        ],
        scopeWarning:
          "Terms belong to each document's customer and event year. Identify discrepancies; never transfer terms automatically.",
      },
      outputs.flatMap((o) => o.evidence),
    ),
    usage,
    status: complete ? "ok" : "partial",
    code: complete ? null : "ASSISTANT_DOCUMENT_VISUAL_REVIEW_REQUIRED",
  };
}
