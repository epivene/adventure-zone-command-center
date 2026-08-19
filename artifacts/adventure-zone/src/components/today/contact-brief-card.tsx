import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { apiGet } from "@/lib/auth-token";
import { profileResearchGaps } from "@/features/profile-research/profile-research-gaps";

type BriefItem = {
  key: string;
  text: string;
  confidence: "high" | "medium" | "low";
};

type BookingBrief = {
  headline: string;
  items: BriefItem[];
  generatedAt: string;
};

type ContactBriefTarget = {
  bookingId?: string | null;
  organizationId?: string | null;
  contactId?: string | null;
};

function resolveContext(target: ContactBriefTarget) {
  if (target.bookingId) return { kind: "booking", id: target.bookingId };
  if (target.organizationId) return { kind: "organization", id: target.organizationId };
  if (target.contactId) return { kind: "contact", id: target.contactId };
  return null;
}

function talkingPointFor(item: BriefItem) {
  switch (item.key) {
    case "package_history":
      return "Ask whether they want to repeat their usual package mix or change anything this year.";
    case "last_outcome":
      return "Reference the previous outcome before asking what is different this time.";
    case "objection_or_promise":
      return "Bring up the saved concern or promise and confirm whether it still applies.";
    case "timing":
      return "Confirm their planning and decision timeline.";
    case "attraction_count":
      return "Confirm the expected attraction count before discussing the package.";
    case "contact":
      return "Confirm this is still the right person for booking decisions.";
    case "follow_up":
    case "next_action":
      return "Use the saved follow-up as the goal for this conversation.";
    case "route_fit":
      return "Keep the route fit in mind while discussing dates and flexibility.";
    case "year_over_year_change":
      return "Ask what changed from last year and whether that affects this booking.";
    default:
      return null;
  }
}

export function ContactBriefCard({ target }: { target: ContactBriefTarget }) {
  const context = useMemo(
    () => resolveContext(target),
    [target.bookingId, target.organizationId, target.contactId],
  );
  const [brief, setBrief] = useState<BookingBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profileGapCount, setProfileGapCount] = useState(0);

  useEffect(() => {
    if (!context) {
      setBrief(null);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    apiGet<{ brief: BookingBrief }>(
      `/assistant/brief?kind=${encodeURIComponent(context.kind)}&id=${encodeURIComponent(context.id)}`,
    )
      .then((result) => {
        if (active) setBrief(result.brief);
      })
      .catch(() => {
        if (active) setError("Could not build the contact brief from saved history.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [context?.kind, context?.id, refreshKey]);

  useEffect(() => {
    if (!target.organizationId) {
      setProfileGapCount(0);
      return;
    }
    let active = true;
    const qs = target.contactId ? `?contactId=${encodeURIComponent(target.contactId)}` : "";
    apiGet<any>(`/event-profiles/${target.organizationId}${qs}`)
      .then((profile) => {
        if (active) setProfileGapCount(profileResearchGaps(profile).length);
      })
      .catch(() => {
        if (active) setProfileGapCount(0);
      });
    return () => {
      active = false;
    };
  }, [target.organizationId, target.contactId]);

  if (!context) return null;

  const usefulItems = brief?.items.filter((item) => item.key !== "next_action").slice(0, 4) ?? [];
  const talkingPoints = [
    ...new Set((brief?.items ?? []).map(talkingPointFor).filter((value): value is string => Boolean(value))),
  ].slice(0, 3);
  const researchHref = target.organizationId
    ? `/profiles/${target.organizationId}${target.contactId ? `?contactId=${encodeURIComponent(target.contactId)}&research=1` : "?research=1"}`
    : null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Before you contact them">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Before you contact them</p>
          <h3 className="mt-1 font-bold text-slate-950">Quick relationship brief</h3>
        </div>
        <button
          className="text-xs font-semibold text-orange-700 hover:underline disabled:opacity-50"
          disabled={loading}
          onClick={() => setRefreshKey((value) => value + 1)}
          type="button"
        >
          Refresh
        </button>
      </div>

      {loading && !brief ? <p className="mt-3 text-sm text-slate-500">Reading saved Command Center history…</p> : null}
      {error && !brief ? <p className="mt-3 text-sm text-slate-600">{error} You can still continue with the call.</p> : null}

      {brief ? (
        <div className="mt-3 grid gap-3">
          {usefulItems.length ? (
            <ul className="grid gap-1.5 text-sm text-slate-700">
              {usefulItems.map((item) => <li key={`${item.key}-${item.text}`}>• {item.text}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">There is not much saved history yet, so treat this like a newer relationship.</p>
          )}

          {talkingPoints.length ? (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Suggested talking points</p>
              <ul className="mt-1.5 grid gap-1 text-sm text-slate-700">
                {talkingPoints.map((point) => <li key={point}>• {point}</li>)}
              </ul>
            </div>
          ) : null}

          {profileGapCount > 0 && researchHref ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-800">Missing profile info</p>
                <p className="mt-1 text-sm text-amber-900">{profileGapCount} research gap{profileGapCount === 1 ? "" : "s"} could make this contact prep stronger.</p>
              </div>
              <Link className="text-sm font-semibold text-orange-700 hover:underline" href={researchHref}>Research profile</Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
