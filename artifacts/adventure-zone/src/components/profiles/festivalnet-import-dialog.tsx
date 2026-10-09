import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Alert, AlertDescription } from "@workspace/avz-crm/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/avz-crm/components/ui/dialog";
import { apiFetch, apiPost } from "@/lib/auth-token";
import { FestivalNetEntryEditor, cleanDraft, fieldLabel } from "./festivalnet-entry-editor";
import type { FestivalNetDraft as Draft, FestivalNetPreview as Preview, FestivalNetImportResult as Result,
  FestivalNetBatchResult, FestivalNetMatches } from "@workspace/api-client-react";
export { fieldLabel } from "./festivalnet-entry-editor";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_BATCH_FILES = 25;
type Entry = {
  id: string; file: File; preview: Preview | null; draft: Draft | null;
  target: string | null; excluded: boolean; busy: boolean; error: string | null; result: Result | null; matchesStale: boolean;
};
const valid = (entry: Entry) => !!entry.draft?.name.trim() && Number.isInteger(entry.draft.year)
  && entry.draft.year >= 1900 && entry.draft.year <= 2200 && !!entry.target && !entry.matchesStale;

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) return "Your session expired. Sign in again, then retry.";
  if (res.status === 413) return "That PDF is larger than 10 MB.";
  const body = await res.json().catch(() => ({})) as { error?: string };
  return body.error ?? `Request failed (${res.status}).`;
}

export function FestivalNetImportDialog({ open, onOpenChange, onImported }: {
  open: boolean; onOpenChange(open: boolean): void; onImported?: () => void | Promise<void>;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  // Ref guards cover double clicks before React renders and queued parsing.
  const working = useRef(false);
  const parsing = useRef(false);
  const idCounter = useRef(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const patch = (id: string, change: Partial<Entry>) => setEntries(rows => rows.map(row => row.id === id ? { ...row, ...change } : row));
  function reset() {
    generation.current++;
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
    setEntries([]); setSelected(null); setNotice(null);
    parsing.current = false;
  }
  useEffect(() => () => {
    generation.current++;
    controllers.current.forEach(controller => controller.abort());
  }, []);
  // Also handle a parent closing the dialog directly.
  useEffect(() => { if (!open && !working.current) reset(); }, [open]);

  function close(next: boolean) {
    if (working.current) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function parseEntry(entry: Entry, run: number) {
    patch(entry.id, { busy: true, error: null });
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      if (entry.file.size > MAX_PDF_BYTES) throw new Error("That PDF is larger than 10 MB.");
      if (!entry.file.name.toLowerCase().endsWith(".pdf")) throw new Error("Choose a PDF file.");
      const res = await apiFetch(`/festivalnet-import/preview?filename=${encodeURIComponent(entry.file.name)}`, {
        method: "POST", headers: { "Content-Type": "application/pdf" }, body: entry.file, signal: controller.signal,
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const preview = await res.json() as Preview;
      if (run !== generation.current) return;
      patch(entry.id, { preview, draft: preview.draft, target: preview.candidates.length ? null : "new", error: null, matchesStale: false });
    } catch (error) {
      if (run === generation.current && !controller.signal.aborted) patch(entry.id, {
        error: error instanceof Error ? error.message : "Could not read this PDF.",
      });
    } finally {
      controllers.current.delete(controller);
      if (run === generation.current) patch(entry.id, { busy: false });
    }
  }

  async function choose(files: File[]) {
    if (!files.length || working.current || parsing.current) return;
    const available = MAX_BATCH_FILES - entriesRef.current.length;
    if (files.length > available) {
      setNotice(`Review up to ${MAX_BATCH_FILES} PDFs at a time. Choose ${available} or fewer additional files.`);
      return;
    }
    setNotice(null);
    const added: Entry[] = files.map(file => ({
      id: `pdf-${++idCounter.current}`, file, preview: null, draft: null, target: null,
      busy: true, excluded: false, error: null, result: null, matchesStale: false,
    }));
    const run = generation.current;
    parsing.current = true;
    setEntries(rows => [...rows, ...added]);
    setSelected(current => current ?? added[0].id);
    // Serial raw uploads keep memory bounded and respect the server's parser limit.
    for (const entry of added) {
      if (run !== generation.current) break;
      await parseEntry(entry, run);
    }
    if (run === generation.current) parsing.current = false;
  }

  async function retry(entry: Entry) {
    if (working.current || parsing.current || entry.busy || entry.result) return;
    const run = generation.current;
    parsing.current = true;
    if (!entry.draft) {
      await parseEntry(entry, run);
    } else {
      // A save failure or edited year must not discard the user's reviewed fields.
      patch(entry.id, { busy: true, error: null });
      try {
        const matches = await apiPost<FestivalNetMatches>("/festivalnet-import/matches", cleanDraft(entry.draft));
        if (run === generation.current) {
          const target = matches.candidates.some(candidate => candidate.id === entry.target) ? entry.target :
            matches.candidates.length ? null : "new";
          patch(entry.id, { preview: { ...entry.preview!, draft: entry.draft, candidates: matches.candidates }, target, matchesStale: false });
        }
      } catch (error) {
        if (run === generation.current) patch(entry.id, { error: error instanceof Error ? error.message : "Could not check matches." });
      } finally { if (run === generation.current) patch(entry.id, { busy: false }); }
    }
    if (run === generation.current) parsing.current = false;
  }

  const pending = entries.filter(entry => !entry.excluded && !entry.result);
  const busy = entries.some(entry => entry.busy);
  const canApply = pending.length > 0 && pending.every(valid) && !busy && !applying;
  const active = entries.find(entry => entry.id === selected);

  async function apply(only?: Entry) {
    const rows = only ? [only] : pending;
    if (working.current || parsing.current || busy || !rows.length || !rows.every(valid) ||
        rows.some(row => row.result || row.excluded)) return;
    working.current = true; setApplying(true); setNotice(null);
    const run = generation.current;
    try {
      const response = await apiPost<FestivalNetBatchResult>("/festivalnet-import/apply-batch", {
        confirmed: true,
        entries: rows.map(row => ({ entryId: row.id, draft: cleanDraft(row.draft!), organizationId: row.target === "new" ? null : row.target })),
      });
      if (run !== generation.current) return;
      let completed = false;
      for (const row of rows) {
        const outcome = response.outcomes.find(outcome => outcome.entryId === row.id);
        if (outcome?.result) {
          completed = true;
          patch(row.id, { result: outcome.result, error: null });
        } else patch(row.id, { error: outcome?.error ?? "No completion was received for this file. Keep the review and retry." });
      }
      if (completed) {
        try { await onImported?.(); }
        catch { setNotice("Imports were saved, but the profile list could not refresh. Reload it to see the saved profiles."); }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save. Keep this review and retry.";
      rows.forEach(row => patch(row.id, { error: `${message} If the response was lost, retrying will reuse the same source profile.` }));
    } finally { working.current = false; setApplying(false); }
  }

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" data-testid="dialog-festivalnet-import">
      <DialogHeader>
        <DialogTitle>Import FestivalNet PDFs</DialogTitle>
        <DialogDescription>Review each file, then confirm the included entries. Only missing information is filled; saved values and primary contacts are protected. PDFs are not stored or scanned with OCR.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="festivalnet-file">PDF files (max 10 MB each, 25 per review)</Label>
          <Input id="festivalnet-file" type="file" multiple accept="application/pdf,.pdf" disabled={applying || busy}
            onChange={event => { void choose(Array.from(event.target.files ?? [])); event.target.value = ""; }} data-testid="input-festivalnet-file" />
        </div>
        {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
        {entries.length > 0 && <>
          <p className="text-sm" role="status">{entries.filter(row => row.result).length} saved · {pending.length} remaining · {entries.filter(row => row.excluded).length} excluded</p>
          <ul className="grid gap-2" aria-label="PDF review rows">
            {entries.map(entry => <li key={entry.id} className="grid gap-2 rounded-md border p-3 text-sm" data-testid={`festivalnet-row-${entry.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" className="h-auto whitespace-normal text-left" onClick={() => setSelected(entry.id)} disabled={applying}>
                  {entry.file.name}
                </Button>
                <span>{entry.result ? "Saved" : entry.excluded ? "Excluded" : entry.busy ? "Reading / checking…" : entry.error ? "Needs attention" : "Review"}</span>
              </div>
              {entry.draft && <p>{entry.draft.name} · Year {Number.isFinite(entry.draft.year) ? entry.draft.year : "required"} · {entry.result ? (entry.result.created ? "New profile" : "Existing profile") : entry.target === "new" ? "New profile" : entry.target ? "Existing profile" : "Choose a matched profile"}</p>}
              {entry.preview && <p className="text-muted-foreground">Matched profiles: {entry.preview.candidates.map(candidate => candidate.name).join(", ") || "none"}</p>}
              {entry.matchesStale && <p className="text-sm text-muted-foreground">Name, location or year changed. Recheck matches before confirming this file.</p>}
              {entry.error && <Alert variant="destructive" data-testid="text-festivalnet-error"><AlertDescription>{entry.error}</AlertDescription></Alert>}
              {entry.result ? <div data-testid="festivalnet-result" className="grid gap-1">
                <p>{entry.result.created ? "New profile created." : "Profile updated."}</p>
                <p>Filled: {entry.result.filledFields.map(fieldLabel).join(", ") || "nothing new"}</p>
                <p>Kept as saved: {entry.result.preservedFields.map(fieldLabel).join(", ") || "none"}</p>
                <Button asChild variant="outline"><Link href={`/profiles/${entry.result.organizationId}`}>Open profile</Link></Button>
              </div> : <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={applying || entry.busy} onClick={() => patch(entry.id, { excluded: !entry.excluded })}>{entry.excluded ? "Include" : "Exclude"}</Button>
                <Button variant="outline" size="sm" disabled={applying || busy} onClick={() => void retry(entry)}>{entry.draft ? "Recheck matches" : "Retry PDF"}</Button>
                {entry.draft && <Button variant="outline" size="sm" disabled={applying || entry.excluded || entry.busy} onClick={() => setSelected(entry.id)}>Edit review</Button>}
                {entry.error && entry.draft && <Button size="sm" disabled={!valid(entry) || entry.excluded || applying || busy} onClick={() => void apply(entry)}>Confirm retry of this file</Button>}
              </div>}
            </li>)}
          </ul>
          {active?.preview && active.draft && !active.result && !active.excluded &&
            <FestivalNetEntryEditor key={active.id} preview={active.preview} draft={active.draft} target={active.target}
              disabled={applying || active.busy}
              onDraft={draft => {
                const identityChanged = ["name", "year", "city", "region"].some(key =>
                  draft[key as keyof Draft] !== active.draft![key as keyof Draft]);
                patch(active.id, { draft, ...(identityChanged ? { matchesStale: true, target: null } : {}) });
              }}
              onTarget={target => patch(active.id, { target })} />}
          <p className="text-sm text-muted-foreground">Unreadable files must be retried or excluded. Completed files are never sent again. Failed entries keep your edits and can be confirmed separately.</p>
        </>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={applying} onClick={() => close(false)}>Close</Button>
        {pending.length > 0 && <Button disabled={!canApply} onClick={() => void apply()} data-testid="button-festivalnet-apply">
          {applying ? "Saving…" : `Confirm import of ${pending.length} ${pending.length === 1 ? "file" : "files"}`}
        </Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
