import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertCircle, CheckCircle2, ClipboardPenLine, MailCheck } from "lucide-react";
import { getBossWorkQueue } from "@/features/boss-work-requests/boss-work-request-api";
import type { BossWorkRequestQueue } from "@/features/boss-work-requests/boss-work-request-types";

const label = (type: string) => type === "rapid_convention_notes" ? "Convention notes" : "Email approval";

export function BossAttentionQueue() {
  const [queue, setQueue] = useState<BossWorkRequestQueue | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { getBossWorkQueue().then(setQueue).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load requests.")); }, []);

  if (error) return <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  if (!queue) return <div className="h-28 animate-pulse rounded-xl bg-muted" />;

  return (
    <section className="grid gap-3" aria-labelledby="attention-heading">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="attention-heading" className="text-xl font-bold">Needs Your Attention</h2>
          <p className="text-sm text-muted-foreground">Notes to fill out and email designs waiting for your answer.</p>
        </div>
        <span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">{queue.active.length}</span>
      </div>
      {queue.active.length === 0 ? (
        <div className="rounded-xl border bg-card p-5 text-center">
          <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
          <p className="mt-2 font-semibold">You’re all caught up.</p>
        </div>
      ) : queue.active.map((request) => {
        const Icon = request.type === "rapid_convention_notes" ? ClipboardPenLine : MailCheck;
        return (
          <Link key={request.id} href={`/boss/work-requests/${request.id}`}
            className="flex min-h-20 items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/50">
            <Icon className="h-6 w-6 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{request.title}</p>
              <p className="text-sm text-muted-foreground">{label(request.type)} · {request.state.replaceAll("_", " ")}</p>
              {request.instructions && <p className="mt-1 line-clamp-2 text-sm">{request.instructions}</p>}
            </div>
            {(request.priority === "urgent" || request.priority === "high") && <AlertCircle className="h-5 w-5 text-destructive" />}
          </Link>
        );
      })}
      {queue.recentlyCompleted.length > 0 && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer font-semibold">Recently completed ({queue.recentlyCompleted.length})</summary>
          <div className="mt-3 grid gap-2">
            {queue.recentlyCompleted.map((request) => <p key={request.id} className="text-sm text-muted-foreground">{request.title}</p>)}
          </div>
        </details>
      )}
    </section>
  );
}
