import { useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { EventWrapUpReviewQueue } from "@/components/routes/event-wrap-up-review-queue";

function Detail({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === "") return null;
  return <p className="text-sm"><span className="font-semibold">{label}:</span> {String(value)}</p>;
}

export default function ManagerAftermathAdminPage() {
  const [wrapUps, setWrapUps] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [followOnly, setFollowOnly] = useState(false);
  const [openReview, setOpenReview] = useState<string | null>(null);
  const [openIncident, setOpenIncident] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiGet<any>("/event-wrap-up-admin"),
      apiGet<any>("/manager-admin/reviews"),
      apiGet<any>("/manager-admin/incidents"),
    ]).then(([wrap, reviewData, incidentData]) => {
      setWrapUps(wrap.wrapUps ?? []);
      setReviews(reviewData.reviews ?? []);
      setIncidents(incidentData.incidents ?? []);
    });
  }, []);

  const visibleIncidents = incidents.filter((incident) => !followOnly || incident.followUpNeeded);

  return <div className="mx-auto grid max-w-5xl gap-6">
    <header>
      <h1 className="text-3xl font-bold">Event aftermath</h1>
      <p className="text-slate-600">Review submitted event wrap-ups, profitability, cash settlement, ratings, and incidents across all travel legs.</p>
    </header>

    <section className="grid gap-3">
      <div>
        <h2 className="text-xl font-bold">Wrap-ups waiting for review</h2>
        <p className="text-sm text-slate-600">These are the current post-event closeouts submitted by managers.</p>
      </div>
      <EventWrapUpReviewQueue wrapUps={wrapUps} />
    </section>

    <section>
      <h2 className="text-xl font-bold">Legacy reviews</h2>
      <p className="text-sm text-slate-600">{reviews.length} historical reviews from the older aftermath form.</p>
      {reviews.map((review) => {
        const open = openReview === review.id;
        return <article key={review.id} className="mt-2 rounded-xl border bg-white">
          <button type="button" aria-expanded={open} className="w-full p-3 text-left" onClick={() => setOpenReview(open ? null : review.id)}>
            <div className="flex items-center justify-between gap-3"><span><b>{review.rating}/5</b></span><span className="text-sm font-semibold text-orange-700">{open ? "Hide details" : "View details"}</span></div>
            {review.feedback ? <p className="mt-1">{review.feedback}</p> : null}
          </button>
          {open ? <div className="grid gap-1 border-t p-3"><Detail label="Organizer / site notes" value={review.organizerSiteNotes} /><Detail label="Crew notes" value={review.crewNotes} /><Detail label="Submitted" value={review.createdAt ? new Date(review.createdAt).toLocaleString() : null} /></div> : null}
        </article>;
      })}
    </section>

    <section>
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Incidents</h2><label className="flex gap-2"><input type="checkbox" aria-label="Follow-up only" checked={followOnly} onChange={(event) => setFollowOnly(event.target.checked)} />Follow-up only</label></div>
      {visibleIncidents.map((incident) => {
        const open = openIncident === incident.id;
        return <article key={incident.id} className="mt-2 rounded-xl border bg-white">
          <button type="button" aria-expanded={open} className="w-full p-3 text-left" onClick={() => setOpenIncident(open ? null : incident.id)}>
            <div className="flex items-center justify-between gap-3"><b>{incident.type}</b><span className="text-sm font-semibold text-orange-700">{open ? "Hide details" : "View details"}</span></div>
            <p>{incident.description}</p>{incident.followUpNeeded ? <p className="font-semibold text-amber-700">Follow-up needed</p> : null}
          </button>
          {open ? <div className="grid gap-1 border-t p-3"><Detail label="Occurred" value={incident.occurredAt ? new Date(incident.occurredAt).toLocaleString() : null} /><Detail label="Location" value={incident.locationText} /><Detail label="People involved" value={incident.peopleInvolved} /><Detail label="Action taken" value={incident.actionTaken} /></div> : null}
        </article>;
      })}
    </section>
  </div>;
}
