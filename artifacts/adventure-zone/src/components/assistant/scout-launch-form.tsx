import { useMemo, useState, type FormEvent } from "react";

export type ScoutEventCategory =
  | "fair"
  | "festival"
  | "rodeo"
  | "powwow"
  | "community_celebration"
  | "car_show"
  | "expo_show"
  | "parade"
  | "other_family_community";

export type ScoutHistoryFilter = "all" | "hide_booked" | "hide_booked_and_dismissed";

export type RadiusScoutSubmission = {
  anchorLabel: string;
  radiusMiles: 25 | 50 | 100 | 150 | 200 | 300;
  dateStart: string;
  dateEnd: string;
  categories: ScoutEventCategory[];
  historyFilter: ScoutHistoryFilter;
};

export type ScoutLaunchFormProps = {
  initialAnchor?: string;
  initialDateStart?: string;
  initialDateEnd?: string;
  initialRadiusMiles?: RadiusScoutSubmission["radiusMiles"];
  disabled?: boolean;
  onSubmit: (submission: RadiusScoutSubmission) => void | Promise<void>;
};

const radiusOptions = [25, 50, 100, 150, 200, 300] as const;
const categoryOptions: Array<{ value: ScoutEventCategory; label: string }> = [
  { value: "fair", label: "Fairs" },
  { value: "festival", label: "Festivals" },
  { value: "rodeo", label: "Rodeos" },
  { value: "powwow", label: "Powwows" },
  { value: "community_celebration", label: "Community celebrations" },
  { value: "car_show", label: "Car shows" },
  { value: "expo_show", label: "Expos / shows" },
  { value: "parade", label: "Parades" },
  { value: "other_family_community", label: "Other family/community events" },
];

export function ScoutLaunchForm({
  initialAnchor = "",
  initialDateStart = "",
  initialDateEnd = "",
  initialRadiusMiles = 100,
  disabled = false,
  onSubmit,
}: ScoutLaunchFormProps) {
  const [anchorLabel, setAnchorLabel] = useState(initialAnchor);
  const [radiusMiles, setRadiusMiles] = useState<(typeof radiusOptions)[number]>(initialRadiusMiles);
  const [dateStart, setDateStart] = useState(initialDateStart);
  const [dateEnd, setDateEnd] = useState(initialDateEnd);
  const [categories, setCategories] = useState<ScoutEventCategory[]>(categoryOptions.map((option) => option.value));
  const [historyFilter, setHistoryFilter] = useState<ScoutHistoryFilter>("hide_booked");
  const [error, setError] = useState<string | null>(null);

  const categorySet = useMemo(() => new Set(categories), [categories]);

  function toggleCategory(category: ScoutEventCategory) {
    setCategories((current) => current.includes(category)
      ? current.filter((value) => value !== category)
      : [...current, category]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const anchor = anchorLabel.trim();
    if (!anchor) {
      setError("Choose an event or enter a city, state, or address.");
      return;
    }
    if (!dateStart || !dateEnd) {
      setError("Choose a start and end date.");
      return;
    }
    if (dateEnd < dateStart) {
      setError("The end date must be on or after the start date.");
      return;
    }
    if (categories.length === 0) {
      setError("Choose at least one event type.");
      return;
    }

    setError(null);
    await onSubmit({ anchorLabel: anchor, radiusMiles, dateStart, dateEnd, categories, historyFilter });
  }

  return (
    <form className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5" onSubmit={handleSubmit}>
      <div>
        <h3 className="font-bold text-slate-950">Scout Events</h3>
        <p className="mt-1 text-sm text-slate-600">Search around an event or location instead of guessing which towns to check.</p>
      </div>

      <label className="grid gap-1 text-sm font-semibold text-slate-800">
        Search around
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 font-normal shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
          disabled={disabled}
          onChange={(event) => setAnchorLabel(event.currentTarget.value)}
          placeholder="Miles City, MT or an event name"
          value={anchorLabel}
        />
      </label>

      <label className="grid gap-1 text-sm font-semibold text-slate-800">
        Radius
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 font-normal shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
          disabled={disabled}
          onChange={(event) => setRadiusMiles(Number(event.currentTarget.value) as (typeof radiusOptions)[number])}
          value={radiusMiles}
        >
          {radiusOptions.map((radius) => <option key={radius} value={radius}>{radius} miles</option>)}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          Start date
          <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" disabled={disabled} onChange={(event) => setDateStart(event.currentTarget.value)} type="date" value={dateStart} />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          End date
          <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" disabled={disabled} onChange={(event) => setDateEnd(event.currentTarget.value)} type="date" value={dateEnd} />
        </label>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold text-slate-800">Event types</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {categoryOptions.map((option) => (
            <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" key={option.value}>
              <input checked={categorySet.has(option.value)} disabled={disabled} onChange={() => toggleCategory(option.value)} type="checkbox" />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="grid gap-1 text-sm font-semibold text-slate-800">
        Existing Adventure Zone history
        <select className="rounded-lg border border-slate-300 px-3 py-2 font-normal" disabled={disabled} onChange={(event) => setHistoryFilter(event.currentTarget.value as ScoutHistoryFilter)} value={historyFilter}>
          <option value="all">Show all</option>
          <option value="hide_booked">Hide already booked</option>
          <option value="hide_booked_and_dismissed">Hide booked and previously dismissed</option>
        </select>
      </label>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}

      <button className="button-primary" disabled={disabled} type="submit">Scout Area</button>
    </form>
  );
}
