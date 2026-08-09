import { useMemo, useState, type FormEvent } from "react";
import type {
  AssignmentTarget,
  ReviewDisplayValue,
  ReviewIssueCode,
  ReviewPage,
  ReviewRow,
} from "@/features/act-replacement/act-replacement-client";

const safeDisplayFields = new Set([
  "name",
  "displayname",
  "title",
  "subject",
  "firstname",
  "lastname",
  "fullname",
  "company",
  "companyname",
  "jobtitle",
  "email",
  "phone",
  "website",
  "address",
  "address1",
  "address2",
  "city",
  "state",
  "region",
  "postalcode",
  "zipcode",
  "country",
  "opportunityname",
  "stage",
  "status",
  "estimatedclosedate",
  "description",
  "type",
  "starttime",
  "endtime",
  "occurredat",
  "regarding",
]);

const issueLabels: Record<ReviewIssueCode, string> = {
  ambiguous_match: "Ambiguous match",
  field_conflict: "Field conflicts",
  relationship_unresolved: "Relationship issues",
  unassigned: "Unassigned records",
  unsupported_record: "Unsupported records",
  unsupported_field: "Unsupported fields",
};

type BulkDecision =
  "keep_local" | "use_source" | "keep_unlinked" | "ignore_source";
export type SelectionKind =
  | "field_conflict"
  | "relationship"
  | "unsupported_record";

export type BulkSelectionSignature = {
  kind: SelectionKind;
  value: string;
  fieldName?: string;
};
type RelationshipIssue = NonNullable<ReviewRow["relationshipIssues"]>[number];

const assignmentTargetTypeByStream: Record<
  string,
  AssignmentTarget["entityType"]
> = {
  company: "organization",
  contact: "contact",
  opportunity: "booking",
  group: "calling_list",
  activity: "activity",
  note: "activity",
  history: "activity",
};

function readable(value: string) {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function displayValue(value: ReviewDisplayValue) {
  if (value === null) return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function recordLabel(row: ReviewRow) {
  const label = row.display.name ?? row.display.subject;
  return label === undefined || label === null
    ? readable(row.streamType ?? "record")
    : String(label);
}

function fieldSelectionKey(row: ReviewRow, fieldName: string) {
  return `${row.sourceRecordId}:${fieldName}`;
}

function rowSelectionKey(
  row: ReviewRow,
  kind: Exclude<SelectionKind, "field_conflict">,
) {
  return `${row.sourceRecordId}:${kind}`;
}

function relationshipIssue(row: ReviewRow) {
  return (row.issueCodes ?? []).some((code) =>
    ["relationship_unresolved", "unassigned"].includes(code),
  );
}

function actionableRelationshipIssue(row: ReviewRow) {
  return row.relationshipIssues?.length === 1 ? row.relationshipIssues[0] : undefined;
}

export function expectedAssignmentTargetType(row: ReviewRow) {
  return row.streamType
    ? assignmentTargetTypeByStream[row.streamType.trim().toLowerCase()]
    : undefined;
}

export function bulkSelectionSignature(
  row: ReviewRow,
  fieldName?: string,
  kindHint?: Exclude<SelectionKind, "field_conflict">,
): BulkSelectionSignature | null {
  if (fieldName) {
    const hasConflict = row.conflicts.some(
      (conflict) => conflict.fieldName === fieldName,
    );
    const hasMatchingIssue = row.issues.some(
      (issue) =>
        issue.code === "field_conflict" && issue.reason === fieldName,
    );
    return hasConflict && hasMatchingIssue
      ? { kind: "field_conflict", value: fieldName, fieldName }
      : null;
  }

  const unsupportedReasons = [
    ...new Set(
      row.issues
        .filter((issue) => issue.code === "unsupported_record")
        .map((issue) => issue.reason?.trim())
        .filter((reason): reason is string => Boolean(reason)),
    ),
  ];
  if (
    (!kindHint || kindHint === "unsupported_record") &&
    unsupportedReasons.length === 1 &&
    row.streamType?.trim() &&
    row.issueCodes.includes("unsupported_record")
  ) {
    return {
      kind: "unsupported_record",
      value: `${row.streamType}\u0000${unsupportedReasons[0]}`,
    };
  }

  const relationship = actionableRelationshipIssue(row);
  if (
    (!kindHint || kindHint === "relationship") &&
    relationship &&
    relationshipIssue(row)
  ) {
    return {
      kind: "relationship",
      value: `${relationship.expectedParentTypes.join(",")}\u0000${relationship.issueCode}\u0000${relationship.reason}`,
    };
  }

  return null;
}

export function ImportReview({
  safeOperationCount,
  reviewRequiredCount,
  review,
  loading = false,
  canImport = true,
  canResolveAmbiguous = true,
  importLabel = "Import safe records",
  activeIssue = null,
  selectedKeys = new Set<string>(),
  assignmentTargetsByRow = {},
  onSearch,
  onPageChange,
  onIssueChange = () => {},
  onToggleSelection = () => {},
  onKeepLocal = () => {},
  onUseSource = () => {},
  onIgnoreUnsupported = () => {},
  onLinkExisting = () => {},
  onImportAsNew,
  onAssignParent = () => {},
  onKeepUnlinked = () => {},
  onBulkDecision = () => {},
  onAssignmentTargetSearch = () => {},
  onAssignmentTargetClose = () => {},
  onImport,
  resolvingSourceRecordId = null,
}: {
  safeOperationCount: number;
  reviewRequiredCount: number;
  review: ReviewPage | null;
  loading?: boolean;
  canImport?: boolean;
  canResolveAmbiguous?: boolean;
  importLabel?: string;
  activeIssue?: ReviewIssueCode | null;
  selectedKeys?: ReadonlySet<string>;
  assignmentTargetsByRow?: Readonly<Record<string, readonly AssignmentTarget[]>>;
  onSearch: (search: string) => void;
  onPageChange: (page: number) => void;
  onIssueChange?: (issue: ReviewIssueCode | null) => void;
  onToggleSelection?: (
    row: ReviewRow,
    fieldName?: string,
    kind?: Exclude<SelectionKind, "field_conflict">,
  ) => void;
  onKeepLocal?: (row: ReviewRow, fieldName: string) => void;
  onUseSource?: (row: ReviewRow, fieldName: string) => void;
  onIgnoreUnsupported?: (row: ReviewRow, issue?: RelationshipIssue) => void;
  onLinkExisting?: (row: ReviewRow, target: AssignmentTarget) => void;
  onImportAsNew: (row: ReviewRow) => void;
  onAssignParent?: (row: ReviewRow, target: AssignmentTarget, issue: RelationshipIssue) => void;
  onKeepUnlinked?: (row: ReviewRow, issue: RelationshipIssue) => void;
  onBulkDecision?: (decision: BulkDecision) => void;
  onAssignmentTargetSearch?: (row: ReviewRow, search: string, entityTypes: AssignmentTarget["entityType"][]) => void;
  onAssignmentTargetClose?: (row: ReviewRow) => void;
  onImport: () => void;
  resolvingSourceRecordId?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [targetIds, setTargetIds] = useState<Record<string, string>>({});
  const summary = review?.summary ?? {
    decisionRequired: review?.total ?? 0,
    issueCounts: {},
    diagnosticCounts: {},
  };
  const totalPages = review
    ? Math.max(1, Math.ceil(review.total / review.pageSize))
    : 1;

  const selectedSignature = useMemo<BulkSelectionSignature | null>(() => {
    for (const row of review?.rows ?? []) {
      for (const conflict of row.conflicts ?? []) {
        if (selectedKeys.has(fieldSelectionKey(row, conflict.fieldName))) {
          const signature = bulkSelectionSignature(row, conflict.fieldName);
          if (signature) return signature;
        }
      }
      if (selectedKeys.has(rowSelectionKey(row, "relationship"))) {
        const signature = bulkSelectionSignature(row, undefined, "relationship");
        if (signature) return signature;
      }
      if (selectedKeys.has(rowSelectionKey(row, "unsupported_record"))) {
        const signature = bulkSelectionSignature(
          row,
          undefined,
          "unsupported_record",
        );
        if (signature) return signature;
      }
    }
    return null;
  }, [review?.rows, selectedKeys]);

  const selectedKind = selectedSignature?.kind ?? null;

  const selectedCount = useMemo(() => {
    let count = 0;
    for (const row of review?.rows ?? []) {
      for (const conflict of row.conflicts ?? []) {
        if (
          selectedKind === "field_conflict" &&
          selectedKeys.has(fieldSelectionKey(row, conflict.fieldName))
        )
          count += 1;
      }
      if (
        ((selectedKind === "relationship" &&
          selectedKeys.has(rowSelectionKey(row, "relationship"))) ||
          (selectedKind === "unsupported_record" &&
            selectedKeys.has(rowSelectionKey(row, "unsupported_record")))) &&
        ((selectedKind === "relationship" && relationshipIssue(row)) ||
          (selectedKind === "unsupported_record" &&
            (row.issueCodes ?? []).includes("unsupported_record")))
      ) {
        count += 1;
      }
    }
    return count;
  }, [review?.rows, selectedKeys, selectedKind]);

  const selectedRelationshipsCanImportStandalone = useMemo(
    () => {
      if (selectedKind !== "relationship") return true;
      return (
        (review?.rows ?? [])
          .filter(
            (row) =>
              selectedKeys.has(rowSelectionKey(row, "relationship")) &&
              relationshipIssue(row),
          )
          .every((row) => actionableRelationshipIssue(row)?.canImportStandalone === true)
      );
    },
    [review?.rows, selectedKeys, selectedKind, selectedSignature],
  );

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    onSearch(search.trim());
  };

  const rowTargets = (row: ReviewRow, entityTypes: readonly AssignmentTarget["entityType"][]) =>
    (assignmentTargetsByRow[row.sourceRecordId] ?? []).filter(
      (target) => entityTypes.includes(target.entityType),
    );
  const targetFor = (row: ReviewRow, entityTypes: readonly AssignmentTarget["entityType"][]) =>
    rowTargets(row, entityTypes).find(
      (target) => target.id === targetIds[row.sourceRecordId],
    );
  const canSelect = (
    row: ReviewRow,
    fieldName?: string,
    kind?: Exclude<SelectionKind, "field_conflict">,
  ) => {
    const signature = bulkSelectionSignature(row, fieldName, kind);
    return Boolean(
      signature &&
        (!selectedSignature ||
          (selectedSignature.kind === signature.kind &&
            selectedSignature.value === signature.value)),
    );
  };
  const targetPicker = (row: ReviewRow, label: string, entityTypes: AssignmentTarget["entityType"][]) => (
    <div className="grid w-full gap-2 sm:w-auto">
      <input
        type="search"
        aria-label={`Search existing records — ${label} target for ${recordLabel(row)}`}
        onChange={(event) => {
          const search = event.target.value;
          if (search.trim()) onAssignmentTargetSearch(row, search, entityTypes);
          else onAssignmentTargetClose(row);
        }}
        disabled={loading || !canResolveAmbiguous}
        placeholder="Search existing records"
        className="w-full rounded-lg border border-slate-300 px-3 py-3 text-sm"
      />
      <select
        aria-label={`Select an existing record — ${label} target for ${recordLabel(row)}`}
        value={targetIds[row.sourceRecordId] ?? ""}
        onChange={(event) =>
          setTargetIds((current) => ({
            ...current,
            [row.sourceRecordId]: event.target.value,
          }))
        }
        disabled={loading || !canResolveAmbiguous}
        className="w-full rounded-lg border border-slate-300 px-3 py-3 text-sm"
      >
        <option value="">Select an existing record</option>
        {rowTargets(row, entityTypes).map((target) => (
          <option key={target.id} value={target.id}>
            {target.label}
            {target.detail ? ` — ${target.detail}` : ""}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section
      className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
      aria-labelledby="act-import-review-heading"
    >
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
          Review
        </p>
        <h2
          id="act-import-review-heading"
          className="mt-1 text-xl font-semibold text-slate-900"
        >
          Check what can be imported safely
        </h2>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-900">
            {safeOperationCount.toLocaleString()} safe operations ready
          </p>
          <p className="mt-1 text-sm text-green-800">
            Only additions and empty-field updates are included.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">
            {reviewRequiredCount.toLocaleString()} records need your review
          </p>
          <p className="mt-1 text-sm text-amber-800">
            These records are kept out of automatic import.
          </p>
        </div>
      </div>

      <form
        role="search"
        onSubmit={submitSearch}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
          Search review records
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={loading}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
        >
          Search
        </button>
      </form>

      {review && Object.keys(summary.issueCounts).length > 0 && (
        <div aria-label="Review issue filters">
          <h3 className="text-sm font-semibold text-slate-800">
            Issue groups on this page
          </h3>
          <div className="mt-2 grid gap-2 sm:flex sm:flex-wrap">
            {Object.entries(summary.issueCounts).map(([issue, count]) => {
              const code = issue as ReviewIssueCode;
              return (
                <button
                  key={code}
                  type="button"
                  disabled={loading}
                  aria-pressed={activeIssue === code}
                  onClick={() =>
                    onIssueChange(activeIssue === code ? null : code)
                  }
                  className={`rounded-lg px-3 py-3 text-left text-sm font-semibold ${activeIssue === code ? "bg-orange-600 text-white" : "bg-amber-100 text-amber-900"}`}
                >
                  {issueLabels[code]} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {summary.diagnosticCounts.unsupported_field ? (
        <p className="text-sm text-slate-600">
          <span>
            Unsupported field (
            {summary.diagnosticCounts.unsupported_field.toLocaleString()})
          </span>{" "}
          {summary.diagnosticCounts.unsupported_field.toLocaleString()} unsupported
          fields preserved in the archive
        </p>
      ) : null}

      {selectedKind && selectedCount > 0 && (
        <div
          aria-label="Bulk review actions"
          className="rounded-lg border border-orange-200 bg-orange-50 p-4"
        >
          <p className="text-sm font-semibold text-orange-950">
            {selectedCount} selected {selectedKind.replace(/_/g, " ")}
            {selectedCount === 1 ? "" : "s"}
          </p>
          <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
            {selectedKind === "field_conflict" && (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onBulkDecision("keep_local")}
                  className="w-full rounded-lg border border-orange-300 bg-white px-4 py-3 text-sm font-semibold text-orange-900 disabled:opacity-50 sm:w-auto"
                >
                  Keep current value for {selectedCount} selected conflict
                  {selectedCount === 1 ? "" : "s"}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onBulkDecision("use_source")}
                  className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                >
                  Use Act value for {selectedCount} selected conflict
                  {selectedCount === 1 ? "" : "s"}
                </button>
              </>
            )}
            {selectedKind === "relationship" && (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onBulkDecision("ignore_source")}
                  className="w-full rounded-lg border border-orange-300 bg-white px-4 py-3 text-sm font-semibold text-orange-900 disabled:opacity-50 sm:w-auto"
                >
                  Keep archived and skip {selectedCount} selected relationship
                  {selectedCount === 1 ? "" : "s"}
                </button>
                {selectedRelationshipsCanImportStandalone && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onBulkDecision("keep_unlinked")}
                    className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                  >
                    Import without relationship for {selectedCount} selected
                    relationship{selectedCount === 1 ? "" : "s"}
                  </button>
                )}
              </>
            )}
            {selectedKind === "unsupported_record" && (
              <button
                type="button"
                disabled={loading}
                onClick={() => onBulkDecision("ignore_source")}
                className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
              >
                Keep archived and skip {selectedCount} selected unsupported
                record{selectedCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <p className="text-sm text-slate-600">Loading review records…</p>
        ) : review && review.rows.length > 0 ? (
          <ul className="space-y-3">
            {review.rows.map((row) => {
              const display = Object.entries(row.display).filter(([field]) =>
                safeDisplayFields.has(field.toLowerCase()),
              );
              const isResolving =
                resolvingSourceRecordId === row.sourceRecordId;
              const identityType = expectedAssignmentTargetType(row);
              const identityTarget = identityType ? targetFor(row, [identityType]) : undefined;
              return (
                <li
                  key={`${row.sourceRecordId}:${row.sourceVersionId}`}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {readable(row.streamType ?? "Act record")}
                    </p>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      {readable(row.state)}
                    </span>
                  </div>
                  {display.length > 0 ? (
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      {display.map(([field, value]) => (
                        <div key={field}>
                          <dt className="text-xs font-medium text-slate-500">
                            {readable(field)}
                          </dt>
                          <dd className="text-slate-800">
                            {displayValue(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">
                      No display details are available for this archived record.
                    </p>
                  )}
                  {(row.issues ?? []).map((issue) => (
                    <p
                      key={`${issue.code}:${issue.reason ?? ""}`}
                      className="mt-2 text-sm text-slate-600"
                    >
                      {issue.reason
                        ? `Reason: ${issue.reason}`
                        : readable(issue.code)}
                    </p>
                  ))}

                  {(row.conflicts ?? []).map((conflict) => (
                    <div
                      key={conflict.fieldName}
                      className="mt-4 rounded-lg bg-slate-50 p-3"
                    >
                      <p className="text-sm font-semibold text-slate-900">
                        {readable(conflict.fieldName)}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        Act value: {displayValue(conflict.sourceValue)}
                      </p>
                      <p className="text-sm text-slate-700">
                        Current value: {displayValue(conflict.localValue)}
                      </p>
                      {conflict.target && (
                        <p className="text-sm text-slate-700">
                          Current {conflict.target.entityType}: {conflict.target.label} ({conflict.target.id})
                        </p>
                      )}
                      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          aria-label={`Select ${readable(conflict.fieldName)} conflict for bulk review — ${recordLabel(row)}`}
                          checked={selectedKeys.has(
                            fieldSelectionKey(row, conflict.fieldName),
                          )}
                          disabled={
                            !canSelect(row, conflict.fieldName) ||
                            loading ||
                            !canResolveAmbiguous
                          }
                          onChange={() =>
                            onToggleSelection(row, conflict.fieldName)
                          }
                        />{" "}
                        Select {readable(conflict.fieldName)} conflict for bulk
                        review
                      </label>
                      {canResolveAmbiguous && (
                        <div className="mt-3 grid gap-2 sm:flex">
                          <button
                            type="button"
                            aria-label={`Keep current value — ${readable(conflict.fieldName)} for ${recordLabel(row)}`}
                            disabled={loading || isResolving}
                            onClick={() => onKeepLocal(row, conflict.fieldName)}
                            className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50 sm:w-auto"
                          >
                            Keep current value
                          </button>
                          <button
                            type="button"
                            aria-label={`Use Act value — ${readable(conflict.fieldName)} for ${recordLabel(row)}`}
                            disabled={loading || isResolving}
                            onClick={() => onUseSource(row, conflict.fieldName)}
                            className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                          >
                            Use Act value
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {canResolveAmbiguous &&
                    (row.issueCodes ?? []).includes("ambiguous_match") && (
                      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
                        {targetPicker(row, "Link", expectedAssignmentTargetType(row) ? [expectedAssignmentTargetType(row)!] : [])}
                        <button
                          type="button"
                          aria-label={`Link existing record — ${recordLabel(row)}`}
                          disabled={!identityTarget || loading || isResolving}
                          onClick={() => {
                            if (identityTarget) onLinkExisting(row, identityTarget);
                          }}
                          className="w-full rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900 disabled:opacity-50 sm:w-auto"
                        >
                          Link existing record
                        </button>
                        <button
                          type="button"
                          aria-label={
                            isResolving
                              ? `Saving decision… — ${recordLabel(row)}`
                              : `Import as new record — ${recordLabel(row)}`
                          }
                          disabled={loading || isResolving}
                          onClick={() => onImportAsNew(row)}
                          className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                        >
                          {isResolving
                            ? "Saving decision…"
                            : "Import as new record"}
                        </button>
                      </div>
                    )}

                  {canResolveAmbiguous && relationshipIssue(row) && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          aria-label={`Select this relationship for bulk review — ${recordLabel(row)}`}
                          checked={selectedKeys.has(rowSelectionKey(row, "relationship"))}
                          disabled={!canSelect(row, undefined, "relationship") || loading}
                          onChange={() => onToggleSelection(row, undefined, "relationship")}
                        />{" "}
                        Select this relationship for bulk review
                      </label>
                      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
                        {(row.relationshipIssues ?? []).map((relationship) => {
                          const target = targetFor(row, relationship.expectedParentTypes);
                          return (
                            <div key={relationship.relationshipSlot} className="grid gap-2 sm:flex sm:flex-wrap">
                              {relationship.expectedParentTypes.length > 0 && (
                                <>
                                  {targetPicker(row, "Parent", relationship.expectedParentTypes)}
                                  <button
                                    type="button"
                                    aria-label={`Assign parent — ${recordLabel(row)}`}
                                    disabled={!target || loading || isResolving}
                                    onClick={() => target && onAssignParent(row, target, relationship)}
                                    className="w-full rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-900 disabled:opacity-50 sm:w-auto"
                                  >
                                    Assign parent
                                  </button>
                                </>
                              )}
                              {relationship.canImportStandalone && (
                                <button
                                  type="button"
                                  aria-label={`Import without relationship — ${recordLabel(row)}`}
                                  disabled={loading || isResolving}
                                  onClick={() => onKeepUnlinked(row, relationship)}
                                  className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
                                >
                                  Import without relationship
                                </button>
                              )}
                              <button
                                type="button"
                                aria-label={`Keep archived and skip relationship — ${recordLabel(row)}`}
                                disabled={loading || isResolving}
                                onClick={() => onIgnoreUnsupported(row, relationship)}
                                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50 sm:w-auto"
                              >
                                Keep archived and skip relationship
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {canResolveAmbiguous &&
                    (row.issueCodes ?? []).includes("unsupported_record") && (
                      <div className="mt-4 rounded-lg bg-slate-50 p-3">
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            aria-label={`Select this unsupported record for bulk review — ${recordLabel(row)}`}
                            checked={selectedKeys.has(rowSelectionKey(row, "unsupported_record"))}
                            disabled={
                              !canSelect(row, undefined, "unsupported_record") || loading
                            }
                            onChange={() => onToggleSelection(row, undefined, "unsupported_record")}
                          />{" "}
                          Select this unsupported record for bulk review
                        </label>
                        <button
                          type="button"
                          aria-label={`Keep archived and skip — ${recordLabel(row)}`}
                          disabled={loading || isResolving}
                          onClick={() => onIgnoreUnsupported(row)}
                          className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50 sm:w-auto"
                        >
                          Keep archived and skip
                        </button>
                      </div>
                    )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No review records match this view.
          </p>
        )}
      </div>

      {review && review.total > 0 && (
        <nav
          aria-label="Review pagination"
          className="flex items-center justify-between gap-3"
        >
          <button
            type="button"
            aria-label="Previous review page"
            disabled={review.page <= 1 || loading}
            onClick={() => onPageChange(review.page - 1)}
            className="rounded-lg border border-slate-300 px-3 py-3 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-sm text-slate-600">
            Page {review.page} of {totalPages}
          </p>
          <button
            type="button"
            aria-label="Next review page"
            disabled={review.page >= totalPages || loading}
            onClick={() => onPageChange(review.page + 1)}
            className="rounded-lg border border-slate-300 px-3 py-3 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}

      {safeOperationCount > 0 && (
        <button
          type="button"
          disabled={!canImport}
          onClick={onImport}
          className="w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {importLabel}
        </button>
      )}
    </section>
  );
}
