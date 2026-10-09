import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@workspace/avz-crm/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/avz-crm/components/ui/dialog";
import { apiFetch, apiPost } from "@/lib/auth-token";
import { editionGroups } from "./festival-edition-fields";
import type {
  FestivalNetDraft as Draft, FestivalNetPreview as Preview,
  FestivalNetImportResult as Result,
} from "@workspace/api-client-react";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const topFields = [
  ["city", "City"], ["region", "State / region"], ["address1", "Address"], ["postalCode", "Postal code"],
  ["phone", "Phone"], ["website", "Website"], ["contactName", "Contact name"],
  ["contactEmail", "Contact email"], ["contactPhone", "Contact phone"],
] as const;

const fieldLabels: Record<string, string> = {
  name: "Name", year: "Year", sourceUrl: "FestivalNet link", sourceFilename: "Source file",
  importFileSha256: "Source fingerprint",
  ...Object.fromEntries(topFields),
  ...Object.fromEntries(editionGroups.flatMap((g) => g.fields.map((f) => [f.key, f.label]))),
};
export function fieldLabel(key: string): string {
  const bare = key.replace(/^details\./, "");
  return fieldLabels[bare] ?? bare.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) return "Your session expired. Sign in again, then retry.";
  if (res.status === 413) return "That PDF is larger than 10 MB.";
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (body?.error) return body.error;
  if (res.status === 400) return "This PDF could not be read. Scanned or damaged PDFs are not supported.";
  return `Request failed (${res.status}).`;
}

export function FestivalNetImportDialog({
  open, onOpenChange, onImported,
}: { open: boolean; onOpenChange(open: boolean): void; onImported?: () => void | Promise<void> }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [target, setTarget] = useState<string | null>(null); // candidate id | "new" | null
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const runId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  function reset() {
    abortRef.current?.abort();
    runId.current += 1;
    setPreview(null); setDraft(null); setTarget(null); setParsing(false);
    setApplying(false); setError(null); setResult(null);
  }
  useEffect(() => () => abortRef.current?.abort(), []);

  function handleOpenChange(next: boolean) {
    if (applying) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function choose(file: File | undefined) {
    if (!file || applying) return;
    abortRef.current?.abort();
    const id = ++runId.current;
    setParsing(false);
    setError(null); setResult(null); setPreview(null); setDraft(null); setTarget(null);
    if (file.size > MAX_PDF_BYTES) { setError("That PDF is larger than 10 MB."); return; }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file."); return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setParsing(true);
    try {
      const res = await apiFetch(`/festivalnet-import/preview?filename=${encodeURIComponent(file.name)}`, {
        method: "POST", headers: { "Content-Type": "application/pdf" }, body: file, signal: ctrl.signal,
      });
      if (id !== runId.current) return;
      if (!res.ok) throw new Error(await errorMessage(res));
      const data = (await res.json()) as Preview;
      if (id !== runId.current) return;
      setPreview(data); setDraft(data.draft);
      setTarget(data.candidates.length === 0 ? "new" : null);
    } catch (e: any) {
      if (id !== runId.current || e?.name === "AbortError") return;
      setError(e?.message ?? "Could not read this PDF.");
    } finally {
      if (id === runId.current) setParsing(false);
    }
  }

  const candidate = preview?.candidates.find((c) => c.id === target) ?? null;

  const conflicts = useMemo(() => {
    if (!candidate || !draft) return [] as { key: string; incoming: string; saved: string }[];
    const incoming: Record<string, string> = { ...draft.details, name: draft.name, sourceUrl: draft.sourceUrl, sourceFilename: draft.sourceFilename };
    for (const [k] of topFields) { const v = (draft as any)[k]; if (v) incoming[k] = String(v); }
    const savedFields = { ...candidate.existingFields, ...(draft.year === preview?.draft.year ? candidate.details : {}) };
    return Object.entries(savedFields)
      .filter(([k, saved]) => saved && incoming[k] && incoming[k].trim() !== saved.trim())
      .map(([key, saved]) => ({ key, incoming: incoming[key], saved }));
  }, [candidate, draft]);

  const nameOk = !!draft?.name.trim();
  const yearOk = !!draft && Number.isInteger(draft.year) && draft.year >= 1900 && draft.year <= 2200;
  const canApply = !!draft && !!target && nameOk && yearOk && !applying && !parsing;

  function setTop(key: string, value: string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }
  function setDetail(key: string, value: string) {
    setDraft((d) => (d ? { ...d, details: { ...d.details, [key]: value } } : d));
  }

  async function apply() {
    if (!draft || !target || !canApply) return;
    const clean: Draft = { ...draft, name: draft.name.trim(), details: {} };
    for (const [k] of topFields) {
      const v = (draft as any)[k]?.trim?.();
      if (v) (clean as any)[k] = v; else delete (clean as any)[k];
    }
    for (const [k, v] of Object.entries(draft.details)) if (v.trim()) clean.details[k] = v.trim();
    setApplying(true); setError(null);
    try {
      const r = await apiPost<Result>("/festivalnet-import/apply", {
        draft: clean, organizationId: target === "new" ? null : target,
      });
      setResult(r);
      try { await onImported?.(); } catch { /* directory refresh is best effort */ }
    } catch (e: any) {
      setError(e?.message ?? "Could not save the import. Your review is kept; try again.");
    } finally { setApplying(false); }
  }

  const detailKeys = new Set(Object.keys(draft?.details ?? {}).filter(key => key !== "importFileSha256"));
  const known = new Set(editionGroups.flatMap((g) => g.fields.map((f) => f.key)));
  const groups = [
    ...editionGroups.map((g) => ({ title: g.title, keys: g.fields.map((f) => f.key).filter((k) => detailKeys.has(k)) })),
    { title: "Other details", keys: [...detailKeys].filter((k) => !known.has(k)) },
  ].filter((g) => g.keys.length > 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" data-testid="dialog-festivalnet-import">
        <DialogHeader>
          <DialogTitle>Import FestivalNet PDF</DialogTitle>
          <DialogDescription>
            Review what was found. Only missing information is filled in; existing values are never overwritten. The PDF itself is not stored.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="grid gap-3 text-sm" data-testid="festivalnet-result">
            <p className="font-semibold">{result.created ? "New profile created." : "Profile updated."}</p>
            <p><span className="font-semibold">Filled:</span> {result.filledFields.length ? result.filledFields.map(fieldLabel).join(", ") : "nothing new"}</p>
            <p><span className="font-semibold">Kept as saved:</span> {result.preservedFields.length ? result.preservedFields.map(fieldLabel).join(", ") : "none"}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)} type="button">Close</Button>
              <Button asChild><Link href={`/profiles/${result.organizationId}`} data-testid="link-imported-profile">Open profile</Link></Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="festivalnet-file">PDF file (max 10 MB)</Label>
              <Input id="festivalnet-file" type="file" accept="application/pdf,.pdf" disabled={applying}
                onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-festivalnet-file" />
              {parsing ? <p className="text-sm text-muted-foreground" role="status">Reading PDF…</p> : null}
            </div>

            {error ? <Alert variant="destructive" data-testid="text-festivalnet-error"><AlertDescription>{error}</AlertDescription></Alert> : null}

            {preview && draft ? (
              <>
                {preview.warnings.length > 0 ? (
                  <Alert data-testid="list-festivalnet-warnings">
                    <AlertTitle>Review before importing</AlertTitle>
                    <AlertDescription><ul className="grid gap-1 text-sm">
                      {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul></AlertDescription>
                  </Alert>
                ) : null}

                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-semibold">Save to</legend>
                  <RadioGroup value={target ?? ""} onValueChange={setTarget} disabled={applying} aria-label="Existing profile">
                  {preview.candidates.map((c) => (
                    <label key={c.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                      <RadioGroupItem value={c.id} className="mt-1" data-testid={`radio-target-${c.id}`} />
                      <span><span className="font-semibold">{c.name}</span>{[c.city, c.region].filter(Boolean).length ? <span className="text-muted-foreground"> · {[c.city, c.region].filter(Boolean).join(", ")}</span> : null}</span>
                    </label>
                  ))}
                  </RadioGroup>
                  {preview.candidates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No matching profile found. A new profile will be created.</p>
                  ) : <p className="text-sm text-muted-foreground">Possible matches found. Choose the profile to update.</p>}
                </fieldset>

                {conflicts.length > 0 ? (
                  <div className="rounded-md border p-3 text-sm" data-testid="list-festivalnet-conflicts">
                    <p className="mb-2 font-semibold">Already saved — these stay as they are</p>
                    <ul className="grid gap-2">
                      {conflicts.map((c) => (
                        <li key={c.key}><span className="font-semibold">{fieldLabel(c.key)}</span>
                          <div className="text-muted-foreground">Saved: {c.saved}</div>
                          <div className="text-muted-foreground">Incoming (ignored): {c.incoming}</div></li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="fn-name">Name</Label>
                    <Input id="fn-name" value={draft.name} onChange={(e) => setTop("name", e.target.value)} aria-invalid={!nameOk} disabled={applying} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="fn-year">Year</Label>
                    <Input id="fn-year" type="number" value={Number.isFinite(draft.year) ? draft.year : ""} onChange={(e) => setDraft({ ...draft, year: e.target.value === "" ? NaN : Number(e.target.value) })} aria-invalid={!yearOk} disabled={applying} />
                  </div>
                  {topFields.filter(([k]) => k in draft || true).map(([k, label]) => (
                    <div className="grid gap-1" key={k}>
                      <Label htmlFor={`fn-${k}`}>{label} <span className="text-muted-foreground">(optional)</span></Label>
                      <Input id={`fn-${k}`} value={(draft as any)[k] ?? ""} onChange={(e) => setTop(k, e.target.value)} disabled={applying} />
                    </div>
                  ))}
                  <div className="grid gap-1 sm:col-span-2">
                    <Label htmlFor="fn-source">Source (read-only)</Label>
                    <Input id="fn-source" readOnly value={draft.sourceUrl || draft.sourceFilename} />
                  </div>
                </div>

                {groups.map((g) => (
                  <section key={g.title} className="grid gap-2">
                    <h3 className="text-sm font-semibold">{g.title}</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {g.keys.map((k) => (
                        <div className="grid gap-1" key={k}>
                          <Label htmlFor={`fn-d-${k}`}>{fieldLabel(k)}</Label>
                          <Input id={`fn-d-${k}`} value={draft.details[k] ?? ""} onChange={(e) => setDetail(k, e.target.value)} disabled={applying} />
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
                <p className="text-sm text-muted-foreground">Clear any optional value to leave it out of the import.</p>
              </>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={applying} type="button">Cancel</Button>
              {draft ? (
                <Button onClick={() => void apply()} disabled={!canApply} type="button" data-testid="button-festivalnet-apply">
                  {applying ? "Saving…" : "Import missing information"}
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
