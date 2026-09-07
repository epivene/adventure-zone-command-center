import { useEffect, useState } from "react";
import { AlertTriangle, Check, Clock3, RefreshCw, X } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import {
  businessDocumentsApi,
  type BusinessDocumentReviewItem,
} from "@/lib/business-documents-api";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function DocumentReviewQueue() {
  const [items, setItems] = useState<BusinessDocumentReviewItem[]>([]);
  const [correctedTarget, setCorrectedTarget] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try { setItems((await businessDocumentsApi.reviewItems()).items); }
    catch { setError("Could not load document reviews."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function act(item: BusinessDocumentReviewItem, body: Record<string, unknown>) {
    setBusyId(item.id);
    setError(null);
    try {
      await businessDocumentsApi.reviewAction(item.id, body);
      const remaining = items.filter((candidate) => candidate.id !== item.id);
      setItems(remaining);
      window.dispatchEvent(new CustomEvent("business-document-review-count-changed", { detail: remaining.length }));
    } catch {
      setError("Could not apply that document review action.");
    } finally { setBusyId(null); }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading document reviews…</p>;
  if (!items.length) return <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">No documents need review.</p>;

  return (
    <section className="grid gap-3" aria-label="Document review queue">
      {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      {items.map((item) => {
        const target = correctedTarget[item.id] ?? "";
        const targetValid = uuidPattern.test(target.trim());
        return (
          <article className="rounded-xl border border-amber-200 bg-amber-50/50 p-4" key={item.id}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <h2 className="font-bold text-foreground">{item.displayName}</h2>
                <p className="text-xs text-muted-foreground">{item.originalFilename} · {item.kind.replaceAll("_", " ")}</p>
                {item.reasonCodes.length ? <p className="mt-1 text-xs text-amber-800">{item.reasonCodes.join(", ").replaceAll("_", " ")}</p> : null}
              </div>
            </div>
            <label className="mt-3 grid max-w-lg gap-1 text-xs font-semibold text-foreground">
              Correct profile ID
              <Input aria-label={`Correct profile ID for ${item.displayName}`} onChange={(event) => setCorrectedTarget((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Profile UUID" value={target} />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={busyId === item.id} onClick={() => void act(item, { action: "approve" })} size="sm"><Check className="mr-1.5 h-3.5 w-3.5" />Approve</Button>
              <Button disabled={!targetValid || busyId === item.id} onClick={() => void act(item, { action: "correct_and_approve", corrections: { targets: [{ targetKind: "profile", targetId: target.trim() }] } })} size="sm" variant="outline">Correct and approve</Button>
              <Button disabled={busyId === item.id} onClick={() => void act(item, { action: "non_business" })} size="sm" variant="ghost"><X className="mr-1.5 h-3.5 w-3.5" />Not a business document</Button>
              <Button disabled={busyId === item.id} onClick={() => void act(item, { action: "defer", deferredUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })} size="sm" variant="ghost"><Clock3 className="mr-1.5 h-3.5 w-3.5" />Defer one day</Button>
              {item.kind === "source_failure" && item.lastErrorCode === "retry_required" ? <Button disabled={busyId === item.id} onClick={() => void act(item, { action: "retry" })} size="sm" variant="ghost"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button> : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
