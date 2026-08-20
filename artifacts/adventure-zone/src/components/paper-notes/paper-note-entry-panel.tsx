import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PaperNoteEntryCard } from "./paper-note-entry-card";
import {
  approvePaperNoteEntry,
  getPaperNoteEntryMatches,
  getPaperNoteEntryReview,
  getPaperNoteEntrySource,
  savePaperNoteEntryReview,
  skipPaperNoteEntry,
  unapprovePaperNoteEntry,
} from "@/features/paper-notes/paper-note-client";
import type { PaperNoteReviewDraft } from "@/features/paper-notes/paper-note-review-types";

export function PaperNoteEntryPanel({
  entryId,
  onChanged,
}: {
  entryId: string;
  onChanged(): void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const entryQuery = useQuery({
    queryKey: ["paper-notes", "entry-review", entryId],
    queryFn: () => getPaperNoteEntryReview(entryId),
  });
  const matchesQuery = useQuery({
    queryKey: ["paper-notes", "entry-matches", entryId],
    queryFn: () => getPaperNoteEntryMatches(entryId),
  });

  const replaceEntry = useCallback(async (entry: Awaited<ReturnType<typeof getPaperNoteEntryReview>>) => {
    queryClient.setQueryData(["paper-notes", "entry-review", entryId], entry);
    await Promise.resolve(onChanged());
    return entry;
  }, [entryId, onChanged, queryClient]);

  const save = useCallback(async (review: PaperNoteReviewDraft, expectedVersion: number) => {
    const saved = await savePaperNoteEntryReview(entryId, review, expectedVersion);
    queryClient.setQueryData(["paper-notes", "entry-review", entryId], saved);
    await queryClient.invalidateQueries({ queryKey: ["paper-notes", "entry-matches", entryId] });
    await Promise.resolve(onChanged());
    return saved;
  }, [entryId, onChanged, queryClient]);

  const approve = useCallback(
    (expectedVersion: number) => approvePaperNoteEntry(entryId, expectedVersion).then(replaceEntry),
    [entryId, replaceEntry],
  );
  const unapprove = useCallback(
    (expectedVersion: number) => unapprovePaperNoteEntry(entryId, expectedVersion).then(replaceEntry),
    [entryId, replaceEntry],
  );
  const skip = useCallback(
    (expectedVersion: number) => skipPaperNoteEntry(entryId, expectedVersion).then(replaceEntry),
    [entryId, replaceEntry],
  );

  if (entryQuery.isLoading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading paper entry…</div>;
  }
  if (entryQuery.isError || !entryQuery.data) {
    return <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">Could not load this paper entry. Try another entry or reload the batch.</div>;
  }

  return (
    <PaperNoteEntryCard
      entry={entryQuery.data}
      matches={matchesQuery.data ?? []}
      loadSource={() => getPaperNoteEntrySource(entryId)}
      onSave={save}
      onApprove={approve}
      onUnapprove={unapprove}
      onSkip={skip}
    />
  );
}
