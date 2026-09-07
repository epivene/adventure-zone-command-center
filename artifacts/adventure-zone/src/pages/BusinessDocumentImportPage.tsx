import { useState } from "react";
import { ArrowLeft, FolderSearch, Play } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { apiPost } from "@/lib/auth-token";

type ImportReport = { runId: string; discovered: number; imported: number; deduplicated: number; linked: number; review: number; skipped: number; retry: number; failed: number };

export default function BusinessDocumentImportPage() {
  const [folderText, setFolderText] = useState("");
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderIds = [...new Set(folderText.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean))];

  async function previewFolders() {
    setBusy(true); setError(null); setReport(null);
    try { setPreview(await apiPost<ImportReport>("/business-document-imports/drive/preview", { folderIds })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview Drive folders."); }
    finally { setBusy(false); }
  }

  async function startPilot() {
    if (!preview) return;
    setBusy(true); setError(null);
    try { setReport(await apiPost<ImportReport>("/business-document-imports/drive/start", { previewRunId: preview.runId, confirmation: "START PILOT", pilotLimit: 25 })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the Drive pilot."); }
    finally { setBusy(false); }
  }

  const displayed = report ?? preview;
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-5">
      <Link className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" href="/business-documents"><ArrowLeft className="h-4 w-4" />Business Documents</Link>
      <header><h1 className="text-3xl font-bold text-foreground">Import from Google Drive</h1><p className="mt-1 text-sm text-muted-foreground">Choose only approved Adventure Zone business folders. Preview is read-only and source files stay in Drive.</p></header>
      <section className="rounded-xl border border-border bg-card p-5">
        <label className="grid gap-2 text-sm font-bold text-foreground">Approved Drive folder IDs
          <textarea className="min-h-28 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm" onChange={(event) => { setFolderText(event.target.value); setPreview(null); setReport(null); }} placeholder="One folder ID per line" value={folderText} />
        </label>
        <p className="mt-2 text-xs text-muted-foreground">Only these roots and folders found underneath them will be inspected.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy || !folderIds.length} onClick={() => void previewFolders()}><FolderSearch className="mr-2 h-4 w-4" />Preview approved folders</Button>
          {preview && !report ? <Button disabled={busy} onClick={() => void startPilot()} variant="outline"><Play className="mr-2 h-4 w-4" />Start 25-file pilot</Button> : null}
        </div>
      </section>
      {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      {displayed ? (
        <section className="rounded-xl border border-border bg-card p-5" aria-label="Drive import results">
          <h2 className="font-bold text-foreground">{report ? "Pilot results" : "Preview results"}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["discovered", "imported", "deduplicated", "linked", "review", "skipped", "retry", "failed"] as const).map((key) => <div className="rounded-lg bg-muted p-3" key={key}><dt className="text-xs capitalize text-muted-foreground">{key}</dt><dd className="text-xl font-bold text-foreground">{displayed[key] ?? 0}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Drive originals are never deleted or moved.</p>
        </section>
      ) : null}
    </main>
  );
}
