import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { ChevronDown, RefreshCw, Wrench } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { LegRecordPicker, UNASSIGNED_LEG_KEY, groupRecordsByLeg, recordsForLeg } from "@/components/boss/leg-record-picker";
import { bossDelete, bossGet } from "@/lib/boss-auth-context";

type MaintenanceItem = {
  id?: string;
  bookingId?: string;
  legId?: string | null;
  legName?: string | null;
  title?: string | null;
  phase?: string | null;
  status?: string | null;
  dueAt?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

type DashboardData = {
  checklistAndMaintenance?: MaintenanceItem[];
  [key: string]: unknown;
};

type MaintenanceRecord = MaintenanceItem & {
  bookingName?: string;
  legName?: string;
  items: Array<{ id: string; label: string; resourceName: string | null; result: string | null; note: string | null }>;
};

type MaintenanceEvent = {
  key: string;
  title: string;
  records: MaintenanceItem[];
};

function phaseLabel(phase?: string | null) {
  if (!phase) return null;
  const map: Record<string, string> = {
    pre: "Pre-event",
    post: "Post-event",
    pre_event: "Pre-event",
    post_event: "Post-event",
    maintenance: "Maintenance",
  };
  return map[phase] ?? phase;
}

function statusVariant(status?: string | null): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "complete":
    case "completed": return "default";
    case "failed": return "destructive";
    case "in_progress": return "secondary";
    default: return "outline";
  }
}

function canonicalPhase(phase?: string | null) {
  if (phase === "pre" || phase === "pre_event") return "pre_event";
  if (phase === "post" || phase === "post_event") return "post_event";
  return phase ?? "maintenance";
}

function groupByEvent(items: MaintenanceItem[]): MaintenanceEvent[] {
  const groups = new Map<string, MaintenanceEvent>();
  items.forEach((item, index) => {
    const legacyEventKey = item.title?.trim()
      ? `legacy:${item.legId ?? "unassigned"}:${item.title.trim().toLowerCase()}`
      : null;
    const key = item.bookingId ?? legacyEventKey ?? item.id ?? `maintenance-${index}`;
    const current = groups.get(key);
    if (current) current.records.push(item);
    else groups.set(key, { key, title: item.title ?? `Event ${index + 1}`, records: [item] });
  });
  return Array.from(groups.values());
}

function readableStatus(status?: string | null) {
  return status?.replaceAll("_", " ") ?? "available";
}

export default function BossMaintenancePage() {
  const search = useSearch();
  const linkedBookingId = new URLSearchParams(search).get("bookingId");
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [selectedLegKey, setSelectedLegKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openEventKey, setOpenEventKey] = useState<string | null>(null);
  const [recordsById, setRecordsById] = useState<Record<string, MaintenanceRecord>>({});
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({});
  const [detailErrorsById, setDetailErrorsById] = useState<Record<string, string>>({});
  const detailGeneration = useRef(0);
  const [busy, setBusy] = useState<string | null>(null);

  async function loadRecordIds(ids: string[], generation = detailGeneration.current) {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return;
    setLoadingById((current) => ({ ...current, ...Object.fromEntries(uniqueIds.map((id) => [id, true])) }));
    setDetailErrorsById((current) => {
      const next = { ...current };
      uniqueIds.forEach((id) => delete next[id]);
      return next;
    });
    await Promise.all(uniqueIds.map(async (id) => {
      try {
        const data = await bossGet<{ record: MaintenanceRecord }>(`/boss/maintenance/${id}`);
        if (detailGeneration.current === generation) {
          setRecordsById((current) => ({ ...current, [id]: data.record }));
        }
      } catch (cause) {
        if (detailGeneration.current === generation) {
          setDetailErrorsById((current) => ({
            ...current,
            [id]: cause instanceof Error ? cause.message : "Could not open maintenance record.",
          }));
        }
      } finally {
        if (detailGeneration.current === generation) {
          setLoadingById((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
        }
      }
    }));
  }

  async function load() {
    const generation = detailGeneration.current + 1;
    detailGeneration.current = generation;
    setLoading(true);
    setError(null);
    setRecordsById({});
    setLoadingById({});
    setDetailErrorsById({});
    try {
      const data = await bossGet<DashboardData>("/boss/dashboard");
      const freshItems = Array.isArray(data.checklistAndMaintenance) ? data.checklistAndMaintenance : [];
      setItems(freshItems);
      const linkedItem = linkedBookingId
        ? freshItems.find((item) => item.bookingId === linkedBookingId)
        : undefined;
      if (linkedItem && linkedBookingId) {
        const linkedLegKey = linkedItem.legId ?? UNASSIGNED_LEG_KEY;
        setSelectedLegKey(linkedLegKey);
        setOpenEventKey(linkedBookingId);
        const linkedEvent = groupByEvent(recordsForLeg(freshItems, linkedLegKey))
          .find((event) => event.key === linkedBookingId);
        if (linkedEvent) {
          void loadRecordIds(linkedEvent.records.flatMap((item) => item.id ? [item.id] : []), generation);
        }
      } else if (openEventKey) {
        const openEvent = groupByEvent(recordsForLeg(freshItems, selectedLegKey)).find((event) => event.key === openEventKey);
        if (openEvent) {
          void loadRecordIds(openEvent.records.flatMap((item) => item.id ? [item.id] : []), generation);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load maintenance items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [linkedBookingId]);

  const legGroups = groupRecordsByLeg(items);
  const effectiveLegKey = legGroups.some((group) => group.key === selectedLegKey) ? selectedLegKey : null;
  const legItems = recordsForLeg(items, effectiveLegKey);
  const events = groupByEvent(legItems);

  function selectLeg(key: string | null) {
    setSelectedLegKey(key);
    setOpenEventKey(null);
  }

  async function toggleEvent(event: MaintenanceEvent) {
    if (openEventKey === event.key) {
      setOpenEventKey(null);
      return;
    }
    setOpenEventKey(event.key);
    const recordIds = event.records.flatMap((item) => item.id ? [item.id] : []);
    const missingIds = recordIds.filter((id) => !recordsById[id] && !loadingById[id]);
    if (missingIds.length === 0) return;
    await loadRecordIds(missingIds);
  }

  async function removeRecord(item: MaintenanceItem) {
    if (!item.id || !window.confirm(`Remove the saved maintenance record for “${item.title ?? "this event"}”?`)) return;
    setBusy(item.id);
    try {
      await bossDelete(`/boss/maintenance/${item.id}`);
      setRecordsById((current) => {
        const next = { ...current };
        delete next[item.id!];
        return next;
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove maintenance record.");
    } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-5" data-testid="boss-maintenance-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Maintenance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pre/post-event checklists and maintenance visibility.</p>
        </div>
        <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      {!loading && items.length > 0 ? (
        <LegRecordPicker groups={legGroups} noun="maintenance record" selectedLegKey={effectiveLegKey} onSelect={selectLeg} />
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void load()} variant="outline" size="sm" className="ml-3">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="maintenance-empty">
          <Wrench className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">No maintenance items.</p>
          <p className="mt-1 text-sm text-muted-foreground">Pre/post-event checklists will appear here.</p>
        </div>
      ) : effectiveLegKey ? (
        <div className="grid gap-3">
          {events.map((event) => {
            const pre = event.records.find((item) => canonicalPhase(item.phase) === "pre_event");
            const post = event.records.find((item) => canonicalPhase(item.phase) === "post_event");
            const other = event.records.filter((item) => !["pre_event", "post_event"].includes(canonicalPhase(item.phase)));
            const isOpen = openEventKey === event.key;
            const detailsId = `maintenance-details-${encodeURIComponent(event.key)}`;
            const phasePanel = (label: string, item?: MaintenanceItem) => {
              const loadedRecord = item?.id ? recordsById[item.id] : undefined;
              const detailError = item?.id ? detailErrorsById[item.id] : undefined;
              const isLoading = item?.id ? loadingById[item.id] : false;
              return (
                <section className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3" key={label}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-foreground">{label}</h3>
                    {item?.status ? <Badge variant={statusVariant(item.status)} className="capitalize">{readableStatus(item.status)}</Badge> : null}
                  </div>
                  {!item ? (
                    <p className="text-sm text-muted-foreground">No {label.toLowerCase()} record yet.</p>
                  ) : isLoading && !loadedRecord ? (
                    <p className="text-sm text-muted-foreground">Loading record…</p>
                  ) : detailError ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-destructive">{detailError}</p>
                      <Button size="sm" variant="outline" onClick={() => void loadRecordIds([item.id!])}>
                        Retry {label.toLowerCase()} record
                      </Button>
                    </div>
                  ) : !item.id ? (
                    <p className="text-sm text-muted-foreground">No detailed checklist is available for this legacy record.</p>
                  ) : !loadedRecord ? (
                    <Button size="sm" variant="outline" className="w-fit" onClick={() => void loadRecordIds([item.id!])}>
                      Retry {label.toLowerCase()} record
                    </Button>
                  ) : (
                    <>
                      {loadedRecord.items.length === 0 ? <p className="text-sm text-muted-foreground">No checklist answers.</p> : null}
                      {loadedRecord.items.map((detail) => (
                        <div className="rounded-lg bg-card p-3 text-sm" key={detail.id}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="font-semibold">{detail.label}</p>
                            <Badge variant="outline" className="capitalize">{detail.result?.replaceAll("_", " ") ?? "Not answered"}</Badge>
                          </div>
                          {detail.resourceName ? <p className="mt-1 text-xs text-muted-foreground">{detail.resourceName}</p> : null}
                          {detail.note ? <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{detail.note}</p> : null}
                        </div>
                      ))}
                    </>
                  )}
                  {item?.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.notes as string}</p> : null}
                  {item?.id ? (
                    <Button aria-label={`Remove ${label.toLowerCase()} record`} size="sm" variant="outline" className="w-fit text-destructive" disabled={busy === item.id} onClick={() => void removeRecord(item)}>
                      {busy === item.id ? "Removing…" : "Remove"}
                    </Button>
                  ) : null}
                </section>
              );
            };
            return (
              <section
                key={event.key}
                className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                data-testid={`maintenance-event-${event.key}`}
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-expanded={isOpen}
                  aria-controls={detailsId}
                  onClick={() => void toggleEvent(event)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-foreground">{event.title}</span>
                    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Pre-event {pre ? readableStatus(pre.status) : "missing"}</span>
                      <span>Post-event {post ? readableStatus(post.status) : "missing"}</span>
                    </span>
                  </span>
                  <ChevronDown className={`mt-0.5 h-5 w-5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen ? (
                  <div id={detailsId} className="grid gap-3 border-t border-border p-4">
                    {phasePanel("Pre-event", pre)}
                    {phasePanel("Post-event", post)}
                    {other.map((item) => phasePanel(phaseLabel(item.phase) ?? "Maintenance", item))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
