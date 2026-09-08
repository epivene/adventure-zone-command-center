import { useState } from "react";
import { Search } from "lucide-react";

import {
  retryGoogleWorkspaceGmailMutation,
  type GoogleProfileLabelSyncResult,
  type GoogleRecentValidationRow,
} from "@/features/google-workspace/google-workspace-client";
import {
  changeMatchedGoogleEmailProfile,
  ignoreMatchedGoogleEmail,
} from "@/features/google-workspace/google-matched-email-corrections";
import {
  searchGoogleReviewProfiles,
  type GoogleReviewProfileSearchResult,
} from "@/features/google-workspace/google-review-profile-search";

function gmailMessage(result: GoogleProfileLabelSyncResult): string {
  if (result.errorCode === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED") {
    return "Profile assigned. Reconnect the company Google account in Settings, then retry Gmail.";
  }
  if (result.state === "completed") return "Assigned and archived in Gmail.";
  if (result.state === "retryable_error") {
    return "Profile assigned. The Gmail update needs a retry.";
  }
  if (result.state === "conflict") {
    return "Profile assigned, but Gmail has a label conflict. No duplicate label was created.";
  }
  return "Profile assigned, but Gmail could not be updated.";
}

export function GoogleMatchedEmailActions({
  row,
  onAssigned,
  onIgnored,
}: {
  row: GoogleRecentValidationRow;
  onAssigned(profile: { id: string; name: string }): void;
  onIgnored(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GoogleReviewProfileSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gmailSync, setGmailSync] = useState<GoogleProfileLabelSyncResult | null>(null);

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchGoogleReviewProfiles(query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not search profiles.");
    } finally {
      setSearching(false);
    }
  }

  async function assign(profile: GoogleReviewProfileSearchResult) {
    setBusy(true);
    setError(null);
    try {
      const result = await changeMatchedGoogleEmailProfile(row, profile.id);
      setGmailSync(result.gmailSync);
      onAssigned({ id: profile.id, name: profile.name });
      setEditing(false);
      setResults([]);
      setQuery("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change this email's profile.");
    } finally {
      setBusy(false);
    }
  }

  async function ignore() {
    setBusy(true);
    setError(null);
    try {
      await ignoreMatchedGoogleEmail(row);
      setGmailSync(null);
      onIgnored();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not ignore this email.");
    } finally {
      setBusy(false);
    }
  }

  async function retryGmail() {
    if (!gmailSync || gmailSync.state !== "retryable_error") return;
    setBusy(true);
    setError(null);
    try {
      const result = await retryGoogleWorkspaceGmailMutation(gmailSync.mutationId);
      setGmailSync(result.gmailSync);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry the Gmail update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="flex flex-wrap gap-3 text-xs font-semibold">
        <button className="text-orange-700 hover:underline disabled:opacity-50 dark:text-orange-300" disabled={busy} onClick={() => setEditing((value) => !value)} type="button">
          {editing ? "Cancel change" : "Change profile"}
        </button>
        <button className="text-slate-600 hover:text-rose-700 disabled:opacity-50 dark:text-slate-300" disabled={busy} onClick={() => void ignore()} type="button">
          {busy ? "Saving…" : "Ignore this email"}
        </button>
      </div>

      {editing ? (
        <div className="mt-3 grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input aria-label={`Search another profile for ${row.subject || "email"}`} className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950" onChange={(event) => setQuery(event.target.value)} placeholder="Search another profile" value={query} />
            </div>
            <button className="button-secondary px-3 py-2" disabled={busy || searching || !query.trim()} onClick={() => void search()} type="button">
              {searching ? "Searching…" : "Search profiles"}
            </button>
          </div>
          {results.map((profile) => (
            <button className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900" disabled={busy} key={profile.id} onClick={() => void assign(profile)} type="button">
              <span className="font-semibold">{profile.name}</span>
              <span className="text-xs text-slate-500">{[profile.city, profile.region].filter(Boolean).join(", ")}</span>
            </button>
          ))}
        </div>
      ) : null}
      {gmailSync ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300" role="status">
          <span>{gmailMessage(gmailSync)}</span>
          {gmailSync.state === "retryable_error" ? (
            <button
              className="text-orange-700 hover:underline disabled:opacity-50 dark:text-orange-300"
              disabled={busy}
              onClick={() => void retryGmail()}
              type="button"
            >
              {busy ? "Retrying…" : "Retry Gmail"}
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs font-semibold text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}
