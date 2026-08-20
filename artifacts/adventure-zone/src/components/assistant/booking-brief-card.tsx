import type {
  AssistantContextBundle,
  BookingBrief,
} from "@/features/assistant/assistant-types";

function confidenceLabel(confidence: BookingBrief["items"][number]["confidence"]) {
  if (confidence === "high") return "Saved record";
  if (confidence === "medium") return "Historical pattern";
  return "Limited evidence";
}

export function BookingBriefCard({
  brief,
  context,
}: {
  brief: BookingBrief;
  context: AssistantContextBundle | null;
}) {
  const familyMode = context?.context.kind === "event_family";
  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50/50 p-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">
          {familyMode ? "Family Overview" : "Booking Brief"}
        </p>
        <h3 className="mt-1 font-bold text-slate-950">{brief.headline}</h3>
        {context ? (
          <p className="mt-1 text-xs text-slate-500">
            Using saved Command Center data for {context.context.label}.
          </p>
        ) : null}
      </div>

      {brief.items.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {brief.items.map((item, index) => (
            <li
              className="rounded-lg border border-orange-100 bg-white p-3 text-sm"
              key={`${item.key}-${index}`}
            >
              <p className="text-slate-900">{item.text}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {confidenceLabel(item.confidence)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          {familyMode
            ? "There isn’t enough saved family context yet for a detailed overview. Add member details or notes, then try again."
            : "There isn’t enough saved booking history yet for a detailed brief. You can still ask about the current booking."}
        </p>
      )}
    </section>
  );
}
