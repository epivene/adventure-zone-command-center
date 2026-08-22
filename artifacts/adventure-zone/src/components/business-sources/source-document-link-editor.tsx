import { useEffect, useState } from "react";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/auth-token";

type LinkKind = "profile" | "location" | "booking" | "package_reference";
type DocumentLink = {
  id: string;
  linkKind: LinkKind;
  organizationId: string | null;
  organizationLocationId: string | null;
  bookingId: string | null;
  packageTemplateId: string | null;
  linkNote: string | null;
};
type HistoricalTerm = {
  id: string;
  documentLinkId: string | null;
  termKey: string;
  label: string;
  valueText: string;
  valueType: string;
  sourceLocator: string;
  reviewState: "proposed" | "approved" | "rejected";
};
type ProfileCandidate = { id: string; name: string; city?: string | null; region?: string | null };

function linkTarget(link: DocumentLink) {
  return link.organizationId ?? link.organizationLocationId ?? link.bookingId ?? link.packageTemplateId ?? "Unknown target";
}

export function SourceDocumentLinkEditor({ documentId }: { documentId: string }) {
  const [links, setLinks] = useState<DocumentLink[]>([]);
  const [terms, setTerms] = useState<HistoricalTerm[]>([]);
  const [kind, setKind] = useState<LinkKind>("profile");
  const [targetId, setTargetId] = useState("");
  const [profileQuery, setProfileQuery] = useState("");
  const [profileResults, setProfileResults] = useState<ProfileCandidate[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ProfileCandidate | null>(null);
  const [termLinkId, setTermLinkId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [linkData, termData] = await Promise.all([
      apiGet<{ links: DocumentLink[] }>(`/business-sources/${documentId}/links`),
      apiGet<{ terms: HistoricalTerm[] }>(`/business-sources/${documentId}/historical-terms`),
    ]);
    setLinks(linkData.links ?? []);
    setTerms(termData.terms ?? []);
    setTermLinkId((current) => current || linkData.links?.[0]?.id || "");
  }

  useEffect(() => { void load().catch(() => undefined); }, [documentId]);

  async function searchProfiles() {
    setBusy(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        q: profileQuery.trim(),
        showMembers: "yes",
        includeRetired: "no",
        page: "1",
        pageSize: "20",
      });
      const response = await apiGet<any>(`/organizations?${qs}`);
      const page = "organizations" in response ? response.organizations : response;
      setProfileResults((page.records ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        city: row.city ?? null,
        region: row.region ?? null,
      })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not search profiles.");
    } finally {
      setBusy(false);
    }
  }

  async function addLink() {
    const selectedTarget = kind === "profile" ? selectedProfile?.id ?? "" : targetId.trim();
    if (!selectedTarget || busy) return;
    setBusy(true);
    setError("");
    try {
      const targetFields = {
        organizationId: kind === "profile" ? selectedTarget : null,
        organizationLocationId: kind === "location" ? selectedTarget : null,
        bookingId: kind === "booking" ? selectedTarget : null,
        packageTemplateId: kind === "package_reference" ? selectedTarget : null,
      };
      await apiPost(`/business-sources/${documentId}/links`, {
        linkKind: kind,
        ...targetFields,
        linkNote: null,
      });
      setTargetId("");
      setSelectedProfile(null);
      setProfileResults([]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not link this source document.");
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(linkId: string) {
    if (busy || !window.confirm("Unlink this source document from the selected record?")) return;
    setBusy(true);
    setError("");
    try {
      await apiDelete(`/business-sources/${documentId}/links/${linkId}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlink this source document.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewTerm(term: HistoricalTerm, reviewState: "approved" | "rejected") {
    if (busy) return;
    if (reviewState === "approved" && !termLinkId) {
      setError("Link the source document to the intended profile, location, booking, or package reference before approving historical terms.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiPatch(`/business-sources/${documentId}/historical-terms/${term.id}`, {
        ...(reviewState === "approved" ? { documentLinkId: termLinkId } : {}),
        reviewState,
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the historical term review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div>
        <h4 className="font-bold">Linked to</h4>
        {links.length ? (
          <ul className="mt-2 grid gap-2">
            {links.map((link) => (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-sm" key={link.id}>
                <span><strong>{link.linkKind.replaceAll("_", " ")}</strong> · {linkTarget(link)}</span>
                <button className="button-secondary" disabled={busy} onClick={() => void removeLink(link.id)} type="button">Unlink</button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-slate-600">Not linked yet.</p>}
      </div>

      <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label className="grid gap-1 text-sm font-semibold">
          Link kind
          <select value={kind} onChange={(event) => { setKind(event.currentTarget.value as LinkKind); setTargetId(""); setSelectedProfile(null); }}>
            <option value="profile">profile</option>
            <option value="location">location</option>
            <option value="booking">booking</option>
            <option value="package_reference">package_reference</option>
          </select>
        </label>

        {kind === "profile" ? (
          <>
            <div className="flex gap-2">
              <input aria-label="Search profiles for document link" className="min-w-0 flex-1" onChange={(event) => setProfileQuery(event.currentTarget.value)} placeholder="Event/profile name, city, contact…" value={profileQuery} />
              <button className="button-secondary" disabled={busy} onClick={() => void searchProfiles()} type="button">Search</button>
            </div>
            {profileResults.length ? <div className="max-h-52 overflow-y-auto rounded-lg border">{profileResults.map((candidate) => <button className={selectedProfile?.id === candidate.id ? "block w-full bg-orange-50 p-2 text-left" : "block w-full p-2 text-left hover:bg-slate-50"} key={candidate.id} onClick={() => setSelectedProfile(candidate)} type="button"><strong>{candidate.name}</strong><span className="ml-2 text-sm text-slate-600">{[candidate.city, candidate.region].filter(Boolean).join(", ")}</span></button>)}</div> : null}
          </>
        ) : (
          <label className="grid gap-1 text-sm font-semibold">
            Target ID
            <input onChange={(event) => setTargetId(event.currentTarget.value)} placeholder={`${kind} UUID`} value={targetId} />
          </label>
        )}
        <button className="button-primary w-fit" disabled={busy || (kind === "profile" ? !selectedProfile : !targetId.trim())} onClick={() => void addLink()} type="button">Add link</button>
      </div>

      <div>
        <h4 className="font-bold">Historical terms</h4>
        <p className="mt-1 text-xs text-slate-600">Event-specific snapshots stay historical and never rewrite current package settings.</p>
        {links.length ? <label className="mt-2 grid gap-1 text-sm font-semibold">Approve terms against link<select value={termLinkId} onChange={(event) => setTermLinkId(event.currentTarget.value)}>{links.map((link) => <option key={link.id} value={link.id}>{link.linkKind.replaceAll("_", " ")} · {linkTarget(link)}</option>)}</select></label> : null}
        <div className="mt-2 grid gap-2">
          {terms.map((term) => (
            <article className="rounded-lg border border-slate-200 bg-white p-3" key={term.id}>
              <div className="flex flex-wrap justify-between gap-2"><strong>{term.label}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{term.reviewState}</span></div>
              <p className="mt-1 text-sm text-slate-700">{term.valueText}</p>
              <p className="mt-1 text-xs text-slate-500">{term.sourceLocator}</p>
              {term.reviewState === "proposed" ? <div className="mt-2 flex gap-2"><button className="button-primary" disabled={busy || !termLinkId} onClick={() => void reviewTerm(term, "approved")} type="button">Approve term</button><button className="button-secondary" disabled={busy} onClick={() => void reviewTerm(term, "rejected")} type="button">Reject term</button></div> : null}
            </article>
          ))}
          {!terms.length ? <p className="text-sm text-slate-600">No historical terms are staged for this source.</p> : null}
        </div>
      </div>

      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}
