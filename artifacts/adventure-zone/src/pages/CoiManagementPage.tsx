import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Plus, RefreshCw } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@workspace/avz-crm/components/ui/dialog";
import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import { bossGet, bossPatch, bossPost } from "@/lib/boss-auth-context";
import type { BossCertificateDocument } from "@/lib/boss-documents-api";

type AssetCandidate = {
  id: string;
  officeAccountId: string;
  name: string;
  bookingId: string | null;
  bookingName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  mimeType: string | null;
  fileAvailable: boolean;
};
type OfficeAccount = { id: string; displayName: string };
type Props = { mode: "boss" | "admin" };
type ExpirationFilter = "all" | "current" | "expiring_soon" | "expired" | "incomplete";
type ReviewFilter = "all" | "needs_review" | "reviewed";
type Fields = {
  officeAccountId: string;
  name: string;
  assetId: string;
  bookingId: string;
  organizationId: string;
  issueDate: string;
  expirationDate: string;
  reviewState: "needs_review" | "reviewed";
};

const emptyFields: Fields = {
  officeAccountId: "",
  name: "",
  assetId: "",
  bookingId: "",
  organizationId: "",
  issueDate: "",
  expirationDate: "",
  reviewState: "needs_review",
};

function statusLabel(status: BossCertificateDocument["expirationState"]) {
  return status === "expiring_soon" ? "Expiring soon" : status.replace("_", " ");
}
function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? "Not recorded" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function badgeVariant(status: BossCertificateDocument["expirationState"]): "default" | "destructive" | "secondary" | "outline" {
  if (status === "expired") return "destructive";
  if (status === "expiring_soon") return "default";
  if (status === "current") return "secondary";
  return "outline";
}

function readExpirationFilter(search: string): ExpirationFilter {
  const value = new URLSearchParams(search).get("expirationState");
  return value === "current" || value === "expiring_soon" || value === "expired" || value === "incomplete" ? value : "all";
}

function readReviewFilter(search: string): ReviewFilter {
  const value = new URLSearchParams(search).get("reviewState");
  return value === "needs_review" || value === "reviewed" ? value : "all";
}

function readWorkspaceFilter(search: string) {
  return new URLSearchParams(search).get("officeAccountId") ?? "";
}

function CertificateForm({
  mode,
  initial,
  assets,
  officeAccounts,
  onClose,
  onSaved,
}: {
  mode: Props["mode"];
  initial: BossCertificateDocument | null;
  assets: AssetCandidate[];
  officeAccounts: OfficeAccount[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = Boolean(initial);
  const initialAsset = initial?.assetId ? assets.find((asset) => asset.id === initial.assetId) : undefined;
  const [fields, setFields] = useState<Fields>(initial ? {
    officeAccountId: initial.officeAccountId,
    name: initial.name,
    assetId: initial.assetId ?? "",
    bookingId: initial.bookingId ?? initialAsset?.bookingId ?? "",
    organizationId: initial.organizationId ?? initialAsset?.organizationId ?? "",
    issueDate: initial.issueDate ?? "",
    expirationDate: initial.expirationDate ?? "",
    reviewState: initial.reviewState,
  } : { ...emptyFields, officeAccountId: officeAccounts[0]?.id ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleAssets = mode === "boss" ? assets : assets.filter((asset) => !fields.officeAccountId || asset.officeAccountId === fields.officeAccountId);
  const eventOptions = useMemo(() => Array.from(new Map(visibleAssets.filter((asset) => asset.bookingId).map((asset) => [asset.bookingId, { id: asset.bookingId!, name: asset.bookingName ?? asset.bookingId! }])).values()), [visibleAssets]);
  const profileOptions = useMemo(() => Array.from(new Map(visibleAssets.filter((asset) => asset.organizationId).map((asset) => [asset.organizationId, { id: asset.organizationId!, name: asset.organizationName ?? asset.organizationId! }])).values()), [visibleAssets]);
  const patch = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...(mode === "admin" ? { officeAccountId: fields.officeAccountId } : {}),
        name: fields.name.trim(),
        assetId: fields.assetId || null,
        bookingId: fields.bookingId || null,
        organizationId: fields.organizationId || null,
        issueDate: fields.issueDate || null,
        expirationDate: fields.expirationDate || null,
        reviewState: fields.reviewState,
      };
      if (isEdit && initial) {
        if (mode === "boss") await bossPatch(`/boss/coi/${initial.id}`, payload);
        else await apiPatch(`/admin/coi/${initial.id}`, payload);
      } else if (mode === "boss") {
        await bossPost("/boss/coi", payload);
      } else {
        await apiPost("/admin/coi", payload);
      }
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the certificate.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? "Edit certificate of insurance" : "Add certificate of insurance"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
          {mode === "admin" ? (
            <label className="grid gap-1 text-sm font-semibold">Office workspace
              <select value={fields.officeAccountId} onChange={(event) => patch("officeAccountId", event.target.value)} disabled={isEdit}>
                <option value="">Choose a workspace</option>
                {officeAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold">Certificate name
            <Input value={fields.name} onChange={(event) => patch("name", event.target.value)} placeholder="General liability COI" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Existing Studio file
            <select value={fields.assetId} onChange={(event) => {
              const asset = assets.find((item) => item.id === event.target.value);
              setFields((current) => ({ ...current, assetId: event.target.value, bookingId: asset?.bookingId ?? current.bookingId, organizationId: asset?.organizationId ?? current.organizationId }));
            }}>
              <option value="">No file linked yet</option>
              {visibleAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.fileAvailable ? "" : " (file unavailable)"}</option>)}
            </select>
            <span className="text-xs font-normal text-muted-foreground">Linking reuses the stored Studio file; it does not upload a copy.</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">Related event
              <select value={fields.bookingId} onChange={(event) => patch("bookingId", event.target.value)}>
                <option value="">No event linked</option>
                {eventOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">Related profile
              <select value={fields.organizationId} onChange={(event) => patch("organizationId", event.target.value)}>
                <option value="">No profile linked</option>
                {profileOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">Issue date
              <Input type="date" value={fields.issueDate} onChange={(event) => patch("issueDate", event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">Expiration date
              <Input type="date" value={fields.expirationDate} onChange={(event) => patch("expirationDate", event.target.value)} />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-semibold">Review state
            <select value={fields.reviewState} onChange={(event) => patch("reviewState", event.target.value as Fields["reviewState"])}>
              <option value="needs_review">Needs review</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !fields.name.trim() || (mode === "admin" && !fields.officeAccountId)}>{busy ? "Saving…" : isEdit ? "Save changes" : "Create certificate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CoiManagementPage({ mode }: Props) {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const [certificates, setCertificates] = useState<BossCertificateDocument[]>([]);
  const [assets, setAssets] = useState<AssetCandidate[]>([]);
  const [officeAccounts, setOfficeAccounts] = useState<OfficeAccount[]>([]);
  const [workspaceAvailable, setWorkspaceAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BossCertificateDocument | null>(null);
  const [creating, setCreating] = useState(false);
  const expirationFilter = readExpirationFilter(search);
  const reviewFilter = readReviewFilter(search);
  const workspaceFilter = readWorkspaceFilter(search);
  const hasActiveFilters = mode === "admin" && (expirationFilter !== "all" || reviewFilter !== "all" || Boolean(workspaceFilter));

  function updateFilter(key: "expirationState" | "reviewState" | "officeAccountId", value: string) {
    const params = new URLSearchParams(search);
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    const query = params.toString();
    setLocation(`${location.split("?")[0]}${query ? `?${query}` : ""}`);
  }

  function clearFilters() {
    const params = new URLSearchParams(search);
    params.delete("expirationState");
    params.delete("reviewState");
    params.delete("officeAccountId");
    const query = params.toString();
    setLocation(`${location.split("?")[0]}${query ? `?${query}` : ""}`);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const adminParams = new URLSearchParams();
      if (expirationFilter !== "all") adminParams.set("expirationState", expirationFilter);
      if (reviewFilter !== "all") adminParams.set("reviewState", reviewFilter);
      if (workspaceFilter) adminParams.set("officeAccountId", workspaceFilter);
      const adminPath = adminParams.toString() ? `/admin/coi?${adminParams.toString()}` : "/admin/coi";
      const data = mode === "boss"
        ? await bossGet<{ certificates: BossCertificateDocument[]; assetCandidates: AssetCandidate[]; workspaceAvailable: boolean }>("/boss/coi")
        : await apiGet<{ certificates: BossCertificateDocument[]; assetCandidates: AssetCandidate[]; officeAccounts: OfficeAccount[] }>(adminPath);
      setCertificates(data.certificates ?? []);
      setAssets(data.assetCandidates ?? []);
      if (mode === "boss") setWorkspaceAvailable((data as { workspaceAvailable: boolean }).workspaceAvailable);
      else setOfficeAccounts((data as { officeAccounts: OfficeAccount[] }).officeAccounts ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load certificates of insurance.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [mode, search]);

  return (
    <div className="grid gap-6" data-testid={`${mode}-coi-page`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-primary">{mode === "boss" ? "Boss" : "Admin Tools"}</p><h1 className="mt-1 text-2xl font-bold text-foreground">Certificates of Insurance</h1><p className="mt-1 text-sm text-muted-foreground">Track ownership, dates, review state, and protected Studio files without duplicating uploads.</p></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button size="sm" onClick={() => setCreating(true)} disabled={!workspaceAvailable}><Plus className="mr-2 h-4 w-4" />Add COI</Button></div>
      </header>
      {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert"><span className="text-destructive">{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button></div> : null}
      {!loading && mode === "boss" && !workspaceAvailable ? <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center"><AlertTriangle className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-2 font-semibold text-foreground">Document workspace unavailable</p><p className="mt-1 text-sm text-muted-foreground">Ask Desie to connect this Boss account to an Office workspace.</p></div> : null}
      {!loading && mode === "admin" ? (
        <section className="grid gap-3 rounded-xl border border-border bg-card p-4" aria-label="Certificate filters" data-testid="coi-filters">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-foreground">Renewal triage</h2>
              <p className="text-sm text-muted-foreground">Filter the shared certificate register by risk, review state, or workspace.</p>
            </div>
            {hasActiveFilters ? <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold">
              Renewal status
              <select value={expirationFilter} onChange={(event) => updateFilter("expirationState", event.target.value)} data-testid="coi-expiration-filter">
                <option value="all">All renewal statuses</option>
                <option value="current">Current</option>
                <option value="expiring_soon">Expiring within 30 days</option>
                <option value="expired">Expired</option>
                <option value="incomplete">Incomplete record</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Review state
              <select value={reviewFilter} onChange={(event) => updateFilter("reviewState", event.target.value)} data-testid="coi-review-filter">
                <option value="all">All review states</option>
                <option value="needs_review">Needs review</option>
                <option value="reviewed">Reviewed</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Office workspace
              <select value={workspaceFilter} onChange={(event) => updateFilter("officeAccountId", event.target.value)} data-testid="coi-workspace-filter">
                <option value="">All workspaces</option>
                {officeAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}
              </select>
            </label>
          </div>
        </section>
      ) : null}
      {loading ? <div className="grid gap-3 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <Skeleton className="h-44 rounded-xl" key={item} />)}</div> : null}
      {!loading && workspaceAvailable && !certificates.length ? <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center"><FileText className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 font-semibold text-foreground">{hasActiveFilters ? "No certificates match these filters" : "No certificates recorded yet"}</p><p className="mt-1 text-sm text-muted-foreground">{hasActiveFilters ? "Try a different renewal status, review state, or workspace." : "Create a record, then link an existing Studio asset when one is available."}</p>{hasActiveFilters ? <Button className="mt-4" variant="outline" onClick={clearFilters}>Clear filters</Button> : <Button className="mt-4" onClick={() => setCreating(true)}><Plus className="mr-2 h-4 w-4" />Add the first COI</Button>}</div> : null}
      {!loading && certificates.length ? <div className="grid gap-3 md:grid-cols-2">{certificates.map((certificate) => (
        <article className="rounded-xl border border-border bg-card p-4 shadow-sm" key={certificate.id}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold text-foreground">{certificate.name}</p><p className="mt-1 text-sm text-muted-foreground">{certificate.bookingName ?? certificate.organizationName ?? "No event or profile linked"}{mode === "admin" && certificate.officeAccountName ? ` · ${certificate.officeAccountName}` : ""}</p></div><div className="flex gap-1"><Badge variant={badgeVariant(certificate.expirationState)}>{statusLabel(certificate.expirationState)}</Badge><Badge variant={certificate.reviewState === "reviewed" ? "default" : "outline"}>{certificate.reviewState === "reviewed" ? "Reviewed" : "Needs review"}</Badge></div></div>
          <p className="mt-3 text-xs text-muted-foreground">Issued {dateLabel(certificate.issueDate)} · Expires {dateLabel(certificate.expirationDate)}</p>
          <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(certificate)}>Edit</Button>{certificate.fileUrl ? <Button asChild size="sm" variant="ghost"><a href={certificate.fileUrl} target="_blank" rel="noreferrer"><Download className="mr-1.5 h-3.5 w-3.5" />Open file</a></Button> : <span className="self-center text-xs text-destructive">{certificate.fileAvailable ? "File link unavailable — retry later" : "File unavailable — link a Studio file"}</span>}{certificate.bookingId && mode !== "boss" ? <Button asChild size="sm" variant="ghost"><Link href={`/bookings/${certificate.bookingId}`}>Open event</Link></Button> : null}</div>
          {certificate.reviewState === "reviewed" ? <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-primary" />Review complete</p> : null}
        </article>
      ))}</div> : null}
      {(creating || editing) ? <CertificateForm mode={mode} initial={editing} assets={assets} officeAccounts={officeAccounts} onClose={() => { setCreating(false); setEditing(null); }} onSaved={load} /> : null}
    </div>
  );
}