import { useEffect, useState } from "react";
import { AlertTriangle, Check, Clock3, RefreshCw, X } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import {
  businessDocumentsApi,
  type BusinessDocumentCategory,
  type BusinessDocumentProfileOption,
  type BusinessDocumentReviewItem,
} from "@/lib/business-documents-api";

const categoryOptions: Array<{ value: BusinessDocumentCategory; label: string }> = [
  { value: "contract", label: "Contract" },
  { value: "proposal", label: "Proposal" },
  { value: "coi", label: "COI / certificate of insurance" },
  { value: "insurance_policy", label: "Insurance policy" },
  { value: "w9_tax", label: "W-9 / tax document" },
  { value: "permit", label: "Permit" },
  { value: "vendor_application", label: "Vendor application" },
  { value: "inspection", label: "Inspection" },
  { value: "deposit_receipt", label: "Deposit receipt" },
  { value: "operational_template", label: "Operational template" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

type DocumentReviewQueueProps = {
  api?: Pick<typeof businessDocumentsApi, "reviewItems" | "searchProfiles" | "reviewAction" | "open">;
};

export function DocumentReviewQueue({ api = businessDocumentsApi }: DocumentReviewQueueProps = {}) {
  const [items, setItems] = useState<BusinessDocumentReviewItem[]>([]);
  const [categories, setCategories] = useState<Record<string, BusinessDocumentCategory>>({});
  const [profileQueries, setProfileQueries] = useState<Record<string, string>>({});
  const [profileResults, setProfileResults] = useState<Record<string, BusinessDocumentProfileOption[]>>({});
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, BusinessDocumentProfileOption | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try { setItems((await api.reviewItems()).items); }
    catch { setError("Could not load document reviews."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function searchProfiles(item: BusinessDocumentReviewItem) {
    const query = profileQueries[item.id]?.trim() ?? "";
    if (!query) return;
    setSearchingId(item.id);
    setError(null);
    try {
      const results = await api.searchProfiles(query);
      setProfileResults((current) => ({ ...current, [item.id]: results }));
    } catch {
      setError("Could not search profiles.");
    } finally {
      setSearchingId(null);
    }
  }

  async function act(item: BusinessDocumentReviewItem, body: Record<string, unknown>) {
    setBusyId(item.id);
    setError(null);
    try {
      await api.reviewAction(item.id, body);
      const remaining = items.filter((candidate) => candidate.id !== item.id);
      setItems(remaining);
      window.dispatchEvent(new CustomEvent("business-document-review-count-changed", { detail: remaining.length }));
    } catch {
      setError("Could not apply that document review action.");
    } finally { setBusyId(null); }
  }

  async function openDocument(item: BusinessDocumentReviewItem) {
    setOpeningId(item.id);
    setError(null);
    try {
      const url = await api.open(item.documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("That protected file is not available right now.");
    } finally {
      setOpeningId(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading document reviews…</p>;
  if (!items.length) return <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">No documents need review.</p>;

  return (
    <section className="grid gap-3" aria-label="Document review queue">
      {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
      {items.map((item) => {
        const category = categories[item.id] ?? item.category;
        const profileQuery = profileQueries[item.id] ?? "";
        const selectedProfile = selectedProfiles[item.id];
        const results = profileResults[item.id] ?? [];
        const hasCorrections = category !== item.category || Boolean(selectedProfile);
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
            <div className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-semibold text-foreground">
                Document type
                <select aria-label={`Document type for ${item.displayName}`} className="h-9 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setCategories((current) => ({ ...current, [item.id]: event.target.value as BusinessDocumentCategory }))} value={category}>
                  {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className="grid gap-1 text-xs font-semibold text-foreground">
                Profile <span className="font-normal text-muted-foreground">(optional)</span>
                <div className="flex gap-2">
                  <Input aria-label={`Profile search for ${item.displayName}`} onChange={(event) => {
                    setProfileQueries((current) => ({ ...current, [item.id]: event.target.value }));
                    setSelectedProfiles((current) => ({ ...current, [item.id]: undefined }));
                    setProfileResults((current) => ({ ...current, [item.id]: [] }));
                  }} placeholder="Search profile name or city" value={profileQuery} />
                  <Button disabled={!profileQuery.trim() || searchingId === item.id} onClick={() => void searchProfiles(item)} size="sm" type="button" variant="outline">Search profiles</Button>
                </div>
              </div>
            </div>
            {results.length ? <div className="mt-2 grid max-w-2xl gap-1 rounded-lg border bg-background p-1">{results.map((profile) => <button className={selectedProfile?.id === profile.id ? "rounded-md bg-orange-100 px-3 py-2 text-left text-sm" : "rounded-md px-3 py-2 text-left text-sm hover:bg-muted"} key={profile.id} onClick={() => {
              setSelectedProfiles((current) => ({ ...current, [item.id]: profile }));
              setProfileQueries((current) => ({ ...current, [item.id]: profile.name }));
              setProfileResults((current) => ({ ...current, [item.id]: [] }));
            }} type="button"><strong>{profile.name}</strong>{profile.city || profile.region ? <span className="ml-2 text-muted-foreground">{[profile.city, profile.region].filter(Boolean).join(", ")}</span> : null}</button>)}</div> : null}
            {selectedProfile ? <p className="mt-2 text-xs font-semibold text-emerald-700">Selected profile: {selectedProfile.name}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button aria-label={`Open protected file for ${item.displayName}`} disabled={openingId === item.id} onClick={() => void openDocument(item)} size="sm" type="button" variant="outline">
                {openingId === item.id ? "Opening…" : "Open protected file"}
              </Button>
              <Button disabled={hasCorrections || busyId === item.id} onClick={() => void act(item, { action: "approve" })} size="sm"><Check className="mr-1.5 h-3.5 w-3.5" />Approve as shown</Button>
              <Button disabled={!hasCorrections || busyId === item.id} onClick={() => void act(item, { action: "correct_and_approve", corrections: {
                category,
                ...(selectedProfile ? { targets: [{ targetKind: "profile", targetId: selectedProfile.id }] } : {}),
              } })} size="sm" variant="outline">Save corrections and approve</Button>
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
