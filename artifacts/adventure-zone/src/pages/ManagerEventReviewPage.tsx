import { useEffect, useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";

type OrganizerReview = {
  id: string;
  eventName: string;
  eventDateLabel: string | null;
  overallRating: number;
  professionalismRating: number;
  setupRating: number;
  communicationRating: number;
  inviteBack: "yes" | "maybe" | "no";
  comments: string | null;
  submittedAt: string;
  managerAcknowledgedAt: string | null;
  managerResponse: string | null;
};

function Stars({ value }: { value: number }) {
  return <span aria-label={`${value} out of 5 stars`} className="tracking-wide text-amber-500">{"★".repeat(value)}<span className="text-slate-300">{"★".repeat(5 - value)}</span></span>;
}

export default function ManagerEventReviewPage() {
  const { managerApi } = useManagerAuth();
  const [due, setDue] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<OrganizerReview[]>([]);
  const [summary, setSummary] = useState<{ reviewCount: number; averageOverallRating: number | null; inviteBackRate: number | null }>({ reviewCount: 0, averageOverallRating: null, inviteBackRate: null });
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadFeedback() {
    const data = await managerApi<any>("/manager/organizer-feedback");
    setFeedback(data.reviews ?? []);
    setSummary(data.summary ?? { reviewCount: 0, averageOverallRating: null, inviteBackRate: null });
  }

  useEffect(() => {
    Promise.all([
      managerApi<any>("/manager/reviews/due").then((data) => setDue(data.reviewsDue ?? [])),
      loadFeedback(),
    ]).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load event reviews"));
  }, [managerApi]);

  async function acknowledge(review: OrganizerReview) {
    setError(""); setMessage("");
    try {
      await managerApi(`/manager/organizer-feedback/${review.id}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ response: responses[review.id]?.trim() || null }),
        headers: { "content-type": "application/json" },
      });
      await loadFeedback();
      setMessage(responses[review.id]?.trim() ? "Review acknowledged and response saved." : "Review acknowledged.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not acknowledge review");
    }
  }

  return <div className="grid gap-6">
    <header><h1 className="text-2xl font-bold">Event Reviews</h1><p className="mt-1 text-sm text-slate-600">Your post-event wrap-ups and feedback that event organizers have sent back to The Adventure Zone.</p></header>
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</p> : null}

    <section className="grid gap-3">
      <div><h2 className="text-xl font-bold">Your event wrap-ups</h2><p className="text-sm text-slate-600">These are your own post-event reports about the event.</p></div>
      {due.length ? <div className="grid gap-2">
        {due.map((event) => <a key={event.id} href={`/manager/events/${event.id}/wrap-up`} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-4">
          <div><p className="font-bold">{event.name}</p><p className="text-sm text-slate-600">{[event.city, event.region].filter(Boolean).join(", ")}</p></div>
          <span className="button-primary">Open wrap-up</span>
        </a>)}
      </div> : <p className="rounded-xl border bg-white p-4 text-sm text-slate-600">No event wrap-ups are due.</p>}
    </section>

    <section className="grid gap-4">
      <div><h2 className="text-xl font-bold">Organizer Feedback</h2><p className="text-sm text-slate-600">These are the original reviews submitted by fairs and event organizers for events you managed. Organizer ratings and comments cannot be edited.</p></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4"><p className="text-sm font-semibold text-slate-500">Average rating</p><p className="mt-1 text-2xl font-bold">{summary.averageOverallRating == null ? "—" : `${summary.averageOverallRating} ★`}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-sm font-semibold text-slate-500">Reviews</p><p className="mt-1 text-2xl font-bold">{summary.reviewCount}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-sm font-semibold text-slate-500">Would invite us back</p><p className="mt-1 text-2xl font-bold">{summary.inviteBackRate == null ? "—" : `${summary.inviteBackRate}%`}</p></div>
      </div>

      {feedback.length ? <div className="grid gap-3">{feedback.map((review) => <article className="rounded-xl border bg-white p-4" key={review.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{review.eventName}</h3><p className="text-sm text-slate-500">{review.eventDateLabel ?? new Date(review.submittedAt).toLocaleDateString()}</p></div><div className="text-right"><Stars value={review.overallRating}/><p className="text-xs text-slate-500">Overall</p></div></div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p><b>Professionalism:</b> {review.professionalismRating}/5</p><p><b>Setup:</b> {review.setupRating}/5</p><p><b>Communication:</b> {review.communicationRating}/5</p></div>
        <p className="mt-3 text-sm"><b>Invite us back:</b> {review.inviteBack === "yes" ? "Yes" : review.inviteBack === "maybe" ? "Maybe" : "No"}</p>
        {review.comments ? <blockquote className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">“{review.comments}”</blockquote> : <p className="mt-3 text-sm text-slate-500">No written comments.</p>}
        {review.managerResponse ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><b>Your response:</b> {review.managerResponse}</div> : null}
        {!review.managerAcknowledgedAt ? <div className="mt-4 grid gap-2"><label className="text-sm font-semibold">Optional response<textarea className="mt-1 w-full" maxLength={3000} placeholder="Add a note about what you learned or what you'll change next time…" rows={3} value={responses[review.id] ?? ""} onChange={(event) => setResponses((current) => ({ ...current, [review.id]: event.target.value }))}/></label><button className="button-primary w-fit" type="button" onClick={() => void acknowledge(review)}>Acknowledge review</button></div> : <p className="mt-4 text-sm font-semibold text-emerald-700">✓ Acknowledged</p>}
      </article>)}</div> : <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No organizer reviews have been submitted yet.</p>}
    </section>
  </div>;
}
