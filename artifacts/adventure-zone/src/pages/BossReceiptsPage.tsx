import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet } from "@/lib/boss-auth-context";

type Receipt = {
  id: string;
  submittedBy?: string | null;
  amount?: number | null;
  category?: string | null;
  description?: string | null;
  submittedAt?: string | null;
  status?: string | null;
  vendor?: string | null;
  [key: string]: unknown;
};

function statusVariant(status?: string | null): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "approved": return "default";
    case "rejected": return "destructive";
    case "submitted": return "secondary";
    default: return "outline";
  }
}

export default function BossReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Dashboard has submittedReceipts count; actual list comes from /boss/dashboard or a dedicated receipts key
      const data = await bossGet<{ receipts?: Receipt[]; submittedReceipts?: number; items?: Receipt[] } | Receipt[]>("/boss/dashboard");
      if (Array.isArray(data)) {
        setReceipts(data);
      } else {
        // Try known shapes
        const list = (data as { receipts?: Receipt[] }).receipts ?? (data as { items?: Receipt[] }).items ?? [];
        setReceipts(list);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load receipts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="grid gap-5" data-testid="boss-receipts-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Submitted Receipts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Read-only visibility into submitted receipts.</p>
        </div>
        <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

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
      ) : receipts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="receipts-empty">
          <p className="font-semibold text-foreground">No submitted receipts.</p>
          <p className="mt-1 text-sm text-muted-foreground">Receipts submitted by Amy or the owner will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {receipts.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              data-testid={`receipt-row-${r.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground truncate">
                  {r.vendor ?? r.description ?? r.category ?? "Receipt"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {r.submittedBy ? `${r.submittedBy} · ` : ""}
                  {r.submittedAt
                    ? new Date(r.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                    : ""}
                  {r.category ? ` · ${r.category}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.amount != null ? (
                  <span className="text-sm font-semibold text-foreground">
                    ${Number(r.amount).toLocaleString()}
                  </span>
                ) : null}
                <Badge variant={statusVariant(r.status)} className="capitalize">
                  {r.status ?? "submitted"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
