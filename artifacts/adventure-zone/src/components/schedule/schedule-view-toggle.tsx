import { CalendarDays, Map } from "lucide-react";

export type ScheduleView = "calendar" | "map";

export function ScheduleViewToggle({ view, onChange }: { view: ScheduleView; onChange(view: ScheduleView): void }) {
  return (
    <div className="inline-grid grid-cols-2 rounded-xl bg-slate-100 p-1" aria-label="Schedule view">
      <button aria-pressed={view === "calendar"} className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${view === "calendar" ? "bg-white text-orange-700 shadow-sm" : "text-slate-600"}`} onClick={() => onChange("calendar")} type="button"><CalendarDays className="h-4 w-4" />Calendar</button>
      <button aria-pressed={view === "map"} className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${view === "map" ? "bg-white text-orange-700 shadow-sm" : "text-slate-600"}`} onClick={() => onChange("map")} type="button"><Map className="h-4 w-4" />Map</button>
    </div>
  );
}
