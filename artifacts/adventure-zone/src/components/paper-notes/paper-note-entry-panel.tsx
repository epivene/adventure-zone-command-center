import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PaperNoteEntryCard } from "./paper-note-entry-card";
import { PaperNoteEntryErrorBoundary } from "./paper-note-entry-error-boundary";
import {
  approvePaperNoteEntry,
  getPaperNoteEntryMatches,
  getPaperNoteEntryReview,
  getPaperNoteEntrySource,
  savePaperNoteEntryReview,
  skipPaperNoteEntry,
  unapprovePaperNoteEntry,
} from "@/features/paper-notes/paper-note-client";
import { applyAutomaticPaperNoteProfileMatch } from "@/features/paper-notes/paper-note-profile-autolink";
import type {
  PaperNoteReviewDraft,
  PaperNoteReviewEntryDetails,
} from "@/features/paper-notes/paper-note-review-types";

export function PaperNoteEntryPanel({
  entryId,
  onChanged,
}: {
  entryId: string;
  onChanged(): void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const saveSequence = useRef(0);
  const versionRef = useRef<number | null>(null);
  const latestSaved = useRef<PaperNoteReviewEntryDetails | null>(null);
  const autoLinkAttemptedForEntry = useRef<string | null>(null);

  const entryQuery = useQuery({
    queryKey: ["paper-notes", "entry-review", entryId],
    queryFn: () => getPaperNoteEntryReview(entryId),
  });
  const matchesQuery = useQuery({
    queryKey: ["paper-notes", "entry-matches", entryId],
    queryFn: () => getPaperNoteEntryMatches(entryId),
  });

  useEffect(() => {
    versionRef.current = entryQuery.data?.reviewVersion ?? null;
    latestSaved.current = entryQuery.data ?? null;
    saveTail.current = Promise.resolve();
    saveSequence.current = 0;
    autoLinkAttemptedForEntry.current = null;
  }, [entryId]);

  useEffect(() => {
    if (versionRef.current === null && entryQuery.data) {
      versionRef.current = entryQuery.data.reviewVersion;
      latestSaved.current = entryQuery.data;
    }
  }, [entryQuery.data]);

  const replaceEntry = useCallback(async (entry: Awaited<ReturnType<typeof getPaperNoteEntryReview>>) => {
    versionRef.current = entry.reviewVersion;
    latestSaved.current = entry;
    queryClient.setQueryData(["paper-notes", "entry-review", entryId], entry);
    await Promise.resolve(onChanged());
    return entry;
  }, [entryId, onChanged, queryClient]);

  const save = useCallback((review: PaperNoteReviewDraft, expectedVersion: number) => {
    const sequence = ++saveSequence.current;
    let resolveResult!: (value: PaperNoteReviewEntryDetails) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<PaperNoteReviewEntryDetails>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const execute = async () => {
      try {
        const version = versionRef.current ?? expectedVersion;
        const saved = await savePaperNoteEntryReview(entryId, review, version);
        versionRef.current = saved.reviewVersion;
        latestSaved.current = saved;
        await queryClient.invalidateQueries({ queryKey: ["paper-notes", "entry-matches", entryId] });

        if (sequence === saveSequence.current) {
          queryClient.setQueryData(["paper-notes", "entry-review", entryId], saved);
        }

        queueMicrotask(async () => {
          try {
            while (sequence < saveSequence.current) {
              const observedTail = saveTail.current;
              await observedTail;
              if (observedTail === saveTail.current) break;
            }
            resolveResult(latestSaved.current ?? saved);
          } catch (error) {
            rejectResult(error);
          }
        });
      } catch (error) {
        rejectResult(error);
      }
    };

    const priorTail = saveTail.current;
    const execution = priorTail.then(execute, execute);
    saveTail.current = execution.then(() => undefined, () => undefined);
    return result;
  }, [entryId, queryClient]);

  useEffect(() => {
    const entry = entryQuery.data;
    const matches = matchesQuery.data;
    if (!entry || !matches || matchesQuery.isFetching) return;
    if (entry.state !== "needs_review" && entry.state !== "ready") return;
    if (entry.review.destination) return;
    if (autoLinkAttemptedForEntry.current === entryId) return;

    const linkedReview = applyAutomaticPaperNoteProfileMatch(entry.review, matches);
    if (!linkedReview) return;

    autoLinkAttemptedForEntry.current = entryId;
    const version = versionRef.current ?? entry.reviewVersion;
    void savePaperNoteEntryReview(entryId, linkedReview, version)
      .then((saved) => {
        versionRef.current = saved.reviewVersion;
        latestSaved.current = saved;
        queryClient.setQueryData(["paper-notes", "entry-review", entryId], saved);
      })
      .catch(() => {
        autoLinkAttemptedForEntry.current = null;
      });
  }, [entryId, entryQuery.data, matchesQuery.data, matchesQuery.isFetching, queryClient]);

  const approve = useCallback(
    (expectedVersion: number) => approvePaperNoteEntry(entryId, versionRef.current ?? expectedVersion).then(replaceEntry),
    [entryId, replaceEntry],
  );
  const unapprove = useCallback(
    (expectedVersion: number) => unapprovePaperNoteEntry(entryId, versionRef.current ?? expectedVersion).then(replaceEntry),
    [entryId, replaceEntry],
  );
  const skip = useCallback(
    (expectedVersion: number) => skipPaperNoteEntry(entryId, versionRef.current ?? expectedVersion).then(replaceEntry),
    [entryId, replaceEntry],
  );

  if (entryQuery.isLoading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading paper entry…</div>;
  }
  if (entryQuery.isError || !entryQuery.data) {
    return <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">Could not load this paper entry. Try another entry or reload the batch.</div>;
  }

  return (
    <PaperNoteEntryErrorBoundary entryId={entryId}>
      <div className="grid gap-3">
        {matchesQuery.isError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" role="status">
            Saved-profile suggestions could not load. The paper entry is still available to review; retry or use manual profile search.
          </div>
        ) : null}
        <PaperNoteEntryCard
          entry={entryQuery.data}
          matches={matchesQuery.data ?? []}
          loadSource={() => getPaperNoteEntrySource(entryId)}
          onSave={save}
          onApprove={approve}
          onUnapprove={unapprove}
          onSkip={skip}
        />
      </div>
    </PaperNoteEntryErrorBoundary>
  );
}
