import type { BusinessDocumentCategory } from "@workspace/db";

export type DocumentClassificationProposal =
  | { decision: "skip"; errorCode: string }
  | {
      decision: "auto" | "review";
      category: BusinessDocumentCategory;
      confidence: number;
      reasonCodes: string[];
    };

type ClassificationInput = {
  filename: string;
  mimeType: string;
  subject?: string;
  bodyText?: string;
};

const rules: Array<{
  category: BusinessDocumentCategory;
  pattern: RegExp;
  reason: string;
}> = [
  { category: "coi", pattern: /\bcoi\b|certificate of insurance/i, reason: "coi_phrase" },
  { category: "w9_tax", pattern: /\bw[- ]?9\b|tax form/i, reason: "w9_phrase" },
  { category: "insurance_policy", pattern: /insurance renewal|insurance policy/i, reason: "insurance_policy_phrase" },
  { category: "proposal", pattern: /\bproposal\b|cover letter/i, reason: "proposal_phrase" },
  { category: "vendor_application", pattern: /vendor application/i, reason: "vendor_application_phrase" },
  { category: "permit", pattern: /\bpermit\b/i, reason: "permit_phrase" },
  { category: "inspection", pattern: /\binspection\b/i, reason: "inspection_phrase" },
  { category: "deposit_receipt", pattern: /deposit|receipt/i, reason: "deposit_receipt_phrase" },
  { category: "contract", pattern: /\bcontract\b|\bagreement\b/i, reason: "contract_phrase" },
  { category: "marketing", pattern: /promo|marketing|flyer|brochure/i, reason: "marketing_phrase" },
  { category: "operational_template", pattern: /\btemplate\b|schedule|checklist/i, reason: "operational_template_phrase" },
];

export function classifyBusinessDocument(
  input: ClassificationInput,
): DocumentClassificationProposal {
  const filename = input.filename.trim();
  const lower = filename.toLowerCase();
  if (
    lower.startsWith("~$") ||
    lower.endsWith(".tmp") ||
    lower === "desktop.ini"
  ) {
    return {
      decision: "skip",
      errorCode: "business_document_temporary_file",
    };
  }

  const evidence = [filename, input.subject ?? "", input.bodyText ?? ""].join("\n");
  const rule = rules.find((candidate) => candidate.pattern.test(evidence));
  if (rule) {
    return {
      decision: "auto",
      category: rule.category,
      confidence: 0.98,
      reasonCodes: [rule.reason],
    };
  }
  return {
    decision: "review",
    category: "other",
    confidence: 0.25,
    reasonCodes: ["category_unresolved"],
  };
}
