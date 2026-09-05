import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Trash2, X, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

import { apiDelete, apiPost } from "@/lib/auth-token";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/avz-crm/components/ui/empty";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { apiGet } from "@/lib/auth-token";

import { AudienceForm } from "./AudienceForm";
import {
  exclusionReasonLabel,
  formatDate,
  type NoticeDispatch,
  type PreflightResult,
  type ServerAudience,
} from "./types";

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <p className="font-semibold text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}

function PreflightPanel({
  preflight,
  onClose,
}: {
  preflight: PreflightResult;
  onClose: () => void;
}) {
  const [showExcluded, setShowExcluded] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3" data-testid="preflight-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Preflight: {preflight.recipients.length} eligible of{" "}
          {preflight.totalMembers} member{preflight.totalMembers !== 1 ? "s" : ""}
          {preflight.excluded.length > 0
            ? ` — ${preflight.excluded.length} excluded`
            : ""}
        </p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {preflight.recipients.length > 0 ? (
        <div className="mt-2 grid max-h-40 gap-1 overflow-y-auto">
          {preflight.recipients.map((r) => (
            <div key={r.email} className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-3 w-3 shrink-0 text-primary" />
              <span className="font-medium">{r.organizationName}</span>
              <span className="text-muted-foreground">{r.contactName}</span>
              <span className="ml-auto text-muted-foreground">{r.email}</span>
            </div>
          ))}
        </div>
      ) : null}
      {preflight.excluded.length > 0 ? (
        <div className="mt-2">
          <button
            onClick={() => setShowExcluded((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {showExcluded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {preflight.excluded.length} excluded
          </button>
          {showExcluded ? (
            <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto">
              {preflight.excluded.map((ex, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                  <span className="font-medium">{ex.email || ex.contactId}</span>
                  <span className="ml-auto rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                    {exclusionReasonLabel(ex.reason)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AudiencesTab({ setNotice }: { setNotice: NoticeDispatch }) {
  const [audiences, setAudiences] = useState<ServerAudience[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [preflightId, setPreflightId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const fetchAudiences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ audiences: ServerAudience[] }>("/marketing/audiences");
      setAudiences(data.audiences);
    } catch {
      setError("Could not load audiences. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAudiences(); }, [fetchAudiences]);

  async function runPreflight(id: string) {
    setPreflightId(id);
    setPreflight(null);
    setPreflightLoading(true);
    try {
      const data = await apiPost<PreflightResult>(
        `/marketing/audiences/${id}/preflight`,
        {},
      );
      setPreflight(data);
    } catch {
      setNotice({ kind: "error", text: "Preflight check failed." });
      setPreflightId(null);
    } finally {
      setPreflightLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    setDeletingId(id);
    try {
      await apiDelete(`/marketing/audiences/${id}`);
      setAudiences((prev) => prev.filter((a) => a.id !== id));
      setNotice({ kind: "ok", text: `Deleted audience "${name}".` });
    } catch {
      setNotice({ kind: "error", text: `Could not delete "${name}".` });
    } finally {
      setDeletingId(null);
    }
  }

  function onSaved(audience: ServerAudience, isNew: boolean) {
    if (isNew) {
      setAudiences((prev) => [audience, ...prev]);
    } else {
      setAudiences((prev) => prev.map((a) => (a.id === audience.id ? audience : a)));
    }
    setCreating(false);
    setEditingId(null);
    setNotice({ kind: "ok", text: `Saved audience "${audience.name}".` });
  }

  const showForm = creating || editingId !== null;
  const editingAudience = editingId ? (audiences.find((a) => a.id === editingId) ?? null) : null;

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Audiences are durable recipient lists stored on the server. Add named contacts, then run a preflight check to see eligible and excluded recipients before creating a campaign.
        </p>
        <Button
          size="sm"
          onClick={() => { setCreating(true); setEditingId(null); }}
          className="shrink-0"
          data-testid="audience-create-btn"
        >
          <Plus className="h-4 w-4" />
          New Audience
        </Button>
      </div>

      {showForm && (
        <AudienceForm
          existing={editingAudience}
          onSaved={onSaved}
          onCancel={() => { setCreating(false); setEditingId(null); }}
          setNotice={setNotice}
        />
      )}

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchAudiences} />
      ) : audiences.length === 0 ? (
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyTitle>No audiences yet</EmptyTitle>
            <EmptyDescription>
              Create an audience to define who receives a campaign. Choose exact contacts; the preflight shows who is eligible.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3" data-testid="audience-list">
          {audiences.map((audience) => (
            <article
              key={audience.id}
              className="rounded-xl border border-border bg-card p-4"
              data-testid={`audience-card-${audience.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold">{audience.name}</h3>
                    <Badge variant="outline">
                      {audience.memberCount} member{audience.memberCount !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  {audience.description ? (
                    <p className="mt-1 text-sm text-muted-foreground">{audience.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Updated {formatDate(audience.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void runPreflight(audience.id)}
                    disabled={preflightLoading && preflightId === audience.id}
                    data-testid={`audience-preflight-${audience.id}`}
                  >
                    {preflightLoading && preflightId === audience.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Search className="h-3 w-3" />
                    )}
                    Preflight
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setEditingId(audience.id); setCreating(false); }}
                    data-testid={`audience-edit-${audience.id}`}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deletingId === audience.id}
                    onClick={() => void handleDelete(audience.id, audience.name)}
                    data-testid={`audience-delete-${audience.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {preflightId === audience.id && preflight ? (
                <PreflightPanel
                  preflight={preflight}
                  onClose={() => { setPreflightId(null); setPreflight(null); }}
                />
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
