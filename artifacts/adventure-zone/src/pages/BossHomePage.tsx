import { useEffect, useState } from "react";
import { BossAttentionQueue } from "@/components/boss-work-requests/BossAttentionQueue";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, ClipboardList, RefreshCw, Star, Wrench } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet } from "@/lib/boss-auth-context";
import type { Assignment } from "@/lib/boss-types";

type DashboardData = {
  submittedReceipts: number;
  submittedDrafts: { id: string; name: string; type: string; updatedAt?: string }[];
  businessDocumentsCount: number;
  assignments: Assignment[];
  reviewAndWrapUp: { id?: string; title?: string; bookingId?: string; status?: string; eventDate?: string }[];
  checklistAndMaintenance: { id?: string; title?: string; bookingId?: string; phase?: string; status?: string; completedAt?: string | null }[];
  recentCompletedMaintenanceEvents?: { id?: string; title?: string; bookingId?: string; status?: string; completedAt: string }[];
};

function priorityColor(p: string) {
  switch (p) {
    case "urgent": return "destructive";
    case "high": return "default";
    case "normal": return "secondary";
    default: return "outline";
  }
}

function AssignmentRow({ a }: { a: Assignment }) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
      data-testid={`assignment-row-${a.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{a.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {a.assigneeKind === "office" ? "Amy" : "Owner"} ·{" "}
          {a.status.replace("_", " ")}
          {a.dueAt ? ` · Due ${new Date(a.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
        </p>
      </div>
      <Badge variant={priorityColor(a.priority) as "destructive" | "default" | "secondary" | "outline"}>
        {a.priority}
      </Badge>
    </div>
  );
}

export default function BossHomePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await bossGet<DashboardData>("/boss/dashboard");
      setData(d);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dashboard could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <div className="grid gap-4" data-testid="boss-home-loading">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center" role="alert">
        <p className="font-semibold text-destructive">{error}</p>
        <Button className="mt-4" onClick={() => void load()} variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  const urgentAssignments = (data?.assignments ?? []).filter(
    (a) => (a.priority === "urgent" || a.priority === "high") && !["done", "cancelled"].includes(a.status)
  );
  const allActiveAssignments = (data?.assignments ?? []).filter(
    (a) => !["done", "cancelled"].includes(a.status)
  );
  const recentMaintenanceEvents = (data?.recentCompletedMaintenanceEvents ?? [])
    .filter((item) => item.status === "completed" && Boolean(item.completedAt))
    .slice(0, 3);

  return (
    <div className="grid gap-6" data-testid="boss-home">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss Workspace</p>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Your Workspace</h1>
      </header>

      <BossAttentionQueue />
      <Link href="/boss/conventions?view=game" className="rounded-xl border border-border bg-card p-4 hover:border-primary/40">
        <h2 className="font-bold">Convention Game</h2>
        <p className="text-sm text-muted-foreground">Open your at-convention cards, check off conversations, and add notes</p>
      </Link>

      {/* At-a-glance stat strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/boss/receipts" className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Receipts</p>
          <p className="mt-1 text-2xl font-bold text-foreground" data-testid="stat-receipts">
            {data?.submittedReceipts ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">submitted</p>
        </Link>
        <Link href="/boss/templates-files" className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business Documents</p>
          <p className="mt-1 text-2xl font-bold text-foreground" data-testid="stat-documents">
            {data?.businessDocumentsCount ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">contracts, COIs &amp; emails</p>
        </Link>
        <Link href="/boss/assignments" className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assignments</p>
          <p className="mt-1 text-2xl font-bold text-foreground" data-testid="stat-assignments">
            {allActiveAssignments.length}
          </p>
          <p className="text-xs text-muted-foreground">active</p>
        </Link>
        <Link href="/boss/reviews" className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-colors">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reviews</p>
          <p className="mt-1 text-2xl font-bold text-foreground" data-testid="stat-reviews">
            {data?.reviewAndWrapUp?.length ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">pending wrap-up</p>
        </Link>
      </div>

      {/* Urgent assignments */}
      {urgentAssignments.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">High-Priority Assignments</h2>
            </div>
            <Link href="/boss/assignments" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid gap-2">
            {urgentAssignments.slice(0, 5).map((a) => <AssignmentRow key={a.id} a={a} />)}
          </div>
        </section>
      ) : null}

      {/* Reviews & wrap-up */}
      {(data?.reviewAndWrapUp ?? []).length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Event Reviews</h2>
            </div>
            <Link href="/boss/reviews" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid gap-2">
            {(data?.reviewAndWrapUp ?? []).slice(0, 3).map((item, i) => (
              <div
                key={item.id ?? i}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
                data-testid={`review-row-${item.id ?? i}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{item.title ?? "Event"}</p>
                  {item.eventDate ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(item.eventDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  ) : null}
                </div>
                {item.status ? (
                  <Badge variant="outline" className="shrink-0 capitalize">{item.status}</Badge>
                ) : null}
                {item.bookingId ? (
                  <Link href={`/boss/reviews?bookingId=${item.bookingId}`} className="text-xs font-semibold text-primary hover:underline shrink-0">
                    View
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Maintenance */}
      {recentMaintenanceEvents.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Maintenance</h2>
            </div>
            <Link href="/boss/maintenance" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid gap-2">
            {recentMaintenanceEvents.map((item, i) => (
              <Link
                href={item.bookingId ? `/boss/maintenance?bookingId=${encodeURIComponent(item.bookingId)}` : "/boss/maintenance"}
                key={item.bookingId ?? item.id ?? i}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:border-primary/40"
                data-testid={`maintenance-row-${item.bookingId ?? item.id ?? i}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{item.title ?? "Event"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Completed {new Date(item.completedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">Completed</Badge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* All-clear state */}
      {!loading && (data?.submittedReceipts ?? 0) === 0 && urgentAssignments.length === 0 && (data?.reviewAndWrapUp ?? []).length === 0 && recentMaintenanceEvents.length === 0 && (data?.businessDocumentsCount ?? 0) === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="boss-home-empty">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-bold text-foreground">All clear.</p>
          <p className="mt-1 text-sm text-muted-foreground">No high-priority items right now. Use the navigation to review any area.</p>
        </div>
      ) : null}
    </div>
  );
}
