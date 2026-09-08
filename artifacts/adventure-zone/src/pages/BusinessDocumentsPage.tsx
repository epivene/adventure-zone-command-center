import { useEffect, useState } from "react";
import { FileText, FolderOpen, Search, SlidersHorizontal, Upload } from "lucide-react";
import { Link, useSearch } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  businessDocumentsApi,
  type BusinessDocumentRecord,
} from "@/lib/business-documents-api";
import { DocumentReviewQueue } from "@/components/business-documents/document-review-queue";

type View = "all" | "contracts" | "vendor_applications" | "templates" | "insurance" | "review";

const views: Array<{ id: View; label: string }> = [
  { id: "all", label: "All Documents" },
  { id: "contracts", label: "Contracts" },
  { id: "vendor_applications", label: "Vendor Applications" },
  { id: "templates", label: "Templates" },
  { id: "insurance", label: "COIs & Insurance" },
  { id: "review", label: "Needs Review" },
];

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function visibleInView(document: BusinessDocumentRecord, view: View) {
  if (view === "contracts") return document.category === "contract";
  if (view === "vendor_applications") return document.category === "vendor_application";
  if (view === "templates") return document.category === "operational_template";
  if (view === "insurance") return document.category === "coi" || document.category === "insurance_policy";
  if (view === "review") return document.reviewState === "needs_review";
  return true;
}

const categories: BusinessDocumentRecord["category"][] = [
  "contract", "proposal", "coi", "insurance_policy", "w9_tax", "permit",
  "vendor_application", "inspection", "deposit_receipt", "operational_template", "marketing", "other",
];

function yearsFor(document: BusinessDocumentRecord) {
  const values = [document.effectiveDate, document.issueDate, document.expirationDate, document.displayName, document.originalFilename];
  const years = new Set(values.flatMap((value) => value?.match(/\b20\d{2}\b/g) ?? []));
  if (!years.size) years.add(document.createdAt.slice(0, 4));
  return years;
}

export default function BusinessDocumentsPage() {
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const profileId = searchParams.get("profileId") ?? undefined;
  const [view, setView] = useState<View>(() => searchParams.get("view") === "review" ? "review" : "all");
  const [documents, setDocuments] = useState<BusinessDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [reviewState, setReviewState] = useState("");
  const [source, setSource] = useState("");
  const [linkState, setLinkState] = useState("");
  const [year, setYear] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    businessDocumentsApi.listAll({ profileId })
      .then((result) => { if (current) setDocuments(result.documents); })
      .catch(() => { if (current) setError("Could not load business documents."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [profileId]);

  async function openDocument(document: BusinessDocumentRecord) {
    setOpeningId(document.id);
    setError(null);
    try {
      const url = await businessDocumentsApi.open(document.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("That protected file is not available right now.");
    } finally {
      setOpeningId(null);
    }
  }

  const years = [...new Set(documents.flatMap((document) => [...yearsFor(document)]))].sort().reverse();
  const normalizedQuery = query.trim().toLowerCase();
  const visibleDocuments = documents.filter((document) => {
    if (!visibleInView(document, view)) return false;
    if (normalizedQuery && ![document.displayName, document.originalFilename, document.notes ?? ""].some((value) => value.toLowerCase().includes(normalizedQuery))) return false;
    if (category && document.category !== category) return false;
    if (reviewState && document.reviewState !== reviewState) return false;
    if (source && !document.sourceKinds.includes(source as BusinessDocumentRecord["sourceKinds"][number])) return false;
    if (linkState === "linked" && !document.links.length) return false;
    if (linkState === "unlinked" && document.links.length) return false;
    if (year && !yearsFor(document).has(year)) return false;
    return true;
  });
  const activeFilterCount = [category, reviewState, source, linkState, year].filter(Boolean).length;

  function resetFilters() {
    setQuery("");
    setCategory("");
    setReviewState("");
    setSource("");
    setLinkState("");
    setYear("");
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Owner file system</p>
          <h1 className="text-3xl font-bold text-foreground">Business Documents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Contracts, certificates, templates, and other Adventure Zone business files in one protected library.
          </p>
        </div>
        <Button asChild>
          <Link href="/business-documents/import"><Upload className="mr-2 h-4 w-4" />Import business documents</Link>
        </Button>
      </header>

      <div aria-label="Business document views" className="flex flex-wrap gap-2" role="tablist">
        {views.map((item) => (
          <button
            aria-selected={view === item.id}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === item.id ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground hover:bg-muted"}`}
            key={item.id}
            onClick={() => setView(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {view !== "review" ? (
        <section className="grid gap-3 rounded-xl border border-border bg-card p-4">
          <label className="relative block">
            <span className="sr-only">Search documents</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Search documents"
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search document names or filenames"
              type="search"
              value={query}
            />
          </label>
          <details className="rounded-lg border border-border bg-background p-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold">
              <SlidersHorizontal className="h-4 w-4" />Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="grid gap-1 text-xs font-semibold">Document type
                <select className="rounded-md border border-input bg-background px-2 py-2 text-sm" onChange={(event) => setCategory(event.target.value)} value={category}>
                  <option value="">All types</option>
                  {categories.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold">Review status
                <select className="rounded-md border border-input bg-background px-2 py-2 text-sm" onChange={(event) => setReviewState(event.target.value)} value={reviewState}>
                  <option value="">All statuses</option><option value="accepted">Accepted</option><option value="needs_review">Needs review</option><option value="rejected">Rejected</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold">Document source
                <select className="rounded-md border border-input bg-background px-2 py-2 text-sm" onChange={(event) => setSource(event.target.value)} value={source}>
                  <option value="">All sources</option><option value="drive">Google Drive</option><option value="gmail">Gmail</option><option value="manual">Uploaded</option><option value="business_source">Existing app file</option><option value="google_profile_file">Profile file</option><option value="design_asset">Design asset</option><option value="design_output">Design output</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold">Link status
                <select className="rounded-md border border-input bg-background px-2 py-2 text-sm" onChange={(event) => setLinkState(event.target.value)} value={linkState}>
                  <option value="">Linked or unlinked</option><option value="linked">Linked to a profile/event</option><option value="unlinked">Not linked</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold">Document year
                <select className="rounded-md border border-input bg-background px-2 py-2 text-sm" onChange={(event) => setYear(event.target.value)} value={year}>
                  <option value="">All years</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <Button className="mt-3" onClick={resetFilters} size="sm" type="button" variant="outline">Reset filters</Button>
          </details>
          <p className="text-xs text-muted-foreground">Showing {visibleDocuments.length} of {documents.filter((document) => visibleInView(document, view)).length} documents</p>
        </section>
      ) : null}

      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading documents…</p> : null}

      {view === "review" ? <DocumentReviewQueue /> : null}

      {view !== "review" && !loading && !visibleDocuments.length ? (
        <section className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-bold text-foreground">{documents.length ? "No documents match" : "No business documents yet"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{documents.length ? "Try changing the search or filters." : "Import files from Google Workspace or upload a protected copy."}</p>
        </section>
      ) : null}

      {view !== "review" && visibleDocuments.length ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleDocuments.map((document) => (
            <article className="rounded-xl border border-border bg-card p-4 shadow-sm" key={document.id}>
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-bold text-foreground">{document.displayName}</h2>
                  <p className="truncate text-xs text-muted-foreground">{document.originalFilename}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary">{titleCase(document.category)}</Badge>
                {document.reviewState === "needs_review" ? <Badge variant="outline">Needs review</Badge> : null}
              </div>
              <Button
                className="mt-4"
                disabled={!document.fileAvailable || openingId === document.id}
                onClick={() => void openDocument(document)}
                size="sm"
                variant="outline"
              >
                {openingId === document.id ? "Opening…" : document.fileAvailable ? "Open protected file" : "File unavailable"}
              </Button>
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
