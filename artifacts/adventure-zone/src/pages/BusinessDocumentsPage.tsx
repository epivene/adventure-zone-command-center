import { type ReactNode, useEffect, useState } from "react";
import { FileText, FolderOpen, Pencil, Search, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { Link, useSearch } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  businessDocumentsApi,
  type BusinessDocumentProfileOption,
  type BusinessDocumentRecord,
} from "@/lib/business-documents-api";
import { DocumentReviewQueue } from "@/components/business-documents/document-review-queue";
import { DocumentProfileLinker, type ProfileLinkSuggestion } from "@/components/business-documents/document-profile-linker";
import { groupBusinessDocuments, isMediaDocument } from "./business-document-organization";

type View = "all" | "media" | "contracts" | "invoices" | "vendor_applications" | "templates" | "insurance" | "review";
type SortOrder = "newest" | "oldest" | "name_asc" | "name_desc";

export type BusinessDocumentsClient = Pick<typeof businessDocumentsApi,
  "listAll" | "open" | "update" | "deleteDocument" | "reviewItems" | "searchProfiles" | "reviewAction"
> & { linkProfile?: typeof businessDocumentsApi.linkProfile };

type BusinessDocumentsPageProps = {
  api?: BusinessDocumentsClient;
  eyebrow?: string;
  headerAction?: ReactNode;
  reloadToken?: number;
};

const views: Array<{ id: View; label: string }> = [
  { id: "review", label: "Needs Review" },
  { id: "all", label: "All Documents" },
  { id: "media", label: "Media" },
  { id: "contracts", label: "Contracts" },
  { id: "invoices", label: "Invoices" },
  { id: "vendor_applications", label: "Vendor Applications" },
  { id: "templates", label: "Templates" },
  { id: "insurance", label: "COIs & Insurance" },
];

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function visibleInView(document: BusinessDocumentRecord, view: View) {
  if (view === "media") return isMediaDocument(document);
  if (view === "review") return document.reviewState === "needs_review";
  if (isMediaDocument(document)) return false;
  if (view === "contracts") return document.category === "contract";
  if (view === "invoices") return document.category === "invoice";
  if (view === "vendor_applications") return document.category === "vendor_application";
  if (view === "templates") return document.category === "operational_template";
  if (view === "insurance") return document.category === "coi" || document.category === "insurance_policy";
  return true;
}

const categories: BusinessDocumentRecord["category"][] = [
  "contract", "invoice", "proposal", "coi", "insurance_policy", "w9_tax", "permit",
  "vendor_application", "inspection", "deposit_receipt", "operational_template", "marketing", "other",
];

function yearsFor(document: BusinessDocumentRecord) {
  const values = [document.effectiveDate, document.issueDate, document.expirationDate, document.displayName, document.originalFilename];
  const years = new Set(values.flatMap((value) => value?.match(/\b20\d{2}\b/g) ?? []));
  if (!years.size) years.add(document.createdAt.slice(0, 4));
  return years;
}

export default function BusinessDocumentsPage({
  api = businessDocumentsApi,
  eyebrow = "Owner file system",
  headerAction,
  reloadToken = 0,
}: BusinessDocumentsPageProps = {}) {
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const profileId = searchParams.get("profileId") ?? undefined;
  const [view, setView] = useState<View>(() => searchParams.get("view") === "review" ? "review" : "all");
  const [documents, setDocuments] = useState<BusinessDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<BusinessDocumentRecord["category"]>("other");
  const [editNotes, setEditNotes] = useState("");
  const [editProfileQuery, setEditProfileQuery] = useState("");
  const [editProfileResults, setEditProfileResults] = useState<BusinessDocumentProfileOption[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<BusinessDocumentProfileOption | null>(null);
  const [searchingProfiles, setSearchingProfiles] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [reviewState, setReviewState] = useState("");
  const [source, setSource] = useState("");
  const [linkState, setLinkState] = useState("");
  const [year, setYear] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    api.listAll({ profileId })
      .then((result) => { if (current) setDocuments(result.documents); })
      .catch(() => { if (current) setError("Could not load business documents."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, profileId, reloadToken]);

  async function openDocument(document: BusinessDocumentRecord) {
    setOpeningId(document.id);
    setError(null);
    try {
      const url = await api.open(document.id);
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
  }).sort((left, right) => {
    if (sortOrder === "name_asc") return left.displayName.localeCompare(right.displayName);
    if (sortOrder === "name_desc") return right.displayName.localeCompare(left.displayName);
    const difference = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    return sortOrder === "oldest" ? -difference : difference;
  });
  const activeFilterCount = [category, reviewState, source, linkState, year].filter(Boolean).length;
  const reviewCount = documents.filter((document) => document.reviewState === "needs_review").length;
  const groupedDocuments = groupBusinessDocuments(visibleDocuments, { media: view === "media" });

  function resetFilters() {
    setQuery("");
    setCategory("");
    setReviewState("");
    setSource("");
    setLinkState("");
    setYear("");
  }

  function beginEdit(document: BusinessDocumentRecord) {
    setEditingId(document.id);
    setEditName(document.displayName);
    setEditCategory(document.category);
    setEditNotes(document.notes ?? "");
    setEditProfileQuery("");
    setEditProfileResults([]);
    setSelectedProfile(null);
    setError(null);
  }

  async function searchEditProfiles() {
    const profileQuery = editProfileQuery.trim();
    if (!profileQuery) return;
    setSearchingProfiles(true);
    setError(null);
    try {
      setEditProfileResults(await api.searchProfiles(profileQuery));
    } catch {
      setError("Could not search profiles.");
    } finally {
      setSearchingProfiles(false);
    }
  }

  async function linkEditedDocument(document: BusinessDocumentRecord) {
    const linkProfile = api.linkProfile;
    if (!selectedProfile || !linkProfile) return;
    setLinkingId(document.id);
    setError(null);
    try {
      await linkProfile(document.id, selectedProfile.id);
      setDocuments((current) => current.map((item) => item.id === document.id ? {
        ...item,
        links: [...item.links, {
          id: `new-profile-${selectedProfile.id}`,
          targetKind: "profile" as const,
          targetId: selectedProfile.id,
          targetLabel: selectedProfile.name,
        }],
      } : item));
      setSelectedProfile(null);
      setEditProfileQuery("");
      setEditProfileResults([]);
    } catch {
      setError("Could not link that profile to the document.");
    } finally {
      setLinkingId(null);
    }
  }

  function recordBulkLinks(suggestions: ProfileLinkSuggestion[]) {
    const linkedByDocument = new Map(suggestions.map((suggestion) => [suggestion.documentId, suggestion.profile]));
    setDocuments((current) => current.map((document) => {
      const profile = linkedByDocument.get(document.id);
      if (!profile) return document;
      return {
        ...document,
        links: [...document.links, {
          id: `new-profile-${profile.id}`,
          targetKind: "profile" as const,
          targetId: profile.id,
          targetLabel: profile.name,
        }],
      };
    }));
  }

  async function saveDocument(document: BusinessDocumentRecord) {
    const displayName = editName.trim();
    if (!displayName) {
      setError("Enter a document name before saving.");
      return;
    }
    setSavingId(document.id);
    setError(null);
    try {
      const result = await api.update(document.id, {
        displayName,
        category: editCategory,
        notes: editNotes.trim() || null,
      });
      setDocuments((current) => current.map((item) => item.id === document.id ? result.document : item));
      setEditingId(null);
    } catch {
      setError("Could not save the document changes.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteDocument(document: BusinessDocumentRecord) {
    if (!window.confirm(`Delete ${document.originalFilename}? This removes it from the active library.`)) return;
    setDeletingId(document.id);
    setError(null);
    try {
      await api.deleteDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      if (editingId === document.id) setEditingId(null);
    } catch {
      setError("Could not delete the business document.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
          <h1 className="text-3xl font-bold text-foreground">Business Documents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Contracts, certificates, templates, and other Adventure Zone business files in one protected library.
          </p>
        </div>
{headerAction ?? (
          <Button asChild>
            <Link href="/business-documents/import"><Upload className="mr-2 h-4 w-4" />Import business documents</Link>
          </Button>
        )}
      </header>

      {!loading && reviewCount && view !== "review" ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Sorting inbox</p>
            <h2 className="text-lg font-bold text-foreground">{reviewCount} {reviewCount === 1 ? "document needs" : "documents need"} sorting</h2>
            <p className="text-sm text-muted-foreground">Confirm its type and event before filing it into the library.</p>
          </div>
          <Button onClick={() => setView("review")} type="button">Open Needs Review</Button>
        </section>
      ) : null}

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
          <label className="grid max-w-xs gap-1 text-xs font-semibold">Sort documents
            <select aria-label="Sort documents" className="rounded-md border border-input bg-background px-2 py-2 text-sm" onChange={(event) => setSortOrder(event.target.value as SortOrder)} value={sortOrder}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name_asc">Name A–Z</option>
              <option value="name_desc">Name Z–A</option>
            </select>
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

      {view !== "review" && !loading && api.linkProfile ? (
        <DocumentProfileLinker api={{ searchProfiles: api.searchProfiles, linkProfile: api.linkProfile }} documents={documents} onLinked={recordBulkLinks} />
      ) : null}

      {view === "review" ? <DocumentReviewQueue api={api} /> : null}

      {view !== "review" && !loading && !visibleDocuments.length ? (
        <section className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-bold text-foreground">{documents.length ? "No documents match" : "No business documents yet"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{documents.length ? "Try changing the search or filters." : "Import files from Google Workspace or upload a protected copy."}</p>
        </section>
      ) : null}

      {view !== "review" && visibleDocuments.length ? (
        <section aria-label="Documents grouped by type, year, and event" className="grid gap-8">
          {groupedDocuments.map((typeGroup) => (
            <details aria-label={`${typeGroup.label} folder`} className="rounded-xl border border-border bg-card" key={typeGroup.key}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-bold text-foreground">
                <span>{typeGroup.label}</span>
                <span className="text-xs text-muted-foreground">{typeGroup.years.reduce((count, item) => count + item.events.reduce((eventCount, event) => eventCount + event.documents.length, 0), 0)} files</span>
              </summary>
              <div className="grid gap-3 border-t border-border p-3">
                {typeGroup.years.map((yearGroup) => (
                  <details aria-label={`${yearGroup.year} folder`} className="rounded-lg border border-border bg-background" key={`${typeGroup.key}-${yearGroup.year}`}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-semibold text-foreground">
                      <span>{yearGroup.year}</span>
                      <span className="text-xs text-muted-foreground">{yearGroup.events.reduce((count, event) => count + event.documents.length, 0)} files</span>
                    </summary>
                    <div className="grid gap-2 border-t border-border p-2">
                      {yearGroup.events.map((eventGroup) => (
                        <details aria-label={`${eventGroup.label} folder`} className="rounded-lg border border-border bg-card" key={`${typeGroup.key}-${yearGroup.year}-${eventGroup.key}`}>
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-foreground">
                            <span>{eventGroup.label}</span>
                            <span className="text-xs font-normal text-muted-foreground">{eventGroup.documents.length} {eventGroup.documents.length === 1 ? "file" : "files"}</span>
                          </summary>
                          <div className="grid gap-2 border-t border-border p-2 md:grid-cols-2 xl:grid-cols-3">
                        {eventGroup.documents.map((document) => (
            <article className="rounded-lg border border-border bg-background p-3 shadow-sm" key={document.id}>
              {editingId === document.id ? (
                <div className="grid gap-3">
                  <label className="grid gap-1 text-xs font-semibold">Document name
                    <input className="rounded-md border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setEditName(event.target.value)} value={editName} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold">Edit document type
                    <select className="rounded-md border border-input bg-background px-2 py-2 text-sm" onChange={(event) => setEditCategory(event.target.value as BusinessDocumentRecord["category"])} value={editCategory}>
                      {categories.map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold">Document notes
                    <textarea className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setEditNotes(event.target.value)} value={editNotes} />
                  </label>
                  {document.links.some((link) => link.targetKind === "profile") ? (
                    <p className="text-xs text-muted-foreground">Linked profile: {document.links.find((link) => link.targetKind === "profile")?.targetLabel ?? "Profile linked"}</p>
                  ) : api.linkProfile ? (
                    <div className="grid gap-2 rounded-md border border-border p-2">
                      <label className="grid gap-1 text-xs font-semibold">Find a profile to link
                        <div className="flex gap-2">
                          <input className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" onChange={(event) => setEditProfileQuery(event.target.value)} value={editProfileQuery} />
                          <Button disabled={searchingProfiles || !editProfileQuery.trim()} onClick={() => void searchEditProfiles()} size="sm" type="button" variant="outline">{searchingProfiles ? "Searching…" : "Search"}</Button>
                        </div>
                      </label>
                      {editProfileResults.length ? (
                        <div className="grid gap-1" role="listbox" aria-label="Profile search results">
                          {editProfileResults.map((profile) => (
                            <button aria-selected={selectedProfile?.id === profile.id} className={`rounded-md border p-2 text-left text-sm ${selectedProfile?.id === profile.id ? "border-primary bg-primary/10" : "border-border"}`} key={profile.id} onClick={() => setSelectedProfile(profile)} role="option" type="button">
                              <span className="font-semibold">{profile.name}</span>{profile.city || profile.region ? <span className="text-muted-foreground"> · {[profile.city, profile.region].filter(Boolean).join(", ")}</span> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <Button disabled={!selectedProfile || linkingId === document.id} onClick={() => void linkEditedDocument(document)} size="sm" type="button" variant="outline">{linkingId === document.id ? "Linking…" : "Link selected profile"}</Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={savingId === document.id} onClick={() => void saveDocument(document)} size="sm" type="button">
                      {savingId === document.id ? "Saving…" : "Save document"}
                    </Button>
                    <Button disabled={savingId === document.id} onClick={() => setEditingId(null)} size="sm" type="button" variant="outline">Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
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
                  {document.notes ? <p className="mt-3 text-sm text-muted-foreground">{document.notes}</p> : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button disabled={!document.fileAvailable || openingId === document.id} onClick={() => void openDocument(document)} size="sm" variant="outline">
                      {openingId === document.id ? "Opening…" : document.fileAvailable ? "Open protected file" : "File unavailable"}
                    </Button>
                    <Button aria-label={`Edit ${document.displayName}`} onClick={() => beginEdit(document)} size="sm" type="button" variant="outline">
                      <Pencil className="mr-1 h-4 w-4" />Edit
                    </Button>
                    <Button aria-label={`Delete ${document.displayName}`} disabled={deletingId === document.id} onClick={() => void deleteDocument(document)} size="sm" type="button" variant="outline">
                      <Trash2 className="mr-1 h-4 w-4" />{deletingId === document.id ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </>
              )}
            </article>
                        ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </section>
      ) : null}
    </main>
  );
}
