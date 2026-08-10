import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewRow } from "@/features/act-replacement/act-replacement-client";
import { ImportReview } from "./import-review";

afterEach(cleanup);

describe("ImportReview", () => {
  it("summarizes automatic review and keeps archived diagnostics optional", () => {
    render(
      <ImportReview
        autoResolvedCount={12}
        safeOperationCount={19}
        archivedOnlyCount={7}
        review={{
          page: 1,
          pageSize: 25,
          total: 1,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 0,
            archivedOnly: 7,
            issueCounts: { ambiguous_match: 1 },
            diagnosticCounts: {},
          },
          rows: [
            {
              sourceRecordId: "archived-source",
              sourceVersionId: "archived-version",
              state: "awaiting_review",
              issueCodes: ["ambiguous_match"],
              issues: [{ code: "ambiguous_match" }],
              conflicts: [],
              candidates: [],
              canImportStandalone: true,
              operationKeys: [],
              streamType: "company",
              display: { name: "Archived Company" },
            },
          ],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onImportAsNew={() => {}}
        onImport={() => {}}
      />,
    );

    expect(
      screen.getByText("12 records auto-resolved from strong context clues"),
    ).toBeInTheDocument();
    expect(screen.getByText("19 safe operations ready")).toBeInTheDocument();
    expect(
      screen.getByText("7 uncertain records kept in the archive"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/You do not need to review these before importing the safe data/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import safe records" }),
    ).toBeEnabled();
    expect(
      screen.getByText("Optional archived-record diagnostics"),
    ).toBeInTheDocument();
    expect(screen.getByText("Optional archived-record diagnostics").closest("details")).not.toHaveAttribute("open");
    expect(
      screen.queryByText("Select all safe matches on this page"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Accept selected safe matches"),
    ).not.toBeInTheDocument();
  });

  it("keeps unsupported-field diagnostics visible without actionable issue groups", () => {
    render(
      <ImportReview
        safeOperationCount={0}
        archivedOnlyCount={0}
        review={{
          page: 1,
          pageSize: 25,
          total: 0,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 0,
            archivedOnly: 0,
            issueCounts: {},
            diagnosticCounts: { unsupported_field: 7 },
          },
          rows: [],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onImportAsNew={() => {}}
        onImport={() => {}}
      />,
    );

    expect(
      screen.getByText("7 unsupported fields preserved in the archive"),
    ).toBeInTheDocument();
  });

  it("shows safe counts, grouped issues, and only sanitized record summaries", () => {
    render(
      <ImportReview
        safeOperationCount={42}
        archivedOnlyCount={3}
        review={{
          page: 1,
          pageSize: 25,
          total: 3,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 3,
            archivedOnly: 3,
            issueCounts: { ambiguous_match: 2 },
            diagnosticCounts: { unsupported_field: 1 },
          },
          rows: [
            {
              sourceRecordId: "private-source-id",
              sourceVersionId: "private-version-id",
              state: "awaiting_review",
              issueCodes: ["ambiguous_match"],
              issues: [{ code: "ambiguous_match" }],
              conflicts: [],
              candidates: [],
              canImportStandalone: true,
              operationKeys: [],
              streamType: "contact",
              display: { name: "Ada Lovelace", email: "ada@example.com" },
            },
            {
              sourceRecordId: "second-private-id",
              sourceVersionId: "second-private-version",
              state: "unsupported",
              issueCodes: ["unsupported_field", "ambiguous_match"],
              issues: [
                { code: "unsupported_field" },
                { code: "ambiguous_match" },
              ],
              conflicts: [],
              candidates: [],
              canImportStandalone: true,
              operationKeys: [],
              streamType: "company",
              display: { name: "Analytical Engines" },
            },
          ],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onImportAsNew={() => {}}
        onImport={() => {}}
      />,
    );

    expect(screen.getByText("42 safe operations ready")).toBeInTheDocument();
    expect(screen.getByText("3 uncertain records kept in the archive")).toBeInTheDocument();
    expect(screen.getByText("Issue groups on this page")).toBeInTheDocument();
    expect(screen.getByText("Ambiguous match (2)")).toBeInTheDocument();
    expect(screen.getByText("Unsupported field (1)")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByText(/private-source-id/i)).not.toBeInTheDocument();
  });

  it("submits search and pages through durable review results", () => {
    const onSearch = vi.fn();
    const onPageChange = vi.fn();
    render(
      <ImportReview
        safeOperationCount={1}
        archivedOnlyCount={26}
        review={{
          page: 1,
          pageSize: 25,
          total: 26,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 26,
            archivedOnly: 26,
            issueCounts: {},
            diagnosticCounts: {},
          },
          rows: [],
        }}
        onSearch={onSearch}
        onPageChange={onPageChange}
        onImportAsNew={() => {}}
        onImport={() => {}}
      />,
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search review records" }),
      {
        target: { value: "Ada" },
      },
    );
    fireEvent.submit(screen.getByRole("search"));
    expect(onSearch).toHaveBeenCalledWith("Ada");

    fireEvent.click(screen.getByRole("button", { name: "Next review page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("offers a durable import-as-new decision for ambiguous matches", () => {
    const onImportAsNew = vi.fn();
    const row: ReviewRow = {
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      state: "awaiting_review",
      issueCodes: ["ambiguous_match"],
      issues: [{ code: "ambiguous_match" }],
      conflicts: [],
      candidates: [],
      canImportStandalone: true,
      operationKeys: [],
      streamType: "company",
      display: { name: "Adventure Zone" },
    };
    render(
      <ImportReview
        safeOperationCount={0}
        archivedOnlyCount={1}
        canResolveAmbiguous
        review={{
          page: 1,
          pageSize: 25,
          total: 1,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 1,
            archivedOnly: 1,
            issueCounts: { ambiguous_match: 1 },
            diagnosticCounts: {},
          },
          rows: [row],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onImportAsNew={onImportAsNew}
        onImport={() => {}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Import as new record — Adventure Zone",
      }),
    );
    expect(onImportAsNew).toHaveBeenCalledWith(row);
  });

  it("gives repeated row actions record-specific accessible names", () => {
    const rows: ReviewRow[] = ["Ada", "Grace"].map((name, index) => ({
      sourceRecordId: `source-${index}`,
      sourceVersionId: `version-${index}`,
      state: "awaiting_review",
      issueCodes: ["field_conflict", "ambiguous_match"],
      issues: [
        { code: "field_conflict", reason: "phone" },
        { code: "ambiguous_match" },
      ],
      conflicts: [
        { fieldName: "phone", localValue: "local", sourceValue: "Act" },
      ],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "contact",
      display: { name },
    }));
    render(
      <ImportReview
        safeOperationCount={0}
        archivedOnlyCount={2}
        canResolveAmbiguous
        review={{
          page: 1,
          pageSize: 25,
          total: 2,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 2,
            archivedOnly: 2,
            issueCounts: { field_conflict: 2, ambiguous_match: 2 },
            diagnosticCounts: {},
          },
          rows,
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onImportAsNew={() => {}}
        onImport={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Keep current value — Phone for Ada",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Keep current value — Phone for Grace",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import as new record — Ada" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Select Phone conflict for bulk review — Grace",
      }),
    ).toBeInTheDocument();
  });

  it("shows global issue filters, diagnostics, and only valid issue actions", () => {
    const onBulkDecision = vi.fn();
    const conflictRow: ReviewRow = {
      sourceRecordId: "conflict-1",
      sourceVersionId: "version-1",
      state: "awaiting_review",
      issueCodes: ["field_conflict"],
      issues: [{ code: "field_conflict", reason: "phone" }],
      conflicts: [
        {
          fieldName: "phone",
          localValue: "555-LOCAL",
          sourceValue: "555-ACT",
          target: { id: "local-organization", entityType: "organization", label: "Adventure Zone", detail: "Chicago, IL" },
          reviewToken: {
            sourceRecordId: "conflict-1", sourceVersionId: "version-1", fieldName: "phone",
            sourceValueFingerprint: "b".repeat(64), targetEntityType: "organization",
            targetEntityId: "local-organization", localValueFingerprint: "c".repeat(64),
          },
        },
        {
          fieldName: "email",
          localValue: "ada@local.test",
          sourceValue: "ada@act.test",
          target: { id: "local-organization", entityType: "organization", label: "Adventure Zone", detail: "Chicago, IL" },
          reviewToken: {
            sourceRecordId: "conflict-1", sourceVersionId: "version-1", fieldName: "email",
            sourceValueFingerprint: "d".repeat(64), targetEntityType: "organization",
            targetEntityId: "local-organization", localValueFingerprint: "e".repeat(64),
          },
        },
      ],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "company",
      display: { name: "Adventure Zone" },
    };
    const relationshipRow: ReviewRow = {
      sourceRecordId: "relationship-1",
      sourceVersionId: "version-2",
      state: "awaiting_review",
      issueCodes: ["relationship_unresolved"],
      issues: [{ code: "relationship_unresolved", reason: "Missing parent" }],
      conflicts: [],
      candidates: [],
      canImportStandalone: true,
      relationshipIssues: [{
        relationshipSlot: "timeline-parent",
        issueCode: "relationship_unresolved",
        reason: "Missing parent",
        expectedParentTypes: ["organization", "contact", "booking"],
        canImportStandalone: true,
      }],
      operationKeys: [],
      streamType: "activity",
      display: { subject: "Call Ada" },
    };
    const unsupportedRow: ReviewRow = {
      sourceRecordId: "unsupported-1",
      sourceVersionId: "version-3",
      state: "unsupported",
      issueCodes: ["unsupported_record"],
      issues: [{ code: "unsupported_record", reason: "Legacy record" }],
      conflicts: [],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "history",
      display: { name: "Legacy note" },
    };
    const ambiguousRow: ReviewRow = {
      sourceRecordId: "ambiguous-1",
      sourceVersionId: "version-4",
      state: "awaiting_review",
      issueCodes: ["ambiguous_match"],
      issues: [{ code: "ambiguous_match", reason: "Two matching contacts" }],
      conflicts: [],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "contact",
      display: { name: "Ada Lovelace" },
    };

    render(
      <ImportReview
        safeOperationCount={1}
        archivedOnlyCount={4}
        activeIssue={null}
        selectedKeys={new Set(["conflict-1:phone"])}
        assignmentTargetsByRow={{
          "ambiguous-1": [
            {
              id: "contact-ada",
              entityType: "contact",
              label: "Ada Lovelace",
              detail: "ada@example.com",
            },
          ],
        }}
        review={{
          page: 1,
          pageSize: 25,
          total: 4,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 4,
            archivedOnly: 4,
            issueCounts: {
              field_conflict: 12,
              relationship_unresolved: 2,
              ambiguous_match: 1,
              unsupported_record: 1,
            },
            diagnosticCounts: { unsupported_field: 50 },
          },
          rows: [conflictRow, relationshipRow, unsupportedRow, ambiguousRow],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onIssueChange={() => {}}
        onToggleSelection={() => {}}
        onKeepLocal={() => {}}
        onUseSource={() => {}}
        onIgnoreUnsupported={() => {}}
        onLinkExisting={() => {}}
        onImportAsNew={() => {}}
        onAssignParent={() => {}}
        onKeepUnlinked={() => {}}
        onBulkDecision={onBulkDecision}
        onImport={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Field conflicts (12)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("50 unsupported fields preserved in the archive"),
    ).toBeInTheDocument();
    expect(screen.getByText("Act value: 555-ACT")).toBeInTheDocument();
    expect(screen.getByText("Current value: 555-LOCAL")).toBeInTheDocument();
    expect(screen.getAllByText("Current organization: Adventure Zone (local-organization)")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", {
        name: /^Keep current value — (Phone|Email) for Adventure Zone$/,
      }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", {
        name: /^Use Act value — (Phone|Email) for Adventure Zone$/,
      }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", {
        name: "Keep archived and skip — Legacy note",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Assign parent — Call Ada" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Import without relationship — Call Ada",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Link existing record — Ada Lovelace",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Import as new record — Ada Lovelace",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /bulk link/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Select Email conflict for bulk review — Adventure Zone",
      }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Use Act value for 1 selected conflict",
      }),
    );
    expect(onBulkDecision).toHaveBeenCalledWith("use_source");
  });

  it("does not advertise parent or standalone actions without issue-specific relationship capabilities", () => {
    render(
      <ImportReview
        safeOperationCount={0}
        archivedOnlyCount={1}
        review={{
          page: 1,
          pageSize: 25,
          total: 1,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 1,
            archivedOnly: 1,
            issueCounts: { relationship_unresolved: 1 },
            diagnosticCounts: {},
          },
          rows: [{
            sourceRecordId: "unsupported-relationship",
            sourceVersionId: "unsupported-version",
            state: "awaiting_review",
            issueCodes: ["relationship_unresolved"],
            issues: [{ code: "relationship_unresolved", reason: "source_relationship_conflict" }],
            conflicts: [],
            candidates: [],
            canImportStandalone: true,
            operationKeys: [],
            streamType: "activity",
            display: { subject: "Conflicting call" },
          }],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onIssueChange={() => {}}
        onToggleSelection={() => {}}
        onIgnoreUnsupported={() => {}}
        onImportAsNew={() => {}}
        onAssignParent={() => {}}
        onKeepUnlinked={() => {}}
        onImport={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /Assign parent/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import without relationship/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: /Parent target/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Keep archived and skip relationship/ })).not.toBeInTheDocument();
  });

  it("keeps the selected parent bound to its exact relationship issue slot", () => {
    const onAssignParent = vi.fn();
    const row: ReviewRow = {
      sourceRecordId: "activity-source",
      sourceVersionId: "activity-version",
      state: "awaiting_review",
      issueCodes: ["relationship_unresolved"],
      issues: [{ code: "relationship_unresolved", reason: "Missing parents" }],
      conflicts: [],
      candidates: [],
      relationshipIssues: [
        {
          relationshipSlot: "primary-contact",
          issueCode: "relationship_unresolved",
          reason: "Missing primary contact",
          expectedParentTypes: ["contact"],
          canImportStandalone: true,
        },
        {
          relationshipSlot: "billing-contact",
          issueCode: "relationship_unresolved",
          reason: "Missing billing contact",
          expectedParentTypes: ["contact"],
          canImportStandalone: true,
        },
      ],
      canImportStandalone: true,
      operationKeys: [],
      streamType: "activity",
      display: { subject: "Call Ada" },
    };
    const contactTarget = {
      id: "contact-1",
      entityType: "contact" as const,
      label: "Ada Lovelace",
      detail: null,
    };

    render(
      <ImportReview
        safeOperationCount={0}
        archivedOnlyCount={1}
        review={{
          page: 1,
          pageSize: 25,
          total: 1,
          manifestDigest: "a".repeat(64),
          summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: { relationship_unresolved: 1 }, diagnosticCounts: {} },
          rows: [row],
        }}
        assignmentTargetsByRow={{ [row.sourceRecordId]: [contactTarget] }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onIssueChange={() => {}}
        onToggleSelection={() => {}}
        onIgnoreUnsupported={() => {}}
        onImportAsNew={() => {}}
        onAssignParent={onAssignParent}
        onKeepUnlinked={() => {}}
        onImport={() => {}}
      />,
    );

    const selectors = screen.getAllByRole("combobox", { name: /Parent target for Call Ada/ });
    fireEvent.change(selectors[1]!, { target: { value: contactTarget.id } });
    const assignButtons = screen.getAllByRole("button", { name: /Assign parent — Call Ada/ });
    fireEvent.click(assignButtons[1]!);

    expect(onAssignParent).toHaveBeenCalledWith(row, contactTarget, row.relationshipIssues?.[1]);
  });

  it("binds each relationship skip action to its exact issue when multiple blockers exist", () => {
    const onIgnoreUnsupported = vi.fn();
    const row: ReviewRow = {
      sourceRecordId: "activity-source",
      sourceVersionId: "activity-version",
      state: "awaiting_review",
      issueCodes: ["relationship_unresolved"],
      issues: [{ code: "relationship_unresolved", reason: "Missing parents" }],
      conflicts: [], candidates: [], canImportStandalone: false, operationKeys: [],
      relationshipIssues: [
        { relationshipSlot: "primary-contact", issueCode: "relationship_unresolved", reason: "Missing primary contact", expectedParentTypes: ["contact"], canImportStandalone: false },
        { relationshipSlot: "billing-contact", issueCode: "relationship_unresolved", reason: "Missing billing contact", expectedParentTypes: ["contact"], canImportStandalone: false },
      ],
      streamType: "activity",
      display: { subject: "Call Ada" },
    };
    render(
      <ImportReview
        safeOperationCount={0}
        archivedOnlyCount={1}
        review={{
          page: 1, pageSize: 25, total: 1, manifestDigest: "a".repeat(64),
          summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: { relationship_unresolved: 2 }, diagnosticCounts: {} },
          rows: [row],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onIgnoreUnsupported={onIgnoreUnsupported}
        onImportAsNew={() => {}}
        onImport={() => {}}
      />,
    );

    const skips = screen.getAllByRole("button", { name: /Keep archived and skip relationship/ });
    expect(skips).toHaveLength(2);
    fireEvent.click(skips[1]!);
    expect(onIgnoreUnsupported).toHaveBeenCalledWith(row, row.relationshipIssues?.[1]);
  });

  it("only exposes bulk selection for rows matching the server signature", () => {
    const invalidUnsupported: ReviewRow = {
      sourceRecordId: "unsupported-without-reason",
      sourceVersionId: "version-1",
      state: "unsupported",
      issueCodes: ["unsupported_record"],
      issues: [{ code: "unsupported_record" }],
      conflicts: [],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "history",
      display: { name: "Incomplete legacy record" },
    };
    const invalidRelationship: ReviewRow = {
      sourceRecordId: "relationship-without-target-type",
      sourceVersionId: "version-2",
      state: "awaiting_review",
      issueCodes: ["relationship_unresolved"],
      issues: [
        { code: "relationship_unresolved", reason: "Missing parent" },
      ],
      conflicts: [],
      candidates: [],
      canImportStandalone: true,
      operationKeys: [],
      streamType: "unknown_stream",
      display: { name: "Unknown relationship" },
    };

    render(
      <ImportReview
        safeOperationCount={0}
        archivedOnlyCount={2}
        canResolveAmbiguous
        review={{
          page: 1,
          pageSize: 25,
          total: 2,
          manifestDigest: "a".repeat(64),
          summary: {
            decisionRequired: 2,
            archivedOnly: 2,
            issueCounts: { unsupported_record: 1, relationship_unresolved: 1 },
            diagnosticCounts: {},
          },
          rows: [invalidUnsupported, invalidRelationship],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onImportAsNew={() => {}}
        onImport={() => {}}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: "Select this unsupported record for bulk review — Incomplete legacy record",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: "Select this relationship for bulk review — Unknown relationship",
      }),
    ).toBeDisabled();
  });

  it("shows strong-match evidence without duplicate-identity bulk controls", () => {
    const row: ReviewRow = {
      sourceRecordId: "recommended-company",
      sourceVersionId: "recommended-version",
      state: "awaiting_review",
      issueCodes: ["ambiguous_match"],
      issues: [{ code: "ambiguous_match" }],
      conflicts: [],
      candidates: [],
      canImportStandalone: false,
      operationKeys: [],
      streamType: "company",
      display: { name: "Adventure Zone" },
      recommendation: {
        action: "link_existing",
        target: { id: "organization-1", entityType: "organization", label: "Adventure Zone LLC", detail: "Chicago, IL" },
        confidence: "two_independent_clues",
        evidence: [
          { family: "identity", label: "Matching name" },
          { family: "archive_relationship", label: "Matching saved relationship" },
        ],
      },
    };

    render(
      <ImportReview
        safeOperationCount={0}
        archivedOnlyCount={1}
        review={{
          page: 1, pageSize: 25, total: 1, manifestDigest: "a".repeat(64),
          summary: { decisionRequired: 1, archivedOnly: 1, issueCounts: { ambiguous_match: 1 }, diagnosticCounts: {} },
          rows: [row],
        }}
        onSearch={() => {}}
        onPageChange={() => {}}
        onImportAsNew={() => {}}
        onImport={() => {}}
      />,
    );

    expect(screen.getByText("Matched from name + company relationship")).toBeInTheDocument();
    expect(screen.getByText(/Adventure Zone LLC/)).toHaveTextContent("Chicago, IL");
    expect(
      screen.queryByRole("checkbox", {
        name: "Select safe match for bulk review — Adventure Zone",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select all safe matches on this page" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept selected safe matches" }),
    ).not.toBeInTheDocument();
  });
});
