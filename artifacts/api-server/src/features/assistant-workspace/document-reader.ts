import { createHash } from "node:crypto";
import { z } from "zod";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { RunContext, ToolResult } from "./contracts";
import { blocked } from "./read-tools";
export function documentCompleteness(
  totalPages: number,
  readablePages: number[],
) {
  const seen = new Set(readablePages);
  const missingPages = Array.from(
    { length: Math.max(0, totalPages) },
    (_, i) => i + 1,
  ).filter((p) => !seen.has(p));
  return {
    complete: totalPages > 0 && missingPages.length === 0,
    missingPages,
  };
}
const sourceSchema = z.union([
  z.object({ documentId: z.string().uuid() }).strict(),
  z
    .object({
      messageId: z.string().min(1).max(256),
      attachmentId: z.string().min(1).max(1024),
    })
    .strict(),
]);
export type DocumentSource = z.infer<typeof sourceSchema>;
export interface DocumentReaderDependencies {
  ownerId: string;
  visualExtract?(input: {
    bytes: Uint8Array;
    mimeType: string;
    missingPages: number[];
    signal: AbortSignal;
  }): Promise<{
    text: string;
    usage: { inputTokens: number; outputTokens: number };
  }>;
  // Adapter must validate storage/account access before returning bytes, never accept URLs.
  load(
    context: RunContext,
    source: DocumentSource,
  ): Promise<{ bytes: Uint8Array; recordId: string; eventYear: number | null }>;
}
export class DocumentReader {
  constructor(private readonly deps: DocumentReaderDependencies) {}
  async read(context: RunContext, raw: unknown): Promise<ToolResult> {
    if (
      context.actor.id !== this.deps.ownerId ||
      context.actor.role !== "owner"
    )
      return blocked("ASSISTANT_ACCESS_DENIED");
    const parsed = sourceSchema.safeParse(raw);
    if (!parsed.success) return blocked("ASSISTANT_ARGUMENTS_INVALID");
    if (context.signal.aborted) return blocked("ASSISTANT_CANCELLED");
    try {
      const source = await this.deps.load(context, parsed.data);
      const bytes = source.bytes;
      if (bytes.length > 25 * 1024 * 1024)
        return blocked("ASSISTANT_DOCUMENT_TOO_LARGE");
      if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") {
        const magic = Buffer.from(bytes.subarray(0, 8)).toString("hex");
        const mimeType = magic.startsWith("89504e470d0a1a0a")
          ? "image/png"
          : magic.startsWith("ffd8ff")
            ? "image/jpeg"
            : null;
        if (!mimeType || !this.deps.visualExtract)
          return blocked("ASSISTANT_DOCUMENT_FORMAT_UNSUPPORTED");
        const visualResult = await this.deps.visualExtract({
          bytes,
          mimeType,
          missingPages: [1],
          signal: context.signal,
        });
        return {
          status: "partial",
          usage: visualResult.usage,
          data: {
            totalPages: 1,
            missingPages: [1],
            complete: false,
            visualReviewRequired: true,
          },
          evidence: [
            {
              id: source.recordId,
              kind: "document",
              recordId: source.recordId,
              eventYear: source.eventYear,
              occurredAt: null,
              retrievedAt: new Date().toISOString(),
              version: createHash("sha256").update(bytes).digest("hex"),
              complete: false,
              text: `Visual transcription; requires verification:\n${visualResult.text}`,
            },
          ],
          receipts: [],
          code: "ASSISTANT_DOCUMENT_VISUAL_REVIEW_REQUIRED",
        };
      }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const job = getDocument({
        data: bytes.slice(),
        useSystemFonts: true,
        disableFontFace: true,
      });
      const abort = () => {
        void job.destroy();
      };
      context.signal.addEventListener("abort", abort, { once: true });
      try {
        const pdf = await job.promise;
        if (pdf.numPages > 100) return blocked("ASSISTANT_DOCUMENT_PAGE_LIMIT");
        const pages: { page: number; text: string; state: string }[] = [];
        let length = 0;
        for (let n = 1; n <= pdf.numPages; n++) {
          if (context.signal.aborted) return blocked("ASSISTANT_CANCELLED");
          try {
            const page = await pdf.getPage(n);
            const text = await page.getTextContent();
            const ops = await page.getOperatorList();
            const body = text.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" ")
              .trim();
            length += body.length;
            const images = ops.fnArray.some((op) =>
              [
                OPS.paintImageXObject,
                OPS.paintInlineImageXObject,
                OPS.paintImageMaskXObject,
              ].includes(op),
            );
            // Text extraction alone cannot attest to scanned content, signatures, or images.
            pages.push({
              page: n,
              text: body,
              state: body && !images ? "readable" : "visual_review_required",
            });
            page.cleanup();
            if (length > 180000)
              return {
                ...blocked("ASSISTANT_DOCUMENT_TEXT_LIMIT"),
                data: { totalPages: pdf.numPages, complete: false },
              };
          } catch {
            pages.push({ page: n, text: "", state: "unreadable" });
          }
        }
        const completeness = documentCompleteness(
          pdf.numPages,
          pages.filter((p) => p.state === "readable").map((p) => p.page),
        );
        const version = `${hash}:pdfjs-text-v1`;
        let visual = "";
        let usage: ToolResult["usage"];
        if (!completeness.complete && this.deps.visualExtract) {
          try {
            const visualResult = await this.deps.visualExtract({
              bytes,
              mimeType: "application/pdf",
              missingPages: completeness.missingPages,
              signal: context.signal,
            });
            visual = visualResult.text;
            usage = visualResult.usage;
          } catch {
            visual =
              "Visual transcription unavailable; review the original pages.";
          }
        }

        return {
          status: completeness.complete ? "ok" : "partial",
          ...(usage ? { usage } : {}),
          data: {
            ...completeness,
            totalPages: pdf.numPages,
            pages,
            contentHash: hash,
            extractorVersion: "pdfjs-text-v1",
            executionStatus: "unverified",
          },
          evidence: [
            {
              id: source.recordId,
              kind: "document",
              recordId: source.recordId,
              eventYear: source.eventYear,
              occurredAt: null,
              retrievedAt: new Date().toISOString(),
              version,
              complete: completeness.complete,
              text:
                pages
                  .map((p) => `[Page ${p.page}; ${p.state}]\n${p.text}`)
                  .join("\n\n") +
                (visual
                  ? `\n\n[Visual transcription; requires verification]\n${visual}`
                  : ""),
            },
          ],
          receipts: [],
          code: completeness.complete
            ? null
            : "ASSISTANT_DOCUMENT_VISUAL_REVIEW_REQUIRED",
        };
      } finally {
        context.signal.removeEventListener("abort", abort);
        await job.destroy();
      }
    } catch {
      return blocked(
        context.signal.aborted
          ? "ASSISTANT_CANCELLED"
          : "ASSISTANT_DOCUMENT_UNAVAILABLE",
      );
    }
  }
}
