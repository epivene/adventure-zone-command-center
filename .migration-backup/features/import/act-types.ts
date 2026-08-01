export type ActCsvRecord = {
  rowNumber: number;
  recordId: string | null;
  company: string | null;
  contact: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  validationErrors: string[];
};

export type LocalContact = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  contactName: string;
  email: string | null;
  phone: string | null;
};

export const importCategories = [
  "new",
  "change",
  "duplicate",
  "conflict",
  "error",
] as const;

export type ImportCategory = (typeof importCategories)[number];

export type ImportMatchReason =
  | "external_id"
  | "email"
  | "organization_contact"
  | "none";

export type ImportFieldChange = {
  field: "company" | "contact" | "email" | "phone";
  before: string | null;
  after: string | null;
};

export type ImportPreviewRow = {
  rowId: string;
  record: ActCsvRecord;
  category: ImportCategory;
  matchReason: ImportMatchReason;
  localContactId: string | null;
  localContact: LocalContact | null;
  candidateContactIds: string[];
  changes: ImportFieldChange[];
  messages: string[];
};

export type ImportSummary = Record<ImportCategory, number>;

export type ImportRun = {
  id: string;
  sourceFileName: string;
  status: "previewed" | "completed";
  rows: readonly ImportPreviewRow[];
  appliedRowIds?: readonly string[];
};

export type ImportPreview = {
  runId: string;
  sourceFileName: string;
  rows: ImportPreviewRow[];
  summary: ImportSummary;
};

export type ImportApplyFailure = {
  rowId: string;
  message: string;
};

export type ImportApplyResult = {
  runId: string;
  appliedRowIds: string[];
  skippedRowIds: string[];
  failedRows: ImportApplyFailure[];
};

export type ImportAuditEntry = {
  entityType: "contact";
  entityId: string;
  action: "act_import_created" | "act_import_updated";
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
};
