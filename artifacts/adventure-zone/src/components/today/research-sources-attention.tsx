import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";

import { apiGet } from "@/lib/auth-token";

type ScoutResult = {
  crmMatch?: { status?: "existing" | "possible_match" | "new_prospect" } | null;
};

type SavedResearchSource = {
  id: string;
  title: string;
  lastScoutedAt: string | null;
  lastScoutEndDate: string | null;
  lastScoutResults: ScoutResult[];
};

type AttentionSource = SavedResearchSource & {
  reason: "never_scouted" | "window_elapsed" | "new_prospects";
  newProspectCount: number;
};

function businessDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Denver",
  }).format(value);
}

function attentionFor(source: SavedResearchSource, todayKey: string): AttentionSource | null {
  const newProspectCount = (source.lastScoutResults ?? []).filter(
    (event) => (event.crmMatch?.status ?? "new_prospect") === "new_prospect",
  ).length;

  if (!source.lastScoutedAt) return { ...source, reason: "never_scouted", newProspectCount };
  if (newProspectCount > 0) return { ...source, reason: "new_prospects", newProspectCount };
  if (source.lastScoutEndDate && source.lastScoutEndDate < todayKey) {
    return { ...source, reason: "window_elapsed", newProspectCount };
  }
  return null;
}

function reasonLabel(source: AttentionSource) {
  if (source.reason === "never_scouted") return "Never scouted";
  if (source.reason === "new_prospects") return `${source.newProspectCount} New prospects waiting`;
  return "Ready for next window";
}

export function ResearchSourcesAttention() {
  const [sources, setSources] = useState<SavedResearchSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet<{ sources: SavedResearchSource[] }>("/research-sources")
      .then((response) => {
        if (!active) return;
        setSources(response.sources ?? []);
        setUnavailable(false);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const attention = useMemo(() => {
    const todayKey = businessDateKey();
    return sources
      .map((source) => attentionFor(source, todayKey))
      .filter((source): source is AttentionSource => Boolean(source))
      .sort((left, right) => {
        const priority = { new_prospects: 0, never_scouted: 1, window_elapsed: 2 } as const;
        return priority[left.reason] - priority[right.reason] || left.title.localeCompare(right.title);
      });
  }, [sources]);

  if (loading || unavailable || !attention.length) return null;

  const visible = attention.slice(0, 4);
  const remaining = Math.max(0, attention.length - visible.length);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Research Sources needing attention">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-950">Research Sources</h3>
          <p className="mt-1 text-sm text-slate-600">Useful prospecting sources that are ready for another look or already have new leads waiting.</p>
        </div>
        <Link className="text-sm font-semibold text-orange-700 hover:underline" href="/research-sources">Open sources</Link>
      </div>

      <ul className="mt-3 divide-y divide-slate-100">
        {visible.map((source) => (
          <li className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0" key={source.id}>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{source.title}</p>
              <p className={`mt-0.5 text-sm ${source.reason === "new_prospects" ? "font-semibold text-blue-700" : "text-slate-600"}`}>
                {reasonLabel(source)}
              </p>
            </div>
            <Link className="shrink-0 text-xs font-semibold text-orange-700 hover:underline" href="/research-sources">Review</Link>
          </li>
        ))}
      </ul>
      {remaining ? <p className="mt-3 text-xs font-semibold text-slate-500">+{remaining} more source{remaining === 1 ? "" : "s"} need review</p> : null}
    </section>
  );
}
