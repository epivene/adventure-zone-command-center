import { useCallback, useEffect, useRef, useState } from "react";
import { ExtractionProgress } from "@/components/act-replacement/extraction-progress";
import {
  bulkSelectionSignature,
  ImportReview,
  type BulkSelectionSignature,
} from "@/components/act-replacement/import-review";
import { ImportSummary } from "@/components/act-replacement/import-summary";
import {
  ACT_PAGE_SIZES,
  applyNext,
  approveSafeDefaults,
  assignReviewParent,
  bulkDecideReviewRecords,
  decideReviewRecord,
  getAssignmentTargets,
  getLatestRun,
  getReview,
  getRun,
  organizeRun,
  resumeRun,
  startRun,
  supersedeRun,
  type ActPageSize,
  type ActReplacementWorkflowStatus,
  type AssignmentTarget,
  type BulkReviewDecisionRequest,
  type BulkReviewSelection,
  type ReviewIssueCode,
  type ReviewPage,
  type ReviewRow,
} from "@/features/act-replacement/act-replacement-client";
import {
  APPLY_BATCH_SIZE,
  applyNextWithTransientRecovery,
} from "@/features/act-replacement/safe-import-recovery";

const stages = ["Fetch", "Organize", "Review", "Import", "Finish"] as const;

type SessionTotals = {
  applied: number;
  alreadyPresent: number;
  blocked: number;
  failed: number;
};

const emptyTotals: SessionTotals = {
  applied: 0,
  alreadyPresent: 0,
  blocked: 0,
  failed: 0,
};

type ReviewSelection = {
  row: ReviewRow;
  fieldName?: string;
  signature: BulkSelectionSignature;
};

type BulkDecisionChoice =
  | "keep_local"
  | "use_source"
  | "keep_unlinked"
  | "ignore_source";

type BulkConfirmation = {
  runId: string;
  decision: "use_source";
  count: number;
  fieldName: string;
  manifestDigest: string;
  requestKey: string;
  selections: BulkReviewSelection[];
};

type ImportConfirmation = {
  runId: string;
  manifestDigest: string;
  requestKey: string;
  approvedOperationCount: number;
  retryFailed: boolean;
};

function isFinished(phase: ActReplacementWorkflowStatus["phase"]) {
  return ["complete", "complete_with_issues", "failed", "superseded"].includes(
    phase,
  );
}

function activeStage(
  run: ActReplacementWorkflowStatus | null,
  applying: boolean,
) {
  if (applying) return 3;
  if (!run || run.phase === "extracting" || run.phase === "superseded")
    return 0;
  if (run.phase === "extract_complete" || run.phase === "organizing") return 1;
  if (run.phase === "ready_to_apply") return 2;
  if (run.phase === "applying") return 3;
  return 4;
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.message : null;
}

function safeImportRequestKey(
  run: ActReplacementWorkflowStatus,
  retryFailed: boolean,
) {
  const mode = retryFailed ? "retry" : "apply";
  return [
    "act-safe",
    run.runId,
    run.manifestDigest,
    mode,
    run.safeOperationCount,
    run.appliedOperationCount,
    run.alreadyPresentOperationCount,
    run.failedOperationCount,
  ].join("-");
}

function StageProgress({ active }: { active: number }) {
  return (
    <nav aria-label="Act import stages" className="mt-6">
      <ol className="grid grid-cols-5 gap-1">
        {stages.map((stage, index) => (
          <li
            key={stage}
            aria-current={index === active ? "step" : undefined}
            className={`rounded-lg px-2 py-2 text-center text-xs font-semibold sm:text-sm ${
              index === active
                ? "bg-orange-600 text-white"
                : index < active
                  ? "bg-green-100 text-green-800"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            {stage}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function ActMigrationPage() {
  const [run, setRun] = useState<ActReplacementWorkflowStatus | null>(null);
  const [pageSize, setPageSize] = useState<ActPageSize>(100);
  const [review, setReview] = useState<ReviewPage | null>(null);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewSearch, setReviewSearch] = useState("");
  const [activeIssue, setActiveIssue] = useState<ReviewIssueCode | null>(null);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [assignmentTargetsByRow, setAssignmentTargetsByRow] = useState<
    Record<string, AssignmentTarget[]>
  >({});
  const [reviewSelections, setReviewSelections] = useState<
    Map<string, ReviewSelection>
  >(new Map());
  const [bulkConfirmation, setBulkConfirmation] =
    useState<BulkConfirmation | null>(null);
  const [resolvingSourceRecordId, setResolvingSourceRecordId] = useState<
    string | null
  >(null);
  const [busy, setBusy] = useState<
    "fetch" | "organize" | "apply" | "review" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [importConfirmation, setImportConfirmation] =
    useState<ImportConfirmation | null>(null);
  const [applyLocked, setApplyLocked] = useState(false);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [sessionTotals, setSessionTotals] =
    useState<SessionTotals>(emptyTotals);
  const reviewRequestToken = useRef(0);
  const targetSearchTokens = useRef(new Map<string, number>());
  const targetSearchSequence = useRef(0);
  const busyRef = useRef<typeof busy>(null);
  const modalReturnFocus = useRef<HTMLElement | null>(null);
  const bulkConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const importConfirmButtonRef = useRef<HTMLButtonElement | null>(null);

  const invalidateAssignmentTargets = useCallback(() => {
    targetSearchTokens.current.clear();
    setAssignmentTargetsByRow({});
    setError(null);
  }, []);

  useEffect(() => {
    let current = true;
    void getLatestRun()
      .then((result) => {
        if (current) setRun(result.run);
      })
      .catch((caught) => {
        if (current)
          setError(errorCode(caught) ?? "Could not load import status");
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!run || !["extracting", "organizing"].includes(run.phase)) return;
    const runId = run.runId;
    let current = true;
    let polling = false;
    const poll = setInterval(() => {
      if (polling) return;
      polling = true;
      void getRun(runId)
        .then((result) => {
          if (current) {
            setRun(result.run);
            setError(null);
          }
        })
        .catch((caught) => {
          if (current)
            setError(errorCode(caught) ?? "Could not refresh import status");
        })
        .finally(() => {
          polling = false;
        });
    }, 3000);
    return () => {
      current = false;
      clearInterval(poll);
    };
  }, [run?.phase, run?.runId]);

  useEffect(() => {
    if (!run?.manifestDigest) {
      reviewRequestToken.current += 1;
      setReview(null);
      setReviewSelections(new Map());
      invalidateAssignmentTargets();
      return;
    }
    const requestToken = ++reviewRequestToken.current;
    invalidateAssignmentTargets();
    setReviewLoading(true);
    void getReview(run.runId, {
      page: reviewPage,
      pageSize: 25,
      search: reviewSearch,
      state: "needs_review",
      ...(activeIssue ? { issue: activeIssue } : {}),
    })
      .then((result) => {
        if (requestToken !== reviewRequestToken.current) return;
        const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
        if (reviewPage > lastPage) {
          setReviewPage(lastPage);
          setReviewSelections(new Map());
          return;
        }
        setReview(result);
        const validKeys = new Set<string>();
        for (const row of result.rows) {
          for (const conflict of row.conflicts ?? []) {
            if (bulkSelectionSignature(row, conflict.fieldName)) {
              validKeys.add(`${row.sourceRecordId}:${conflict.fieldName}`);
            }
          }
          if (bulkSelectionSignature(row, undefined, "relationship")) {
            validKeys.add(`${row.sourceRecordId}:relationship`);
          }
          if (bulkSelectionSignature(row, undefined, "unsupported_record")) {
            validKeys.add(`${row.sourceRecordId}:unsupported_record`);
          }
        }
        setReviewSelections(
          (current) =>
            new Map([...current].filter(([key]) => validKeys.has(key))),
        );
      })
      .catch((caught) => {
        if (requestToken === reviewRequestToken.current)
          setError(errorCode(caught) ?? "Could not load review records");
      })
      .finally(() => {
        if (requestToken === reviewRequestToken.current) setReviewLoading(false);
      });
  }, [
    run?.manifestDigest,
    run?.runId,
    reviewPage,
    reviewRefreshKey,
    reviewSearch,
    activeIssue,
    invalidateAssignmentTargets,
  ]);

  const refreshRun = async (runId: string) => {
    const result = await getRun(runId);
    setRun(result.run);
    return result.run;
  };

  const staleReviewMessage = (caught: unknown, fallback: string) => {
    if (
      caught &&
      typeof caught === "object" &&
      "status" in caught &&
      (caught as { status?: unknown }).status === 409
    ) {
      return "The review changed; reload and try again.";
    }
    return errorCode(caught) ?? fallback;
  };

  const beginBusy = (nextBusy: NonNullable<typeof busy>) => {
    if (busyRef.current !== null) return false;
    busyRef.current = nextBusy;
    setBusy(nextBusy);
    return true;
  };

  const endBusy = () => {
    busyRef.current = null;
    setBusy(null);
  };

  useEffect(() => {
    const activeModal = bulkConfirmation ? "bulk" : importConfirmation ? "import" : null;
    if (!activeModal) return;
    modalReturnFocus.current = document.activeElement as HTMLElement | null;
    (activeModal === "bulk"
      ? bulkConfirmButtonRef.current
      : importConfirmButtonRef.current
    )?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeModal === "bulk") setBulkConfirmation(null);
        else setImportConfirmation(null);
      }
      if (event.key === "Tab") {
        const dialog = document.querySelector<HTMLElement>(
          activeModal === "bulk"
            ? '[aria-labelledby="confirm-act-overwrite-heading"]'
            : '[aria-labelledby="confirm-safe-import-heading"]',
        );
        const focusable = dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      modalReturnFocus.current?.focus();
    };
  }, [bulkConfirmation, importConfirmation]);

  const reviewSelectionKey = (selection: ReviewSelection) =>
    selection.fieldName
      ? `${selection.row.sourceRecordId}:${selection.fieldName}`
      : `${selection.row.sourceRecordId}:${selection.signature.kind}`;

  const refreshAfterReviewCommand = async (runId: string) => {
    await refreshRun(runId);
    setReviewRefreshKey((current) => current + 1);
  };

  const runStatusAction = async (
    action: () => Promise<{ run: ActReplacementWorkflowStatus }>,
  ) => {
    setBusy("fetch");
    setError(null);
    try {
      setRun((await action()).run);
    } catch (caught) {
      setError(errorCode(caught) ?? "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const start = () => void runStatusAction(() => startRun(pageSize));

  const startOver = () => {
    if (window.prompt("Type START OVER to confirm") === "START OVER" && run) {
      void runStatusAction(() => supersedeRun(run.runId));
    }
  };

  const organize = async () => {
    if (!run) return;
    setBusy("organize");
    setError(null);
    try {
      await organizeRun(run.runId);
      await refreshRun(run.runId);
      setReviewPage(1);
    } catch (caught) {
      setError(errorCode(caught) ?? "Could not organize fetched records");
    } finally {
      setBusy(null);
    }
  };

  const prepareSafeImport = async (retryFailed = false) => {
    if (!run?.manifestDigest || applyLocked || !beginBusy("apply")) return;
    setError(null);
    try {
      const requestKey = safeImportRequestKey(run, retryFailed);
      const approval = await approveSafeDefaults(
        run.runId,
        run.manifestDigest,
        requestKey,
      );
      if (
        approval.manifestDigest !== run.manifestDigest ||
        approval.approvedOperationCount !== run.safeOperationCount
      ) {
        throw Object.assign(new Error("review_changed"), { status: 409 });
      }
      setImportConfirmation({
        runId: run.runId,
        manifestDigest: approval.manifestDigest,
        requestKey,
        approvedOperationCount: approval.approvedOperationCount,
        retryFailed,
      });
    } catch (caught) {
      setError(staleReviewMessage(caught, "Could not prepare safe import"));
    } finally {
      endBusy();
    }
  };

  const importAmbiguousAsNew = async (row: ReviewRow) => {
    if (!run?.canReview || resolvingSourceRecordId || !beginBusy("review")) {
      return;
    }
    setResolvingSourceRecordId(row.sourceRecordId);
    setError(null);
    try {
      await decideReviewRecord(run.runId, row.sourceRecordId, {
        sourceVersionId: row.sourceVersionId,
        scope: "duplicate_identity",
        decision: "keep_separate",
      });
      await refreshAfterReviewCommand(run.runId);
    } catch (caught) {
      setError(staleReviewMessage(caught, "Could not save the review decision"));
    } finally {
      setResolvingSourceRecordId(null);
      endBusy();
    }
  };

  const importSafeRecords = async (confirmation: ImportConfirmation) => {
    if (!run || !beginBusy("apply")) return;
    setImportConfirmation(null);
    setError(null);
    setNeedsAttention(false);
    const totals: SessionTotals = {
      applied: run.appliedOperationCount,
      alreadyPresent: run.alreadyPresentOperationCount,
      blocked: run.blockedOperationCount,
      failed: run.failedOperationCount,
    };
    setSessionTotals(totals);
    try {
      let cursor = 0;
      setRun((current) =>
        current ? { ...current, phase: "applying" } : current,
      );
      for (;;) {
        const result = await applyNextWithTransientRecovery({
          apply: () =>
            applyNext(confirmation.runId, {
              expectedManifestDigest: confirmation.manifestDigest,
              approvalRequestKey: confirmation.requestKey,
              batchSize: APPLY_BATCH_SIZE,
              ...(confirmation.retryFailed ? { retryFailed: true } : {}),
            }),
          refreshCursor: async () =>
            (await refreshRun(confirmation.runId)).nextApplyCursor,
          onRefreshedCursor: (durableCursor) => {
            cursor = Math.max(cursor, durableCursor);
            setError(null);
          },
        });
        totals.applied += result.batch.completedCount;
        totals.alreadyPresent += result.batch.alreadyPresentCount;
        totals.blocked += result.batch.blockedCount;
        totals.failed += result.batch.failedCount;
        setSessionTotals({ ...totals });
        if (result.requiresReview) {
          setNeedsAttention(true);
          await refreshRun(confirmation.runId);
          return;
        }
        if (!result.hasMore) {
          await refreshRun(confirmation.runId);
          return;
        }
        if (result.nextCursor <= cursor) throw new Error("apply_cursor_stalled");
        cursor = result.nextCursor;
      }
    } catch (caught) {
      if (errorCode(caught) === "act_apply_disabled") {
        setApplyLocked(true);
        setError("Live import is still safely locked on the server");
      } else {
        setError(staleReviewMessage(caught, "Safe import could not continue"));
      }
    } finally {
      endBusy();
    }
  };

  const saveDecision = async (
    row: ReviewRow,
    body: Parameters<typeof decideReviewRecord>[2],
  ) => {
    if (!run?.canReview || !beginBusy("review")) return;
    setResolvingSourceRecordId(row.sourceRecordId);
    setError(null);
    try {
      await decideReviewRecord(run.runId, row.sourceRecordId, body);
      await refreshAfterReviewCommand(run.runId);
    } catch (caught) {
      setError(
        staleReviewMessage(caught, "Could not save the review decision"),
      );
    } finally {
      setResolvingSourceRecordId(null);
      endBusy();
    }
  };

  const saveAssignment = async (
    row: ReviewRow,
    target: AssignmentTarget,
    relationship: NonNullable<ReviewRow["relationshipIssues"]>[number],
  ) => {
    const currentRelationship = row.relationshipIssues?.find((issue) =>
      issue.relationshipSlot === relationship.relationshipSlot,
    );
    if (
      !run?.canReview ||
      !currentRelationship?.expectedParentTypes.includes(target.entityType) ||
      !beginBusy("review")
    )
      return;
    setResolvingSourceRecordId(row.sourceRecordId);
    setError(null);
    try {
      await assignReviewParent(run.runId, row, target, currentRelationship);
      await refreshAfterReviewCommand(run.runId);
    } catch (caught) {
      setError(
        staleReviewMessage(caught, "Could not save the parent assignment"),
      );
    } finally {
      setResolvingSourceRecordId(null);
      endBusy();
    }
  };

  const toggleSelection = (
    row: ReviewRow,
    fieldName?: string,
    kindHint?: "relationship" | "unsupported_record",
  ) => {
    if (busyRef.current !== null) return;
    const signature = bulkSelectionSignature(row, fieldName, kindHint);
    if (!signature) return;
    const selection: ReviewSelection = { row, fieldName, signature };
    const key = reviewSelectionKey(selection);
    setReviewSelections((current) => {
      if (current.has(key)) {
        const next = new Map(current);
        next.delete(key);
        return next;
      }
      const selectedSignature = current.values().next().value
        ?.signature as BulkSelectionSignature | undefined;
      return selectedSignature &&
        (selectedSignature.kind !== signature.kind ||
          selectedSignature.value !== signature.value)
        ? new Map([[key, selection]])
        : new Map(current).set(key, selection);
    });
  };

  const bulkRequestFor = (
    selections: readonly ReviewSelection[],
    decision: BulkDecisionChoice,
    manifestDigest: string,
    requestKey = crypto.randomUUID(),
  ): BulkReviewDecisionRequest | null => {
    const first = selections[0];
    if (
      !first ||
      selections.some(
        (selection) =>
          selection.signature.kind !== first.signature.kind ||
          selection.signature.value !== first.signature.value,
      )
    ) {
      return null;
    }
    const selectionPayload = selections.map(({ row }) => ({
      sourceRecordId: row.sourceRecordId,
      sourceVersionId: row.sourceVersionId,
    }));
    if (first.signature.kind === "field_conflict" && first.fieldName) {
      const reviewedSelections = selections.map(({ row }) => {
        const reviewToken = row.conflicts.find((conflict) => conflict.fieldName === first.fieldName)?.reviewToken;
        return {
          sourceRecordId: row.sourceRecordId,
          sourceVersionId: row.sourceVersionId,
          ...(decision === "use_source" && reviewToken ? { reviewToken } : {}),
        };
      });
      if (decision === "use_source" && reviewedSelections.some((selection) => !selection.reviewToken)) return null;
      return {
        expectedManifestDigest: manifestDigest,
        requestKey,
        selections: reviewedSelections,
        scope: "field_conflict",
        decision: decision === "use_source" ? "use_source" : "keep_local",
        fieldName: first.fieldName,
      };
    }
    if (first.signature.kind === "relationship") {
      if (
        decision === "keep_unlinked" &&
        selections.some((selection) => selection.row.relationshipIssues?.length !== 1 || !selection.row.relationshipIssues[0]?.canImportStandalone)
      ) {
        return null;
      }
      return {
        expectedManifestDigest: manifestDigest,
        requestKey,
        selections: selectionPayload,
        scope: "relationship",
        decision:
          decision === "keep_unlinked" ? "keep_unlinked" : "ignore_source",
        fieldName: null,
      };
    }
    if (first.signature.kind === "unsupported_record") {
      return {
        expectedManifestDigest: manifestDigest,
        requestKey,
        selections: selectionPayload,
        scope: "unsupported_record",
        decision: "ignore_source",
        fieldName: null,
      };
    }
    return null;
  };

  const saveBulkDecision = async (
    decision: BulkDecisionChoice,
    snapshot?: BulkConfirmation,
  ) => {
    if (!run?.canReview || !run.manifestDigest || !beginBusy("review")) return;
    const body = snapshot
      ? {
          expectedManifestDigest: snapshot.manifestDigest,
          requestKey: snapshot.requestKey,
          selections: snapshot.selections,
          scope: "field_conflict" as const,
          decision: snapshot.decision,
          fieldName: snapshot.fieldName,
        }
      : bulkRequestFor(
          [...reviewSelections.values()],
          decision,
          run.manifestDigest,
        );
    if (!body) {
      setReviewSelections(new Map());
      endBusy();
      return;
    }
    setError(null);
    try {
      await bulkDecideReviewRecords(run.runId, body);
      await refreshAfterReviewCommand(run.runId);
    } catch (caught) {
      setError(
        staleReviewMessage(caught, "Could not save the bulk review decision"),
      );
    } finally {
      endBusy();
    }
  };

  const reviewIssues = async () => {
    if (!run) return;
    setBusy("review");
    setError(null);
    try {
      await refreshRun(run.runId);
      setReviewPage(1);
      setReviewSearch("");
      setNeedsAttention(false);
    } catch (caught) {
      setError(errorCode(caught) ?? "Could not refresh review status");
    } finally {
      setBusy(null);
    }
  };

  const stage = activeStage(run, busy === "apply");
  const canStart = !run || isFinished(run.phase);
  const showReview = Boolean(run?.manifestDigest);
  const showSummary = Boolean(
    run?.manifestDigest &&
    (stage >= 3 ||
      run.appliedOperationCount > 0 ||
      run.blockedOperationCount > 0 ||
      run.failedOperationCount > 0),
  );
  const appliedTotal = Math.max(
    run?.appliedOperationCount ?? 0,
    sessionTotals.applied,
  );
  const blockedTotal = Math.max(
    run?.blockedOperationCount ?? 0,
    sessionTotals.blocked,
  );
  const failedTotal = Math.max(
    run?.failedOperationCount ?? 0,
    sessionTotals.failed,
  );
  const alreadyPresentTotal = Math.max(
    run?.alreadyPresentOperationCount ?? 0,
    sessionTotals.alreadyPresent,
  );
  const durableNeedsAttention = Boolean(
    run?.phase === "complete_with_issues" &&
    (run.blockedOperationCount > 0 || run.failedOperationCount > 0),
  );
  const requiresAttention = needsAttention || durableNeedsAttention;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-12">
      <div inert={bulkConfirmation !== null || importConfirmation !== null}>
      <h1 className="mt-8 text-2xl font-bold text-slate-900">
        Import everything from Act!
      </h1>
      <p className="mt-2 text-slate-600">
        Automatic review uses the saved archive, followed by a separate safe
        import. Uncertain data stays preserved in the archive.
      </p>

      <StageProgress active={stage} />

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {run && (
        <ExtractionProgress
          status={run}
          onResume={() => void runStatusAction(() => resumeRun(run.runId))}
          onStartOver={startOver}
        />
      )}

      {run?.canOrganize && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-orange-700">
            Organize
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">
            {run.phase === "extract_complete"
              ? "Automatically review the fetched archive"
              : "Automatically review the saved archive"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            This uses saved context clues to prepare a safe import without changing any profile.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void organize()}
            className="mt-4 w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "organize"
              ? "Organizing…"
              : run.phase === "extract_complete"
                ? "Auto-review fetched archive"
                : "Auto-review saved archive"}
          </button>
        </section>
      )}

      {showReview && run && (
        <ImportReview
          autoResolvedCount={run.autoResolvedCount}
          safeOperationCount={run.safeOperationCount}
          archivedOnlyCount={run.archivedOnlyCount}
          review={review}
          loading={
            reviewLoading ||
            busy !== null ||
            bulkConfirmation !== null ||
            importConfirmation !== null
          }
          canResolveAmbiguous={run.canReview}
          activeIssue={activeIssue}
          selectedKeys={new Set(reviewSelections.keys())}
          assignmentTargetsByRow={assignmentTargetsByRow}
          onAssignmentTargetSearch={(row, search, entityTypes) => {
            if (!entityTypes.length || busyRef.current !== null) return;
            const requestToken = ++targetSearchSequence.current;
            targetSearchTokens.current.set(row.sourceRecordId, requestToken);
            setError(null);
            setAssignmentTargetsByRow((current) => {
              const { [row.sourceRecordId]: _discarded, ...remaining } = current;
              return remaining;
            });
            void getAssignmentTargets({ search, entityTypes })
              .then((result) => {
                const targets = result.targets;
                if (
                  targetSearchTokens.current.get(row.sourceRecordId) ===
                  requestToken
                ) {
                  setAssignmentTargetsByRow((current) => ({
                    ...current,
                    [row.sourceRecordId]: targets.filter(
                      (target) => entityTypes.includes(target.entityType),
                    ),
                  }));
                }
              })
              .catch((caught) => {
                if (
                  targetSearchTokens.current.get(row.sourceRecordId) ===
                  requestToken
                ) {
                  setError(
                    errorCode(caught) ?? "Could not search assignment targets",
                  );
                }
              });
          }}
          onAssignmentTargetClose={(row) => {
            const requestToken = ++targetSearchSequence.current;
            targetSearchTokens.current.set(row.sourceRecordId, requestToken);
            setError(null);
            setAssignmentTargetsByRow((current) => {
              const { [row.sourceRecordId]: _discarded, ...remaining } = current;
              return remaining;
            });
          }}
          canImport={
            run.canApplySafe &&
            busy === null &&
            !applyLocked &&
            !requiresAttention
          }
          importLabel={
            run.phase === "applying" || run.nextApplyCursor > 0
              ? "Resume safe import"
              : "Import safe records"
          }
          onSearch={(search) => {
            setReviewPage(1);
            setReviewSearch(search);
            setReviewSelections(new Map());
          }}
          onPageChange={(page) => {
            setReviewPage(page);
            setReviewSelections(new Map());
          }}
          onIssueChange={(issue) => {
            setActiveIssue(issue);
            setReviewPage(1);
            setReviewSelections(new Map());
          }}
          onToggleSelection={toggleSelection}
          onKeepLocal={(row, fieldName) =>
            void saveDecision(row, {
              sourceVersionId: row.sourceVersionId,
              scope: "field_conflict",
              decision: "keep_local",
              fieldName,
            })
          }
          onUseSource={(row, fieldName) => {
            const reviewToken = row.conflicts.find((conflict) => conflict.fieldName === fieldName)?.reviewToken;
            if (!reviewToken) return;
            void saveDecision(row, {
              sourceVersionId: row.sourceVersionId,
              scope: "field_conflict",
              decision: "use_source",
              fieldName,
              reviewToken,
            });
          }}
          onIgnoreUnsupported={(row, relationship) =>
            void saveDecision(row, {
              sourceVersionId: row.sourceVersionId,
              scope: relationship ? "relationship" : "unsupported_record",
              decision: "ignore_source",
              ...(relationship ? { relationshipSlot: relationship.relationshipSlot } : {}),
            })
          }
          onLinkExisting={(row, target) =>
            void saveDecision(row, {
              sourceVersionId: row.sourceVersionId,
              scope: "duplicate_identity",
              decision: "link_existing",
              targetEntityType: target.entityType,
              targetEntityId: target.id,
            })
          }
          onImportAsNew={(row) => void importAmbiguousAsNew(row)}
          onAssignParent={(row, target, relationship) => void saveAssignment(row, target, relationship)}
          onKeepUnlinked={(row, relationship) => {
            if (!relationship?.canImportStandalone) return;
            void saveDecision(row, {
              sourceVersionId: row.sourceVersionId,
              scope: "relationship",
              decision: "keep_unlinked",
              relationshipSlot: relationship.relationshipSlot,
              targetEntityType: relationship.expectedParentTypes.length === 1
                ? relationship.expectedParentTypes[0]
                : null,
            });
          }}
          onBulkDecision={(decision) => {
            if (decision === "use_source") {
              if (!run.manifestDigest) return;
              const request = bulkRequestFor(
                [...reviewSelections.values()],
                decision,
                run.manifestDigest,
              );
              if (!request || request.scope !== "field_conflict") {
                setReviewSelections(new Map());
                return;
              }
              setBulkConfirmation({
                runId: run.runId,
                decision,
                count: request.selections.length,
                fieldName: request.fieldName,
                manifestDigest: request.expectedManifestDigest,
                requestKey: request.requestKey,
                selections: request.selections.map((selection) => ({ ...selection })),
              });
              return;
            }
            void saveBulkDecision(decision);
          }}
          resolvingSourceRecordId={resolvingSourceRecordId}
          onImport={() => {
            void prepareSafeImport(false);
          }}
        />
      )}

      {requiresAttention && (
        <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">
            Automatic import stopped safely
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            A blocked or failed operation needs review before another attempt.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void reviewIssues()}
            className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
          >
            Review issues before retrying
          </button>
          {Boolean(run?.failedOperationCount) && (
            <button
              type="button"
              disabled={busy !== null || applyLocked}
              onClick={() => {
                void prepareSafeImport(true);
              }}
              className="mt-3 ml-2 rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Retry failed import
            </button>
          )}
        </section>
      )}

      {showSummary && run && (
        <ImportSummary
          applied={appliedTotal}
          alreadyPresent={alreadyPresentTotal}
          blocked={blockedTotal}
          failed={failedTotal}
          archivedOnlyCount={run.archivedOnlyCount}
        />
      )}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Advanced settings
          </summary>
          <label
            className="mt-4 block text-sm font-medium text-slate-700"
            htmlFor="batch-size"
          >
            Batch size
          </label>
          <select
            id="batch-size"
            value={pageSize}
            onChange={(event) =>
              setPageSize(Number(event.target.value) as ActPageSize)
            }
            disabled={Boolean(run && !isFinished(run.phase))}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {ACT_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          {run && !isFinished(run.phase) && (
            <p className="mt-2 text-xs text-slate-500">
              Active run batch size is fixed at {run.pageSize}.
            </p>
          )}
        </details>
        {canStart && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={start}
            className="mt-5 w-full rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "fetch" ? "Starting…" : "Import everything from Act!"}
          </button>
        )}
      </section>

      </div>

      {importConfirmation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-safe-import-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2
              id="confirm-safe-import-heading"
              className="text-xl font-semibold text-slate-900"
            >
              {importConfirmation.retryFailed
                ? "Retry failed import?"
                : "Import safe records?"}
            </h2>
            <p className="mt-3 text-sm text-slate-700">
              Only reviewer-approved overwrites may replace populated fields.
              Imported records are not automatically removed if you later revisit
              this archive.
            </p>
            <p className="mt-3 text-sm font-medium text-slate-900">
              {importConfirmation.approvedOperationCount.toLocaleString()} safe operations will be
              processed automatically in small batches.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setImportConfirmation(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                ref={importConfirmButtonRef}
                onClick={() => void importSafeRecords(importConfirmation)}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white"
              >
                {importConfirmation.retryFailed
                  ? "Yes, retry failed import"
                  : "Yes, import safe records"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkConfirmation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-act-overwrite-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2
              id="confirm-act-overwrite-heading"
              className="text-xl font-semibold text-slate-900"
            >
              Confirm Act overwrite
            </h2>
            <p className="mt-3 text-sm text-slate-700">
              Use Act values for {bulkConfirmation.count} selected conflicts?
              This will overwrite {bulkConfirmation.count} populated app fields.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setBulkConfirmation(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                ref={bulkConfirmButtonRef}
                onClick={() => {
                  const snapshot = bulkConfirmation;
                  setBulkConfirmation(null);
                  void saveBulkDecision("use_source", snapshot);
                }}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Use Act values
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
