import type { BusinessDocumentCategory } from "@workspace/db";

import type {
  DocumentPathInput,
  ProfilePathInput,
  ResolvedBackupPath,
} from "./google-drive-backup-types";

const MAX_SEGMENT_LENGTH = 80;
const MAX_FILE_BASE_LENGTH = 96;

export const DOCUMENT_TYPE_FOLDERS: Readonly<
  Record<BusinessDocumentCategory, string>
> = {
  contract: "Contracts",
  proposal: "Proposals",
  coi: "COI",
  insurance_policy: "Insurance",
  w9_tax: "W-9 and Tax",
  permit: "Permits",
  vendor_application: "Vendor Applications",
  inspection: "Inspections",
  deposit_receipt: "Deposit Receipts",
  operational_template: "Operational Templates",
  marketing: "Marketing",
  other: "Other",
};

function bounded(value: string, maximum: number): string {
  return [...value].slice(0, maximum).join("").trim();
}

export function sanitizeDriveSegment(value: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$|^$/g, "Unnamed");
  return bounded(normalized, MAX_SEGMENT_LENGTH) || "Unnamed";
}

function stableSuffix(id: string): string {
  const compact = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact.length < 8) {
    throw new Error("GOOGLE_DRIVE_BACKUP_ENTITY_ID_INVALID");
  }
  return compact.slice(0, 8);
}

function namedEntity(name: string, id: string): string {
  const suffix = `--${stableSuffix(id)}`;
  const maximumNameLength = MAX_SEGMENT_LENGTH - suffix.length;
  return `${bounded(sanitizeDriveSegment(name), maximumNameLength)}${suffix}`;
}

function yearFrom(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year >= 1900 && year <= 2100 ? year : null;
}

function filingYear(input: DocumentPathInput): string {
  if (
    Number.isInteger(input.explicitYear) &&
    input.explicitYear! >= 1900 &&
    input.explicitYear! <= 2100
  ) {
    return String(input.explicitYear);
  }
  for (const value of [
    input.effectiveDate,
    input.bookingStartsAt,
    input.issueDate,
    input.createdAt,
  ]) {
    const year = yearFrom(value);
    if (year !== null) return String(year);
  }
  return "Needs Filing";
}

function extensionFrom(filename: string): string {
  const match = filename.normalize("NFC").trim().match(/\.([a-z0-9]{1,12})$/i);
  return match ? `.${match[1]!.toLowerCase()}` : "";
}

function documentFileName(input: DocumentPathInput): string {
  const extension = extensionFrom(input.originalFilename);
  const displayName = extension &&
      input.displayName.toLowerCase().endsWith(extension.toLowerCase())
    ? input.displayName.slice(0, -extension.length)
    : input.displayName;
  const suffix = `--${stableSuffix(input.documentId)}`;
  const base = bounded(
    sanitizeDriveSegment(displayName),
    MAX_FILE_BASE_LENGTH - suffix.length,
  );
  return `${base}${suffix}${extension}`;
}

function resolved(
  directories: readonly string[],
  fileName: string,
): ResolvedBackupPath {
  return {
    directories,
    fileName,
    logicalPath: [...directories, fileName].join("/"),
  };
}

export function resolveProfileBackupPath(
  input: ProfilePathInput,
): ResolvedBackupPath {
  const profileFolder = namedEntity(input.displayName, input.organizationId);
  return resolved(
    ["Profiles", profileFolder],
    input.kind === "profile_summary"
      ? "Profile Summary.pdf"
      : "Follow-ups.pdf",
  );
}

export function resolveDocumentBackupPath(
  input: DocumentPathInput,
): ResolvedBackupPath {
  const profileFolder =
    input.organizationId && input.organizationName?.trim()
      ? namedEntity(input.organizationName, input.organizationId)
      : `Unlinked--${stableSuffix(input.documentId)}`;
  return resolved(
    [
      "Documents",
      filingYear(input),
      DOCUMENT_TYPE_FOLDERS[input.category],
      profileFolder,
    ],
    documentFileName(input),
  );
}
