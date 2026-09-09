import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { getBossWorkRequest } from "@/features/boss-work-requests/boss-work-request-api";
import type { BossWorkRequestDetail } from "@/features/boss-work-requests/boss-work-request-types";
import { RapidConventionNotesForm } from "@/components/boss-work-requests/RapidConventionNotesForm";
import { EmailTemplateReview } from "@/components/boss-work-requests/EmailTemplateReview";

export default function BossWorkRequestPage({ requestId }: { requestId: string }) {
  const [detail, setDetail] = useState<BossWorkRequestDetail | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { setDetail(await getBossWorkRequest(requestId)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this request."); }
  }, [requestId]);
  useEffect(() => { void reload(); }, [reload]);

  if (error) return <div className="rounded-xl border border-destructive/30 p-6 text-destructive">{error}</div>;
  if (!detail) return <div className="h-48 animate-pulse rounded-xl bg-muted" />;

  return (
    <main className="grid gap-5">
      <header>
        <Link href="/boss" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Back to attention list</Link>
        <h1 className="mt-2 text-2xl font-bold">{detail.request.title}</h1>
        {detail.request.instructions && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{detail.request.instructions}</p>}
      </header>
      {detail.request.type === "rapid_convention_notes"
        ? <RapidConventionNotesForm detail={detail} reload={reload} />
        : <EmailTemplateReview detail={detail} reload={reload} />}
    </main>
  );
}
