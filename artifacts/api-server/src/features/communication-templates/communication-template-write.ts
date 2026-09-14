import type { EmailBuilderDocument } from "@workspace/api-zod";

import { compileEmailBuilderDocument } from "./email-template-compiler";

export function shouldClearEditorDocument(input: { bodyTemplate?: unknown; bodyFormat?: unknown; editorDocument?: unknown }): boolean {
  return input.editorDocument === undefined && (input.bodyTemplate !== undefined || input.bodyFormat !== undefined);
}

export function prepareCommunicationTemplateWrite(input: {
  bodyTemplate: string;
  bodyFormat: "plain_text" | "html";
  editorDocument?: EmailBuilderDocument;
  clearEditorDocument?: boolean;
}): {
  bodyTemplate: string;
  bodyFormat: "plain_text" | "html";
  editorDocument?: EmailBuilderDocument | null;
  editorDocumentVersion?: number | null;
} {
  if (!input.editorDocument) {
    return {
      bodyTemplate: input.bodyTemplate,
      bodyFormat: input.bodyFormat,
      ...(input.clearEditorDocument ? { editorDocument: null, editorDocumentVersion: null } : {}),
    };
  }
  return {
    bodyTemplate: compileEmailBuilderDocument(input.editorDocument),
    bodyFormat: "html",
    editorDocument: input.editorDocument,
    editorDocumentVersion: input.editorDocument.version,
  };
}
