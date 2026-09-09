import { describe, expect, it } from "vitest";

import {
  resolveDocumentBackupPath,
  resolveProfileBackupPath,
  sanitizeDriveSegment,
} from "./google-drive-backup-path-resolver";

const organizationId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";

describe("Google Drive backup path resolver", () => {
  it("keeps profile folders compact with exactly the two rolling PDF names", () => {
    expect(
      resolveProfileBackupPath({
        organizationId,
        displayName: "Boulder County Fair",
        kind: "profile_summary",
      }),
    ).toEqual({
      directories: ["Profiles", "Boulder County Fair--11111111"],
      fileName: "Profile Summary.pdf",
      logicalPath:
        "Profiles/Boulder County Fair--11111111/Profile Summary.pdf",
    });
    expect(
      resolveProfileBackupPath({
        organizationId,
        displayName: "Boulder County Fair",
        kind: "follow_up_summary",
      }).fileName,
    ).toBe("Follow-ups.pdf");
  });

  it("sanitizes separators, controls, repeated whitespace, and long names", () => {
    expect(sanitizeDriveSegment("  Fair / North\\West\n  ")).toBe(
      "Fair - North-West",
    );
    expect(sanitizeDriveSegment("\u0000\u0007")).toBe("Unnamed");
    expect(sanitizeDriveSegment("é")).toBe("é");
    expect(sanitizeDriveSegment("x".repeat(200))).toHaveLength(80);
  });

  it.each([
    ["contract", "Contracts"],
    ["proposal", "Proposals"],
    ["coi", "COI"],
    ["insurance_policy", "Insurance"],
    ["w9_tax", "W-9 and Tax"],
    ["permit", "Permits"],
    ["vendor_application", "Vendor Applications"],
    ["inspection", "Inspections"],
    ["deposit_receipt", "Deposit Receipts"],
    ["operational_template", "Operational Templates"],
    ["marketing", "Marketing"],
    ["other", "Other"],
  ] as const)("maps %s documents into %s", (category, folder) => {
    const path = resolveDocumentBackupPath({
      documentId,
      displayName: "Signed Contract",
      originalFilename: "signed.pdf",
      category,
      organizationId,
      organizationName: "Boulder County Fair",
      explicitYear: 2026,
    });

    expect(path.directories).toEqual([
      "Documents",
      "2026",
      folder,
      "Boulder County Fair--11111111",
    ]);
    expect(path.fileName).toBe("Signed Contract--22222222.pdf");
  });

  it("uses the approved year precedence", () => {
    const base = {
      documentId,
      displayName: "Agreement",
      originalFilename: "agreement.pdf",
      category: "contract" as const,
      organizationId,
      organizationName: "Fair",
    };
    expect(
      resolveDocumentBackupPath({
        ...base,
        explicitYear: 2027,
        effectiveDate: "2026-01-01",
        bookingStartsAt: "2025-01-01T00:00:00.000Z",
        issueDate: "2024-01-01",
        createdAt: "2023-01-01T00:00:00.000Z",
      }).directories[1],
    ).toBe("2027");
    expect(
      resolveDocumentBackupPath({
        ...base,
        effectiveDate: "2026-01-01",
        bookingStartsAt: "2025-01-01T00:00:00.000Z",
      }).directories[1],
    ).toBe("2026");
    expect(
      resolveDocumentBackupPath({
        ...base,
        bookingStartsAt: "2025-01-01T00:00:00.000Z",
        issueDate: "2024-01-01",
      }).directories[1],
    ).toBe("2025");
    expect(
      resolveDocumentBackupPath({
        ...base,
        issueDate: "2024-01-01",
        createdAt: "2023-01-01T00:00:00.000Z",
      }).directories[1],
    ).toBe("2024");
    expect(
      resolveDocumentBackupPath({
        ...base,
        createdAt: "2023-01-01T00:00:00.000Z",
      }).directories[1],
    ).toBe("2023");
  });

  it("routes ambiguous years and unlinked documents to Needs Filing", () => {
    const path = resolveDocumentBackupPath({
      documentId,
      displayName: "Mystery / File",
      originalFilename: "mystery.docx",
      category: "other",
    });

    expect(path.directories).toEqual([
      "Documents",
      "Needs Filing",
      "Other",
      "Unlinked--22222222",
    ]);
    expect(path.logicalPath).toBe(
      "Documents/Needs Filing/Other/Unlinked--22222222/Mystery - File--22222222.docx",
    );
  });

  it("uses stable ID suffixes to prevent duplicate-looking names from colliding", () => {
    const first = resolveProfileBackupPath({
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      displayName: "Same Fair",
      kind: "profile_summary",
    });
    const second = resolveProfileBackupPath({
      organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      displayName: "Same Fair",
      kind: "profile_summary",
    });

    expect(first.directories[1]).not.toBe(second.directories[1]);
  });
});
