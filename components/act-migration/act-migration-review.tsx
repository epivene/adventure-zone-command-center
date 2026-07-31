"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  continueActMigrationAction,
  finalizeActMigrationPreviewAction,
  resumeActMigrationAction,
  saveActMigrationDecisionAction,
  startActMigrationAction,
  type ActMigrationActionError,
  type ActMigrationDecisionActionResult,
  type ActMigrationPreviewActionResult,
  type ActMigrationProgressActionResult,
} from "@/app/(private)/settings/act-migration/actions";
import {
  actMigrationStreamTypeValues,
  allowedDecisionsForProposal,
  migrationPreviewStateValues,
  migrationTargetEntityTypeValues,
  type ActMigrationStreamType,
  type MigrationDecision,
  type MigrationPreviewState,
  type MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";
import type {
  MigrationPreviewQuery,
  StoredMigrationChoice,
  StoredMigrationPreviewPage,
  StoredMigrationProposal,
} from "@/features/act-migration/preview-repository";
import type { StoredMigrationWorkspace } from "@/features/act-migration/runtime";
import type { SnapshotProgress } from "@/features/act-migration/snapshot-repository";

type StartAction = (
  requestKey: string,
) => Promise<ActMigrationProgressActionResult>;
type ProgressAction = (
  runId: string,
) => Promise<ActMigrationProgressActionResult>;
type FinalizeAction = (input: {
  runId: string;
  query: MigrationPreviewQuery;
}) => Promise<ActMigrationPreviewActionResult>;
type SaveDecisionAction = (input: {
  runId: string;
  proposalKey: string;
  decision: MigrationDecision;
  chosenLocalEntityId?: string;
  primarySourceId?: string;
  ignoreReason?: string;
}) => Promise<ActMigrationDecisionActionResult>;

type Props = {
  configured: boolean;
  maskedDatabase: string | null;
  query: MigrationPreviewQuery;
  workspace: StoredMigrationWorkspace | null;
  startAction?: StartAction;
  continueAction?: ProgressAction;
  resumeAction?: ProgressAction;
  finalizeAction?: FinalizeAction;
  saveDecisionAction?: SaveDecisionAction;
  requestKeyFactory?: () => string;
  now?: () => number;
};

const streamLabels: Record<ActMigrationStreamType, string> = {
  company: "Companies",
  contact: "Contacts",
  opportunity: "Opportunities",
  group: "Groups",
  company_contact: "Company–Contact relationships",
  opportunity_company: "Opportunity–Company relationships",
  opportunity_contact: "Opportunity–Contact relationships",
  group_contact: "Group–Contact relationships",
};

const targetLabels: Record<MigrationTargetEntityType, string> = {
  organization: "Places",
  contact: "People",
  organization_contact: "Place–Person relationships",
  booking: "Bookings",
  booking_contact: "Booking–Person relationships",
  calling_list: "Calling lists",
  calling_list_member: "Calling list members",
};

const stateLabels: Record<MigrationPreviewState, string> = {
  new: "New",
  matched_unchanged: "Matched unchanged",
  change: "Changes",
  new_relationship: "New relationships",
  possible_duplicate: "Possible duplicates",
  needs_review: "Needs review",
  ignored: "Ignored",
  error: "Errors",
};

const decisionLabels: Record<MigrationDecision, string> = {
  approve_proposed: "Approve proposed",
  link_existing: "Link existing",
  keep_separate: "Keep separate",
  ignore: "Ignore",
};

function complete(progress: SnapshotProgress | null) {
  return Boolean(
    progress &&
      progress.totalCheckpoints > 0 &&
      progress.completedCheckpoints === progress.totalCheckpoints &&
      progress.failedCheckpoints === 0 &&
      progress.interruption === null,
  );
}

function shouldContinue(
  result: Extract<ActMigrationProgressActionResult, { ok: true }>,
) {
  return (
    result.changed &&
    result.progress.totalCheckpoints > 0 &&
    result.progress.completedCheckpoints <
      result.progress.totalCheckpoints &&
    result.progress.failedCheckpoints === 0 &&
    result.progress.interruption === null
  );
}

function selectedInterruption(progress: SnapshotProgress | null) {
  if (!progress?.interruption) return null;
  return {
    ok: false as const,
    error: `Snapshot interrupted: ${progress.interruption.code.replaceAll("_", " ")}.`,
    retryable: progress.interruption.retryable,
    retryAfter: progress.interruption.retryAfter?.toISOString() ?? null,
  };
}

function databaseStatus(configured: boolean, maskedDatabase: string | null) {
  if (!configured) return "Act! connection settings are not configured";
  return `Act! connection settings found${
    maskedDatabase ? ` · Database ${maskedDatabase}` : ""
  }`;
}

function queryHref(input: {
  runId: string;
  query: MigrationPreviewQuery;
  page?: number;
  targetEntityType?: MigrationTargetEntityType | null;
  state?: MigrationPreviewState | null;
}) {
  const parameters = new URLSearchParams();
  parameters.set("runId", input.runId);
  parameters.set("page", String(input.page ?? input.query.page));
  parameters.set("pageSize", String(input.query.pageSize));
  const target = input.targetEntityType === undefined
    ? input.query.targetEntityType
    : input.targetEntityType;
  const state = input.state === undefined ? input.query.state : input.state;
  if (target) parameters.set("targetEntityType", target);
  if (state) parameters.set("state", state);
  return `/settings/act-migration?${parameters.toString()}`;
}

function safeDisplayEntries(row: StoredMigrationProposal) {
  return Object.entries(row.displaySnapshot).filter(([key]) =>
    !/(password|username|database|credential|raw.?snapshot)/i.test(key)
  );
}

function selectedChoiceLabel(
  choices: readonly StoredMigrationChoice[],
  id: string | null,
) {
  if (!id) return null;
  return choices.find((choice) => choice.id === id)?.label ??
    "Unavailable local record";
}

function PersistedDecision({ row }: { row: StoredMigrationProposal }) {
  if (!row.decision) return null;
  const candidate = selectedChoiceLabel(
    row.candidateChoices,
    row.chosenLocalEntityId,
  );
  const primary = selectedChoiceLabel(
    row.primarySourceChoices,
    row.primarySourceId ?? row.proposedPrimarySourceId,
  );
  return (
    <div className="mt-3 grid gap-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
      <p className="font-semibold">
        Decision: {decisionLabels[row.decision]}
      </p>
      {row.decisionReason ? <p>Reason: {row.decisionReason}</p> : null}
      {candidate ? <p>Candidate: {candidate}</p> : null}
      {primary ? <p>Primary Act! Contact: {primary}</p> : null}
      {row.decidedBy && row.decidedAt ? (
        <p>
          Reviewed by {row.decidedBy} at {row.decidedAt.toISOString()}
        </p>
      ) : null}
    </div>
  );
}

function ProposalDecision({
  busy,
  onSave,
  row,
}: {
  busy: boolean;
  onSave: (
    row: StoredMigrationProposal,
    input: Omit<Parameters<SaveDecisionAction>[0], "runId">,
  ) => Promise<void>;
  row: StoredMigrationProposal;
}) {
  const availableCandidates = row.candidateChoices.filter(
    ({ available }) => available,
  );
  const availablePrimarySources = row.primarySourceChoices.filter(
    ({ available }) => available,
  );
  const allowed = allowedDecisionsForProposal(row).filter(
    (decision) =>
      decision !== "link_existing" || availableCandidates.length > 0,
  );
  const initialDecision = row.decision && allowed.includes(row.decision)
    ? row.decision
    : "";
  const [decision, setDecision] = useState<MigrationDecision | "">(
    initialDecision,
  );
  const [error, setError] = useState<string | null>(null);

  if (allowed.length === 0) {
    return (
      <p className="mt-3 text-sm font-semibold text-slate-600">
        No review decision is available for this proposal.
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!decision || !allowed.includes(decision)) return;
    const data = new FormData(event.currentTarget);
    const ignoreReason = String(data.get("ignoreReason") ?? "").trim();
    if (decision === "ignore" && !ignoreReason) {
      setError("Enter a reason before ignoring this proposal.");
      return;
    }
    const chosenLocalEntityId = String(
      data.get("chosenLocalEntityId") ?? "",
    ).trim();
    const primarySourceId = String(data.get("primarySourceId") ?? "").trim();
    await onSave(row, {
      proposalKey: row.proposalKey,
      decision,
      ...(decision === "link_existing" && chosenLocalEntityId
        ? { chosenLocalEntityId }
        : {}),
      ...(
        (decision === "approve_proposed" ||
          decision === "link_existing") &&
          primarySourceId
          ? { primarySourceId }
          : {}
      ),
      ...(decision === "ignore" ? { ignoreReason } : {}),
    });
  }

  return (
    <form className="mt-4 grid gap-3 border-t border-slate-200 pt-4" onSubmit={submit}>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Decision
        <select
          aria-label={`Decision for ${row.proposalKey}`}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2"
          disabled={busy}
          onChange={(event) => {
            setDecision(event.target.value as MigrationDecision | "");
            setError(null);
          }}
          value={decision}
        >
          <option value="">Choose…</option>
          {allowed.map((value) => (
            <option key={value} value={value}>
              {decisionLabels[value]}
            </option>
          ))}
        </select>
      </label>

      {decision === "link_existing" ? (
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Local candidate
          <select
            aria-label={`Local candidate for ${row.proposalKey}`}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2"
            defaultValue={row.chosenLocalEntityId ?? ""}
            disabled={busy}
            name="chosenLocalEntityId"
            required
          >
            <option value="">Choose…</option>
            {availableCandidates.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {(decision === "approve_proposed" || decision === "link_existing") &&
      row.targetEntityType === "contact" &&
      availablePrimarySources.length > 0 ? (
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Primary Act! Contact
          <select
            aria-label={`Primary Act! Contact for ${row.proposalKey}`}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2"
            defaultValue={
              row.primarySourceId ?? row.proposedPrimarySourceId ?? ""
            }
            disabled={busy}
            name="primarySourceId"
          >
            <option value="">Use proposed primary</option>
            {availablePrimarySources.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {decision === "ignore" ? (
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Ignore reason
          <textarea
            aria-label={`Ignore reason for ${row.proposalKey}`}
            className="min-h-24 rounded-lg border border-slate-300 bg-white px-3 py-2"
            defaultValue={row.decisionReason ?? ""}
            disabled={busy}
            name="ignoreReason"
          />
        </label>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button-secondary justify-self-start" disabled={busy || !decision} type="submit">
        Save decision
      </button>
    </form>
  );
}

export function ActMigrationReview({
  configured,
  maskedDatabase,
  query,
  workspace,
  startAction = startActMigrationAction,
  continueAction = continueActMigrationAction,
  resumeAction = resumeActMigrationAction,
  finalizeAction = finalizeActMigrationPreviewAction,
  saveDecisionAction = saveActMigrationDecisionAction,
  requestKeyFactory = () => crypto.randomUUID(),
  now = () => Date.now(),
}: Props) {
  const router = useRouter();
  const [currentProgress, setCurrentProgress] = useState(
    workspace?.progress ?? null,
  );
  const [finalizedPreview, setFinalizedPreview] =
    useState<StoredMigrationPreviewPage | null>(null);
  const [failure, setFailure] = useState<ActMigrationActionError | null>(null);
  const [checkAgain, setCheckAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingProposal, setSavingProposal] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [, setClock] = useState(() => now());
  const inFlight = useRef(false);
  const decisionSave = useRef<symbol | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const activeRun = useRef(workspace?.progress.runId ?? null);

  useEffect(() => {
    const nextRun = workspace?.progress.runId ?? null;
    if (activeRun.current !== nextRun) {
      activeRun.current = nextRun;
      generation.current += 1;
    }
  }, [workspace?.progress.runId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const progressFailure = selectedInterruption(currentProgress);
  const visibleFailure = failure ?? progressFailure;
  const retryAfter = visibleFailure?.retryAfter
    ? Date.parse(visibleFailure.retryAfter)
    : null;
  const retryReady = retryAfter === null ||
    Number.isNaN(retryAfter) ||
    now() >= retryAfter;

  useEffect(() => {
    if (
      retryAfter === null ||
      Number.isNaN(retryAfter) ||
      retryAfter <= now()
    ) {
      return;
    }
    const timeout = window.setTimeout(
      () => setClock(now()),
      Math.min(retryAfter - now(), 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [now, retryAfter]);

  function current(workflowGeneration: number, runId?: string) {
    return (
      mounted.current &&
      generation.current === workflowGeneration &&
      (runId === undefined || activeRun.current === runId)
    );
  }

  function acceptProgressResult(
    result: Extract<ActMigrationProgressActionResult, { ok: true }>,
    navigation: { refresh: boolean },
  ) {
    setCurrentProgress(result.progress);
    setFailure(null);
    setCheckAgain(!result.changed);
    if (result.changed) navigation.refresh = true;
    return shouldContinue(result);
  }

  async function continueSerially(
    runId: string,
    workflowGeneration: number,
    navigation: { refresh: boolean },
  ) {
    while (current(workflowGeneration, runId)) {
      const result = await continueAction(runId);
      if (!current(workflowGeneration, runId)) return;
      if (!result.ok) {
        setFailure(result);
        setCheckAgain(false);
        navigation.refresh = true;
        return;
      }
      if (!acceptProgressResult(result, navigation)) return;
    }
  }

  function startWorkflow(runId: string | null) {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setStatus(null);
    setCheckAgain(false);
    generation.current += 1;
    activeRun.current = runId;
    return generation.current;
  }

  function finishWorkflow(workflowGeneration: number) {
    if (generation.current !== workflowGeneration) return;
    inFlight.current = false;
    setBusy(false);
  }

  function flushNavigation(
    workflowGeneration: number,
    navigation: { refresh: boolean; replace: string | null },
  ) {
    if (!current(workflowGeneration)) return;
    if (navigation.replace) {
      router.replace(navigation.replace);
    } else if (navigation.refresh) {
      router.refresh();
    }
  }

  async function start() {
    const workflowGeneration = startWorkflow(null);
    if (workflowGeneration === null) return;
    const navigation = { refresh: false, replace: null as string | null };
    try {
      const result = await startAction(requestKeyFactory());
      if (!current(workflowGeneration)) return;
      if (!result.ok) {
        setFailure(result);
        navigation.refresh = true;
        return;
      }
      activeRun.current = result.runId;
      navigation.replace = queryHref({ runId: result.runId, query });
      if (acceptProgressResult(result, navigation)) {
        await continueSerially(
          result.runId,
          workflowGeneration,
          navigation,
        );
      }
    } catch {
      if (current(workflowGeneration)) {
        setFailure({
          ok: false,
          error: "The Act! migration could not be updated.",
          retryable: false,
          retryAfter: null,
        });
      }
    } finally {
      finishWorkflow(workflowGeneration);
      flushNavigation(workflowGeneration, navigation);
    }
  }

  async function updateProgress(action: ProgressAction) {
    const runId = currentProgress?.runId;
    if (!runId) return;
    const workflowGeneration = startWorkflow(runId);
    if (workflowGeneration === null) return;
    const navigation = { refresh: false, replace: null };
    try {
      const result = await action(runId);
      if (!current(workflowGeneration, runId)) return;
      if (!result.ok) {
        setFailure(result);
        setCheckAgain(false);
        navigation.refresh = true;
        return;
      }
      if (acceptProgressResult(result, navigation)) {
        await continueSerially(runId, workflowGeneration, navigation);
      }
    } catch {
      if (current(workflowGeneration, runId)) {
        setFailure({
          ok: false,
          error: "The Act! migration could not be updated.",
          retryable: false,
          retryAfter: null,
        });
      }
    } finally {
      finishWorkflow(workflowGeneration);
      flushNavigation(workflowGeneration, navigation);
    }
  }

  async function finalize() {
    const runId = currentProgress?.runId;
    if (!runId || !complete(currentProgress)) return;
    const workflowGeneration = startWorkflow(runId);
    if (workflowGeneration === null) return;
    try {
      const result = await finalizeAction({ runId, query });
      if (!current(workflowGeneration, runId)) return;
      if (!result.ok) {
        setFailure(result);
        return;
      }
      setFailure(null);
      setFinalizedPreview(result.preview);
      setStatus("Stored preview ready.");
      if (result.changed) router.refresh();
    } catch {
      if (current(workflowGeneration, runId)) {
        setFailure({
          ok: false,
          error: "The Act! migration preview could not be finalized.",
          retryable: false,
          retryAfter: null,
        });
      }
    } finally {
      finishWorkflow(workflowGeneration);
    }
  }

  async function saveDecision(
    row: StoredMigrationProposal,
    input: Omit<Parameters<SaveDecisionAction>[0], "runId">,
  ) {
    const runId = currentProgress?.runId;
    if (!runId || decisionSave.current) return;
    const token = Symbol(row.proposalKey);
    decisionSave.current = token;
    setSavingProposal(row.proposalKey);
    setStatus(null);
    try {
      const result = await saveDecisionAction({ ...input, runId });
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      setStatus(
        result.changed
          ? "Review decision saved."
          : "Review decision already saved.",
      );
      if (result.changed) router.refresh();
    } catch {
      setStatus("The review decision could not be saved.");
    } finally {
      if (decisionSave.current === token) {
        decisionSave.current = null;
        if (mounted.current) setSavingProposal(null);
      }
    }
  }

  const preview = workspace?.preview ?? finalizedPreview;
  const runId = currentProgress?.runId ?? null;
  const incomplete = Boolean(
    currentProgress &&
      currentProgress.totalCheckpoints > 0 &&
      currentProgress.completedCheckpoints <
        currentProgress.totalCheckpoints &&
      currentProgress.interruption === null,
  );
  const canResume = Boolean(runId && visibleFailure?.retryable);

  return (
    <section aria-labelledby="act-migration-heading" className="grid gap-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold" id="act-migration-heading">
          Act! migration connection
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {databaseStatus(configured, maskedDatabase)}
        </p>
        <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-950">
          Preview only — no Command Center or Act! records are changed
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!currentProgress ? (
            <button
              className="button-primary"
              disabled={busy || !configured}
              onClick={start}
              type="button"
            >
              Start preview snapshot
            </button>
          ) : null}
          {incomplete && !visibleFailure ? (
            <button
              className="button-primary"
              disabled={busy}
              onClick={() => updateProgress(continueAction)}
              type="button"
            >
              {checkAgain ? "Check again" : "Continue snapshot"}
            </button>
          ) : null}
          {canResume ? (
            <button
              className="button-primary"
              disabled={busy || !retryReady}
              onClick={() => updateProgress(resumeAction)}
              type="button"
            >
              Resume
            </button>
          ) : null}
          {complete(currentProgress) && !preview ? (
            <button
              className="button-primary"
              disabled={busy}
              onClick={finalize}
              type="button"
            >
              Finalize preview
            </button>
          ) : null}
        </div>
        {visibleFailure ? (
          <div className="mt-3">
            <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800" role="alert">
              {visibleFailure.error}
            </p>
            {visibleFailure.retryAfter ? (
              <p className="mt-1 text-sm text-slate-600">
                Available after {visibleFailure.retryAfter}
              </p>
            ) : null}
          </div>
        ) : null}
        <p aria-live="polite" className="mt-3 text-sm font-semibold text-slate-700">
          {busy
            ? "Working on one bounded snapshot action…"
            : status ?? (
              currentProgress
                ? `${currentProgress.completedCheckpoints} of ${currentProgress.totalCheckpoints} checkpoints complete · ${currentProgress.stagedRecords} records staged`
                : "No stored migration run selected."
            )}
        </p>
      </div>

      <section aria-labelledby="snapshot-progress-heading" className="grid gap-3">
        <h2 className="text-xl font-bold" id="snapshot-progress-heading">
          Snapshot progress
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {actMigrationStreamTypeValues.map((streamType) => {
            const stream = currentProgress?.streams.find(
              (value) => value.streamType === streamType,
            );
            return (
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={streamType}>
                <h3 className="font-bold">{streamLabels[streamType]}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  {stream?.completedCheckpoints ?? 0} /{" "}
                  {stream?.totalCheckpoints ?? 0} checkpoints ·{" "}
                  {stream?.stagedRecords ?? 0} staged
                </p>
                {(stream?.failedCheckpoints ?? 0) > 0 ? (
                  <p className="mt-1 text-sm font-semibold text-red-800">
                    {stream?.failedCheckpoints} failed
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {preview && runId ? (
        <>
          <section aria-labelledby="reconciliation-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold" id="reconciliation-heading">
              Reconciliation
            </h2>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Places without People", preview.report.placesWithoutPeople],
                ["Multi-Place People", preview.report.multiPlacePeople],
                [
                  "Opportunities without Place",
                  preview.report.opportunitiesWithoutPlace,
                ],
                [
                  "Opportunities without Person",
                  preview.report.opportunitiesWithoutPerson,
                ],
                [
                  "Duplicate source IDs",
                  preview.report.duplicateSourceIdConflicts,
                ],
                [
                  "Incomplete checkpoints",
                  preview.report.incompleteCheckpoints,
                ],
                ["Failed checkpoints", preview.report.failedCheckpoints],
              ].map(([label, value]) => (
                <li className="rounded-lg bg-slate-50 p-3" key={String(label)}>
                  <span className="block text-sm text-slate-600">{label}</span>
                  <strong className="text-lg">{value}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="proposal-review-heading" className="grid gap-4">
            <h2 className="text-xl font-bold" id="proposal-review-heading">
              Stored preview proposals
            </h2>
            <div aria-label="Entity facets" className="flex gap-2 overflow-x-auto" role="tablist">
              <Link
                aria-selected={!query.targetEntityType}
                className="shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold aria-selected:border-orange-600 aria-selected:bg-orange-50"
                href={queryHref({
                  runId,
                  query,
                  page: 1,
                  targetEntityType: null,
                })}
                role="tab"
              >
                All entities{" "}
                {Object.values(preview.entityCounts).reduce(
                  (sum, value) => sum + value,
                  0,
                )}
              </Link>
              {migrationTargetEntityTypeValues.map((value) => (
                <Link
                  aria-selected={query.targetEntityType === value}
                  className="shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold aria-selected:border-orange-600 aria-selected:bg-orange-50"
                  href={queryHref({
                    runId,
                    query,
                    page: 1,
                    targetEntityType: value,
                  })}
                  key={value}
                  role="tab"
                >
                  {targetLabels[value]} {preview.entityCounts[value]}
                </Link>
              ))}
            </div>
            <div aria-label="Preview state facets" className="flex gap-2 overflow-x-auto" role="tablist">
              <Link
                aria-selected={!query.state}
                className="shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold aria-selected:border-orange-600 aria-selected:bg-orange-50"
                href={queryHref({ runId, query, page: 1, state: null })}
                role="tab"
              >
                All states{" "}
                {Object.values(preview.stateCounts).reduce(
                  (sum, value) => sum + value,
                  0,
                )}
              </Link>
              {migrationPreviewStateValues.map((value) => (
                <Link
                  aria-selected={query.state === value}
                  className="shrink-0 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold aria-selected:border-orange-600 aria-selected:bg-orange-50"
                  href={queryHref({
                    runId,
                    query,
                    page: 1,
                    state: value,
                  })}
                  key={value}
                  role="tab"
                >
                  {stateLabels[value]} {preview.stateCounts[value]}
                </Link>
              ))}
            </div>

            {preview.rows.length > 0 ? (
              <div className="grid gap-3">
                {preview.rows.map((row) => (
                  <article
                    aria-label={`Proposal ${row.proposalKey}`}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                    key={row.proposalKey}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold">
                          {targetLabels[row.targetEntityType]}
                        </h3>
                        <p className="text-sm text-slate-500">
                          {row.proposalKey}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                        {stateLabels[row.state]}
                      </span>
                    </div>
                    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                      {safeDisplayEntries(row).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            {key.replaceAll("_", " ")}
                          </dt>
                          <dd className="text-sm text-slate-800">
                            {value === null ? "Not provided" : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {row.issueCode ? (
                      <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                        {row.issueCode.replaceAll("_", " ")}
                      </p>
                    ) : null}
                    <PersistedDecision row={row} />
                    <ProposalDecision
                      busy={savingProposal !== null}
                      onSave={saveDecision}
                      row={row}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-600">
                No proposals on this selected page.
              </p>
            )}

            <nav aria-label="Proposal pagination" className="flex items-center justify-between gap-3">
              {preview.page > 1 ? (
                <Link
                  className="button-secondary"
                  href={queryHref({
                    runId,
                    query,
                    page: preview.page - 1,
                  })}
                >
                  Previous page
                </Link>
              ) : <span />}
              <p className="text-sm font-semibold text-slate-700">
                Page {preview.page} of{" "}
                {Math.max(1, Math.ceil(preview.total / preview.pageSize))}
              </p>
              {preview.page <
              Math.max(1, Math.ceil(preview.total / preview.pageSize)) ? (
                <Link
                  className="button-secondary"
                  href={queryHref({
                    runId,
                    query,
                    page: preview.page + 1,
                  })}
                >
                  Next page
                </Link>
              ) : <span />}
            </nav>
          </section>
        </>
      ) : null}
    </section>
  );
}
