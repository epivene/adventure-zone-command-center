import { useEffect, useState } from "react";
import { RefreshCw, Wrench } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { LegRecordPicker, groupRecordsByLeg, recordsForLeg } from "@/components/boss/leg-record-picker";
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

export default function BossMaintenancePage() {
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [selectedLegKey, setSelectedLegKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [record, setRecord] = useState<MaintenanceRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossGet<DashboardData>("/boss/dashboard");
      setItems(Array.isArray(data.checklistAndMaintenance) ? data.checklistAndMaintenance : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load maintenance items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const legGroups = groupRecordsByLeg(items);
  const effectiveLegKey = legGroups.some((group) => group.key === selectedLegKey) ? selectedLegKey : null;
  const legItems = recordsForLeg(items, effectiveLegKey);
  const phases = ["all", ...Array.from(new Set(legItems.map((i) => i.phase).filter(Boolean) as string[]))];

  const effectiveFilter = phases.includes(filter) ? filter : "all";
  const filtered = effectiveFilter === "all" ? legItems : legItems.filter((i) => i.phase === effectiveFilter);

  function selectLeg(key: string | null) {
    setSelectedLegKey(key);
    setFilter("all");
  }

  async function openRecord(id: string) {
    if (openId === id) { setOpenId(null); setRecord(null); return; }
    setBusy(id);
    setError(null);
    try {
      const data = await bossGet<{ record: MaintenanceRecord }>(`/boss/maintenance/${id}`);
      setRecord(data.record);
      setOpenId(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open maintenance record.");
    } finally { setBusy(null); }
  }

  async function removeRecord(item: MaintenanceItem) {
    if (!item.id || !window.confirm(`Remove the saved maintenance record for “${item.title ?? "this event"}”?`)) return;
    setBusy(item.id);
    try {
      await bossDelete(`/boss/maintenance/${item.id}`);
      if (openId === item.id) { setOpenId(null); setRecord(null); }
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

      {effectiveLegKey && phases.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist">
          {phases.map((p) => (
            <Button
              key={p}
              role="tab"
              aria-selected={effectiveFilter === p}
              variant={effectiveFilter === p ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(p)}
              data-testid={`tab-maintenance-${p}`}
            >
              {p === "all" ? "All" : phaseLabel(p)}
            </Button>
          ))}
        </div>
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
          {filtered.map((item, i) => (
            <div
              key={item.id ?? i}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
              data-testid={`maintenance-item-${item.id ?? i}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-foreground">{item.title ?? `Item ${i + 1}`}</p>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                    {item.phase ? (
                      <span className="text-xs text-muted-foreground">{phaseLabel(item.phase)}</span>
                    ) : null}
                    {item.dueAt ? (
                      <span className="text-xs text-muted-foreground">
                        Due {new Date(item.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    ) : null}
                  </div>
                </div>
                {item.status ? (
                  <Badge variant={statusVariant(item.status)} className="capitalize shrink-0">
                    {item.status.replace("_", " ")}
                  </Badge>
                ) : null}
              </div>
              {item.notes ? (
                <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{item.notes as string}</p>
              ) : null}
              {item.id ? <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy === item.id} onClick={() => void openRecord(item.id!)}>
                  {openId === item.id ? "Close record" : busy === item.id ? "Opening…" : "Open record"}
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" disabled={busy === item.id} onClick={() => void removeRecord(item)}>
                  Remove
                </Button>
              </div> : null}
              {openId === item.id && record ? <div className="mt-4 grid gap-2 border-t border-border pt-4">
                <p className="text-sm font-semibold">{record.legName ?? "Crew"} · {record.items.length} checklist item{record.items.length === 1 ? "" : "s"}</p>
                {record.items.map((detail) => <div className="rounded-lg bg-muted/50 p-3 text-sm" key={detail.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold">{detail.label}</p>
                    <Badge variant="outline" className="capitalize">{detail.result?.replaceAll("_", " ") ?? "Not answered"}</Badge>
                  </div>
                  {detail.resourceName ? <p className="mt-1 text-xs text-muted-foreground">{detail.resourceName}</p> : null}
                  {detail.note ? <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{detail.note}</p> : null}
                </div>)}
              </div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
