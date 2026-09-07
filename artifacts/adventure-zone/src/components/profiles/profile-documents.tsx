import { useEffect, useState } from "react";
import { ExternalLink, FileText, Unlink } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  businessDocumentsApi,
  type BusinessDocumentRecord,
} from "@/lib/business-documents-api";

export function ProfileDocuments({ profileId }: { profileId: string }) {
  const [documents, setDocuments] = useState<BusinessDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    Promise.resolve(businessDocumentsApi.forProfile(profileId))
      .then((result) => { if (current) setDocuments(result?.documents ?? []); })
      .catch(() => { if (current) setError("Could not load profile documents."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [profileId]);

  async function openDocument(document: BusinessDocumentRecord) {
    setBusyId(document.id);
    setError(null);
    try {
      const url = await businessDocumentsApi.open(document.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("That protected file is not available right now.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeFromProfile(document: BusinessDocumentRecord) {
    const link = document.links.find((candidate) => candidate.targetKind === "profile" && candidate.targetId === profileId);
    if (!link) return;
    setBusyId(document.id);
    setError(null);
    try {
      await businessDocumentsApi.unlink(document.id, link.id);
      setDocuments((current) => current.filter((candidate) => candidate.id !== document.id));
    } catch {
      setError("Could not remove this document from the profile.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Documents</h2>
          <p className="text-sm text-slate-600">Protected business files linked to this profile.</p>
        </div>
        <a className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline" href={`/business-documents?profileId=${profileId}`}>
          Open document library <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {loading ? <p className="mt-3 text-sm text-slate-500">Loading documents…</p> : null}
      {!loading && !documents.length ? <p className="mt-3 text-sm text-slate-500">No business documents are linked yet.</p> : null}

      {documents.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {documents.map((document) => (
            <article className="rounded-lg border border-slate-200 p-3" key={document.id}>
              <div className="flex items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{document.displayName}</p>
                  <Badge className="mt-1" variant="secondary">{document.category.replaceAll("_", " ")}</Badge>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={!document.fileAvailable || busyId === document.id} onClick={() => void openDocument(document)} size="sm" variant="outline">
                  Open file
                </Button>
                <Button disabled={busyId === document.id} onClick={() => void removeFromProfile(document)} size="sm" variant="ghost">
                  <Unlink className="mr-1.5 h-3.5 w-3.5" />Remove from this profile
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
