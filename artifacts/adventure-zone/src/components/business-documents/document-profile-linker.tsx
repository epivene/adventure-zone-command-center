import { useMemo, useState } from "react";
import { Link2, Search } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  businessDocumentsApi,
  type BusinessDocumentProfileOption,
  type BusinessDocumentRecord,
} from "@/lib/business-documents-api";
import {
  buildProfileSearchQuery,
  chooseStrongProfileMatch,
  isProfileLinkCandidate,
} from "@/lib/document-profile-matcher";

export type ProfileLinkSuggestion = {
  documentId: string;
  documentName: string;
  profile: BusinessDocumentProfileOption;
  confidence: number;
  reason: string;
  query: string;
};

type ProfileLinkerApi = Pick<typeof businessDocumentsApi, "searchProfiles" | "linkProfile">;

type DocumentProfileLinkerProps = {
  api: ProfileLinkerApi;
  documents: BusinessDocumentRecord[];
  onLinked: (suggestions: ProfileLinkSuggestion[]) => void;
};

export function DocumentProfileLinker({ api, documents, onLinked }: DocumentProfileLinkerProps) {
  const eligible = useMemo(() => documents.filter(isProfileLinkCandidate), [documents]);
  const [suggestions, setSuggestions] = useState<ProfileLinkSuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [linking, setLinking] = useState(false);
  const [progress, setProgress] = useState({ complete: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);

  async function findMatches() {
    setScanning(true);
    setSuggestions([]);
    setMessage(null);
    const groups = new Map<string, BusinessDocumentRecord[]>();
    for (const document of eligible) {
      const query = buildProfileSearchQuery(document);
      if (query.length < 4) continue;
      groups.set(query, [...(groups.get(query) ?? []), document]);
    }
    const entries = [...groups.entries()];
    setProgress({ complete: 0, total: entries.length });
    const matches: ProfileLinkSuggestion[] = [];
    let nextIndex = 0;
    let failedSearches = 0;

    async function worker() {
      while (nextIndex < entries.length) {
        const index = nextIndex++;
        const [query, matchingDocuments] = entries[index];
        try {
          const profiles = await api.searchProfiles(query);
          for (const document of matchingDocuments) {
            const match = chooseStrongProfileMatch(document, profiles);
            if (match) matches.push({
              documentId: document.id,
              documentName: document.displayName,
              query,
              ...match,
            });
          }
        } catch {
          failedSearches += 1;
        } finally {
          setProgress((current) => ({ ...current, complete: current.complete + 1 }));
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => worker()));
    matches.sort((left, right) => left.documentName.localeCompare(right.documentName));
    setSuggestions(matches);
    setMessage(matches.length
      ? `Found ${matches.length} strong ${matches.length === 1 ? "match" : "matches"}. Review them before linking.`
      : "No unambiguous profile matches were found. Nothing was linked.");
    if (failedSearches) setMessage((current) => `${current} ${failedSearches} ${failedSearches === 1 ? "search" : "searches"} could not be completed.`);
    setScanning(false);
  }

  async function linkMatches() {
    setLinking(true);
    setMessage(null);
    const linked: ProfileLinkSuggestion[] = [];
    const failed: ProfileLinkSuggestion[] = [];
    for (let index = 0; index < suggestions.length; index += 5) {
      const batch = suggestions.slice(index, index + 5);
      const results = await Promise.allSettled(batch.map((suggestion) => api.linkProfile(
        suggestion.documentId,
        suggestion.profile.id,
        {
          confidence: suggestion.confidence,
          evidence: [{
            kind: "document_filename_profile_match",
            query: suggestion.query,
            profileName: suggestion.profile.name,
            reason: suggestion.reason,
          }],
        },
      )));
      results.forEach((result, resultIndex) => {
        (result.status === "fulfilled" ? linked : failed).push(batch[resultIndex]);
      });
    }
    if (linked.length) onLinked(linked);
    setSuggestions(failed);
    setMessage(`${linked.length} ${linked.length === 1 ? "document was" : "documents were"} linked.${failed.length ? ` ${failed.length} could not be linked and remain in the preview.` : ""}`);
    setLinking(false);
  }

  if (!eligible.length) return null;

  return (
    <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Profile linking</p>
          <h2 className="text-lg font-bold text-foreground">Find profiles for {eligible.length} unlinked event documents</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            This checks contracts and other event-specific files. It only proposes a link when one profile name is a clear match; templates and marketing files are skipped.
          </p>
        </div>
        <Button disabled={scanning || linking} onClick={() => void findMatches()} type="button" variant="outline">
          <Search className="mr-2 h-4 w-4" />{scanning ? `Checking ${progress.complete}/${progress.total}` : "Find strong matches"}
        </Button>
      </div>
      {message ? <p className="mt-3 text-sm text-foreground" role="status">{message}</p> : null}
      {suggestions.length ? (
        <details className="mt-3 rounded-lg border border-border bg-background p-3">
          <summary className="cursor-pointer text-sm font-bold">Preview {suggestions.length} proposed links</summary>
          <div className="mt-3 grid max-h-80 gap-2 overflow-auto">
            {suggestions.map((suggestion) => (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm" key={suggestion.documentId}>
                <span><strong>{suggestion.documentName}</strong> → {suggestion.profile.name}</span>
                <span className="text-xs text-muted-foreground">{Math.round(suggestion.confidence * 100)}% · {suggestion.reason}</span>
              </div>
            ))}
          </div>
          <Button className="mt-3" disabled={linking} onClick={() => void linkMatches()} type="button">
            <Link2 className="mr-2 h-4 w-4" />{linking ? "Linking…" : `Link ${suggestions.length} strong matches`}
          </Button>
        </details>
      ) : null}
    </section>
  );
}
