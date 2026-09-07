import { useEffect, useState } from "react";
import { FileText, FolderOpen, Upload } from "lucide-react";
import { Link, useSearch } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  businessDocumentsApi,
  type BusinessDocumentRecord,
} from "@/lib/business-documents-api";

type View = "all" | "templates" | "insurance" | "review";

const views: Array<{ id: View; label: string }> = [
  { id: "all", label: "All Documents" },
  { id: "templates", label: "Templates" },
  { id: "insurance", label: "COIs & Insurance" },
  { id: "review", label: "Needs Review" },
];

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function visibleInView(document: BusinessDocumentRecord, view: View) {
  if (view === "templates") return document.category === "operational_template";
  if (view === "insurance") return document.category === "coi" || document.category === "insurance_policy";
  if (view === "review") return document.reviewState === "needs_review";
  return true;
}

export default function BusinessDocumentsPage() {
  const search = useSearch();
  const profileId = new URLSearchParams(search).get("profileId") ?? undefined;
  const [view, setView] = useState<View>("all");
  const [documents, setDocuments] = useState<BusinessDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    businessDocumentsApi.list({ profileId, limit: 100 })
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

  const visibleDocuments = documents.filter((document) => visibleInView(document, view));

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

      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Loading documents…</p> : null}

      {!loading && !visibleDocuments.length ? (
        <section className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-bold text-foreground">No business documents yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Import files from Google Workspace or upload a protected copy.</p>
        </section>
      ) : null}

      {visibleDocuments.length ? (
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
