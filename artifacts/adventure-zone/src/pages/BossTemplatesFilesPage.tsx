import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Download, FileText, FolderOpen, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import type { BusinessDocumentRecord } from "@/lib/business-documents-api";
import { bossBusinessDocumentsApi } from "@/lib/boss-documents-api";

type Sort = "newest" | "oldest" | "name_asc" | "name_desc";

const categories: Array<{ value: string; label: string }> = [
  { value: "", label: "All document types" },
  { value: "contract", label: "Contracts" },
  { value: "vendor_application", label: "Vendor applications" },
  { value: "coi", label: "Certificates of insurance" },
  { value: "insurance_policy", label: "Insurance policies" },
  { value: "operational_template", label: "Templates" },
  { value: "proposal", label: "Proposals" },
  { value: "w9_tax", label: "W-9 and tax" },
  { value: "permit", label: "Permits" },
  { value: "inspection", label: "Inspections" },
  { value: "deposit_receipt", label: "Deposit receipts" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sortDocuments(documents: BusinessDocumentRecord[], sort: Sort) {
  return [...documents].sort((left, right) => {
    if (sort === "name_asc") return left.displayName.localeCompare(right.displayName);
    if (sort === "name_desc") return right.displayName.localeCompare(left.displayName);
    const difference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    return sort === "oldest" ? -difference : difference;
  });
}

export default function BossTemplatesFilesPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<BusinessDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<Sort>("newest");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await bossBusinessDocumentsApi.listAll();
      setDocuments(result.documents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load business documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const visibleDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sortDocuments(documents.filter((document) => {
      if (category && document.category !== category) return false;
      return !normalizedQuery || [document.displayName, document.originalFilename, document.notes ?? ""]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    }), sort);
  }, [category, documents, query, sort]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await bossBusinessDocumentsApi.upload(file);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload that document.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function open(document: BusinessDocumentRecord) {
    setBusyId(document.id);
    setError(null);
    try {
      const url = await bossBusinessDocumentsApi.open(document.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("That protected file is not available right now.");
    } finally {
      setBusyId(null);
    }
  }

  async function archive(document: BusinessDocumentRecord) {
    setBusyId(document.id);
    setError(null);
    try {
      await bossBusinessDocumentsApi.archive(document.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not archive that document.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(document: BusinessDocumentRecord) {
    if (!window.confirm(`Permanently delete ${document.displayName}? This cannot be undone.`)) return;
    setBusyId(document.id);
    setError(null);
    try {
      await bossBusinessDocumentsApi.delete(document.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that document.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-5" data-testid="boss-business-documents-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Business Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">The same protected document library used by Admin and Des.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
            aria-label="Choose document to upload"
            className="sr-only"
            onChange={(event) => void upload(event.target.files?.[0])}
            ref={fileInput}
            type="file"
          />
          <Button disabled={uploading} onClick={() => fileInput.current?.click()} size="sm">
            <Upload className="mr-2 h-4 w-4" />{uploading ? "Uploading…" : "Upload document"}
          </Button>
          <Button asChild size="sm" variant="outline"><Link href="/boss/coi">Manage COIs</Link></Button>
          <Button disabled={loading} onClick={() => void load()} size="sm" variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </header>

      <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="relative block">
          <span className="sr-only">Search documents</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="Search documents" className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm" onChange={(event) => setQuery(event.target.value)} placeholder="Search documents" type="search" value={query} />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          <span className="sr-only">Document type</span>
          <select aria-label="Document type" className="rounded-lg border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setCategory(event.target.value)} value={category}>
            {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          <span className="sr-only">Sort documents</span>
          <select aria-label="Sort documents" className="rounded-lg border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setSort(event.target.value as Sort)} value={sort}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-3">Showing {visibleDocuments.length} of {documents.length} documents</p>
      </section>

      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}
      {loading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((item) => <Skeleton className="h-40 rounded-xl" key={item} />)}</div> : null}
      {!loading && !visibleDocuments.length ? (
        <section className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-bold text-foreground">{documents.length ? "No documents match" : "No business documents yet"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{documents.length ? "Try changing the search or document type." : "Upload the first protected business document."}</p>
        </section>
      ) : null}
      {!loading && visibleDocuments.length ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleDocuments.map((document) => (
            <article className="rounded-xl border border-border bg-card p-4 shadow-sm" key={document.id}>
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1"><h2 className="truncate font-bold text-foreground">{document.displayName}</h2><p className="truncate text-xs text-muted-foreground">{document.originalFilename}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2"><Badge variant="secondary">{titleCase(document.category)}</Badge>{document.reviewState === "needs_review" ? <Badge variant="outline">Needs review</Badge> : null}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={!document.fileAvailable || busyId === document.id} onClick={() => void open(document)} size="sm" variant="outline"><Download className="mr-1.5 h-3.5 w-3.5" />Open</Button>
                <Button disabled={busyId === document.id} onClick={() => void archive(document)} size="sm" variant="ghost"><Archive className="mr-1.5 h-3.5 w-3.5" />Archive</Button>
                <Button disabled={busyId === document.id} onClick={() => void remove(document)} size="sm" variant="ghost"><Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete</Button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
