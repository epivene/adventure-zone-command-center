export type BookingCopilotPriority = "urgent" | "high" | "normal" | "low";

export type BookingCopilotReason = {
  priority: BookingCopilotPriority;
  headline: string;
  reasons: string[];
};

const priorityLabel: Record<BookingCopilotPriority, string> = {
  urgent: "Urgent",
  high: "High priority",
  normal: "Priority",
  low: "Later",
};

const priorityClass: Record<BookingCopilotPriority, string> = {
  urgent: "bg-rose-100 text-rose-800",
  high: "bg-amber-100 text-amber-900",
  normal: "bg-orange-100 text-orange-800",
  low: "bg-slate-100 text-slate-700",
};

export function CopilotReason({
  copilot,
  compact = false,
}: {
  copilot?: BookingCopilotReason | null;
  compact?: boolean;
}) {
  if (!copilot) return null;

  return (
    <div className={compact ? "mt-2" : "mt-3 rounded-xl border border-slate-200 bg-white/80 p-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${priorityClass[copilot.priority]}`}>
          {priorityLabel[copilot.priority]}
        </span>
        <span className="text-sm font-semibold text-slate-900">{copilot.headline}</span>
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-500">Why this is next</p>
      <ul className="mt-1 grid gap-0.5 text-sm text-slate-700">
        {copilot.reasons.slice(0, compact ? 2 : 3).map((reason) => (
          <li key={reason}>• {reason}</li>
        ))}
      </ul>
    </div>
  );
}
