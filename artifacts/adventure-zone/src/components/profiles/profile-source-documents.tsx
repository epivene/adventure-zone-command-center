import { useEffect, useState } from "react";

import { ProfileGoogleEmailPanel } from "@/components/google-workspace/profile-google-email-panel";
import { apiGet, apiPost } from "@/lib/auth-token";
import { officeGet } from "@/lib/office-auth-context";

type ProfileSourceDocument = {
  id: string;
  title: string;
  category: string;
  effectiveYear: number | null;
  hasFile: boolean;
  canOpenFile: boolean;
  historicalTerms: Array<{
    label: string;
    value: string;
    sourceLocator: string;
  }>;
};

export function ProfileSourceDocuments({
  mode,
  profileId,
}: {
  mode: "owner" | "office";
  profileId: string;
}) {
  const [documents, setDocuments] = useState<ProfileSourceDocument[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = mode === "office"
      ? officeGet<{ sourceDocuments: ProfileSourceDocument[] }>(`/office/profiles/${profileId}/source-documents`)
      : apiGet<{ sourceDocuments: ProfileSourceDocument[] }>(`/event-profiles/${profileId}/source-documents`);
    void load
      .then((result) => {
        if (active) setDocuments(result.sourceDocuments ?? []);
      })
      .catch(() => {
        if (active) setDocuments([]);
      });
    return () => { active = false; };
  }, [mode, profileId]);

  async function openDocument(document: ProfileSourceDocument) {
    if (mode !== "owner" || !document.canOpenFile || busyId) return;
    setBusyId(document.id);
    setError("");
    try {
      const result = await apiPost<{ url: string }>(`/business-sources/${document.id}/file/open`, {});
      if (!result.url) throw new Error("The protected document did not return a signed file link.");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the document.");
    } finally {
      setBusyId(null);
    }
  }

  if (mode === "office" && !documents.length) return null;

  return (
    <div className="grid gap-4">
      {mode === "owner" ? <ProfileGoogleEmailPanel organizationId={profileId} /> : null}
      {documents.length ? (
        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Historical evidence</p>
            <h2 className="mt-1 text-xl font-bold">Source documents</h2>
            <p className="mt-1 text-sm text-slate-600">Reviewed contracts, applications, and source records linked to this profile.</p>
          </div>
          {documents.map((document) => (
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-3" key={document.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="font-bold">{document.title}</h3><p className="text-sm text-slate-600">{document.category}{document.effectiveYear ? ` · ${document.effectiveYear}` : ""}</p></div>
                {document.hasFile ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">File stored</span> : null}
              </div>
              {document.historicalTerms.length ? <dl className="mt-3 grid gap-2">{document.historicalTerms.map((term, index) => <div className="rounded-lg bg-white p-2" key={`${term.label}:${term.sourceLocator}:${index}`}><dt className="text-sm font-semibold">{term.label}: {term.value}</dt><dd className="mt-0.5 text-xs text-slate-500">{term.sourceLocator}</dd></div>)}</dl> : null}
              {mode === "owner" && document.canOpenFile ? <button className="button-secondary mt-3" disabled={busyId !== null} onClick={() => void openDocument(document)} type="button">Open document</button> : null}
            </article>
          ))}
          {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}