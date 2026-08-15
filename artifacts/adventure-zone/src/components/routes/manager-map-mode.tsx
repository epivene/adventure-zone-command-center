import type { ManagerMapMode } from "@/features/routes/manager-map-navigation";

export function ManagerMapModeToggle({
  mode,
  onChange,
}: {
  mode: ManagerMapMode;
  onChange: (mode: ManagerMapMode) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Manager map mode</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          aria-pressed={mode === "planning"}
          className={mode === "planning" ? "button-primary px-4" : "button-secondary px-4"}
          onClick={() => onChange("planning")}
          type="button"
        >
          Planning
        </button>
        <button
          aria-pressed={mode === "on-road"}
          className={mode === "on-road" ? "button-primary px-4" : "button-secondary px-4"}
          onClick={() => onChange("on-road")}
          type="button"
        >
          On the Road
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {mode === "planning"
          ? "Plan route order, mileage, handoffs, and fuel context."
          : "Keep the next destination and Google Maps navigation close at hand."}
      </p>
    </section>
  );
}
