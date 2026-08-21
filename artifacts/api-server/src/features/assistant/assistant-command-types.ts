export type AssistantCommandKind =
  | "search"
  | "audit"
  | "research"
  | "report"
  | "change"
  | "question";

export type AssistantCommandRisk =
  | "read_only"
  | "proposes_changes"
  | "writes_data";

export type AssistantCommandScope =
  | { kind: "all_applicable" }
  | { kind: "current_profile"; recordId: string }
  | { kind: "record_ids"; recordIds: string[] };

export type AssistantCommand = {
  kind: AssistantCommandKind;
  capability: "website_verification";
  originalText: string;
  scope: AssistantCommandScope;
  parameters: Record<string, never>;
  risk: AssistantCommandRisk;
  confidence: "high" | "medium" | "low";
};
