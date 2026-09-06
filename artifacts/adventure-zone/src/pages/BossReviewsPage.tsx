import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { RefreshCw, Star } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossDelete, bossGet } from "@/lib/boss-auth-context";

type ReviewItem = {
  id?: string;
  bookingId?: string;
  title?: string;
  eventDate?: string | null;
  status?: string | null;
  wrapUpStatus?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

type DashboardData = {
  reviewAndWrapUp?: ReviewItem[];
  [key: string]: unknown;
};

export default function BossReviewsPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const search = useSearch();
  const focusBookingId = new URLSearchParams(search).get("bookingId");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossGet<DashboardData>("/boss/dashboard");
      setItems(Array.isArray(data.reviewAndWrapUp) ? data.reviewAndWrapUp : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load reviews.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function removeDue(item: ReviewItem) {
    if (!item.bookingId || !window.confirm(`Remove “${item.title ?? "this event"}” from Review Due?`)) return;
    setBusy(item.bookingId);
    try {
      await bossDelete(`/boss/reviews/due/${item.bookingId}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove review-due item.");
    } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-5" data-testid="boss-reviews-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Event Reviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">Post-event review and wrap-up visibility.</p>
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
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="reviews-empty">
          <Star className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">No event reviews pending.</p>
          <p className="mt-1 text-sm text-muted-foreground">Completed events will appear here for post-event review and wrap-up.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item, i) => {
            const isFocused = focusBookingId && item.bookingId === focusBookingId;
            return (
              <section
                key={item.id ?? i}
                className={`rounded-xl border bg-card p-4 shadow-sm transition-colors ${
                  isFocused ? "border-primary" : "border-border"
                }`}
                data-testid={`review-item-${item.id ?? i}`}
                id={item.bookingId ? `booking-${item.bookingId}` : undefined}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-foreground">{item.title ?? `Event ${i + 1}`}</p>
                    {item.eventDate ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(item.eventDate).toLocaleDateString(undefined, {
                          weekday: "long", month: "long", day: "numeric", year: "numeric"
                        })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {item.status ? (
                      <Badge variant="outline" className="capitalize">{item.status}</Badge>
                    ) : null}
                    {item.wrapUpStatus ? (
                      <Badge variant="secondary" className="capitalize">{item.wrapUpStatus}</Badge>
                    ) : null}
                  </div>
                </div>
                {item.notes ? (
                  <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{item.notes as string}</p>
                ) : null}
                {item.status === "review_due" && item.bookingId ? (
                  <Button className="mt-3 text-destructive" variant="outline" size="sm" disabled={busy === item.bookingId} onClick={() => void removeDue(item)}>
                    {busy === item.bookingId ? "Removing…" : "Remove from Review Due"}
                  </Button>
                ) : null}
                {/* Show any other top-level keys as detail fields */}
                {Object.entries(item).filter(([k]) => !["id", "bookingId", "title", "eventDate", "status", "wrapUpStatus", "notes"].includes(k)).map(([k, v]) => {
                  if (v == null || v === "") return null;
                  const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
                  return (
                    <div key={k} className="mt-2 text-xs">
                      <span className="font-semibold text-muted-foreground">{label}: </span>
                      <span className="text-foreground">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
