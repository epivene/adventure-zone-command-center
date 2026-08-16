import { useEffect, useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";

export default function ManagerEventReviewPage() {
  const { managerApi } = useManagerAuth();
  const [due, setDue] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    managerApi<any>("/manager/reviews/due")
      .then((data) => setDue(data.reviewsDue ?? []))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load event wrap-ups"));
  }, [managerApi]);

  return <div className="grid gap-4">
    <header><h1 className="text-2xl font-bold">Event wrap-ups</h1><p className="mt-1 text-sm text-slate-600">Finish the post-event rating, money check, receipts, travel share, and profitability in one place.</p></header>
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    {due.length ? <div className="grid gap-2">
      {due.map((event) => <a key={event.id} href={`/manager/events/${event.id}/wrap-up`} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-4">
        <div><p className="font-bold">{event.name}</p><p className="text-sm text-slate-600">{[event.city, event.region].filter(Boolean).join(", ")}</p></div>
        <span className="button-primary">Open wrap-up</span>
      </a>)}
    </div> : <p className="rounded-xl border bg-white p-4 text-sm text-slate-600">No event wrap-ups are due.</p>}
  </div>;
}
