import {
  officeTemplatePlaceholderLabels,
  parseTemplateSegments,
  serializeTemplateSegments,
  type TemplateSegment,
} from "@/features/office/template-authoring";

function normalizeSegments(segments: TemplateSegment[]): TemplateSegment[] {
  const result: TemplateSegment[] = [];
  for (const segment of segments) {
    const previous = result[result.length - 1];
    if (segment.kind === "text" && previous?.kind === "text") previous.value += segment.value;
    else result.push({ ...segment } as TemplateSegment);
  }
  if (!result.length) result.push({ kind: "text", value: "" });
  return result;
}

export function ProtectedTemplateText({
  value,
  onChange,
  multiline = false,
  label,
}: {
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  label: string;
}) {
  let segments: TemplateSegment[];
  try {
    segments = parseTemplateSegments(value);
  } catch {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">This template contains an invalid protected field.</div>;
  }

  function commit(next: TemplateSegment[]) {
    onChange(serializeTemplateSegments(normalizeSegments(next)));
  }

  return (
    <div className="grid gap-2">
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex flex-wrap items-stretch gap-1 rounded-lg border border-slate-300 bg-white p-2">
        {segments.map((segment, index) => {
          if (segment.kind === "token") {
            const label = officeTemplatePlaceholderLabels[segment.token];
            return (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-900" key={`${segment.token}:${index}`}>
                {label}
                <button aria-label={`Move ${label} left`} disabled={index === 0} onClick={() => { const next = [...segments]; const [item] = next.splice(index, 1); next.splice(Math.max(0, index - 1), 0, item!); commit(next); }} type="button">←</button>
                <button aria-label={`Move ${label} right`} disabled={index === segments.length - 1} onClick={() => { const next = [...segments]; const [item] = next.splice(index, 1); next.splice(Math.min(next.length, index + 1), 0, item!); commit(next); }} type="button">→</button>
                <button aria-label={`Remove ${label}`} onClick={() => commit(segments.filter((_, itemIndex) => itemIndex !== index))} type="button">×</button>
              </span>
            );
          }

          const common = {
            value: segment.value,
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              const next = [...segments];
              next[index] = { kind: "text", value: event.target.value };
              commit(next);
            },
          };
          return multiline ? (
            <textarea aria-label={`${label} text ${index + 1}`} className="min-h-20 min-w-[12rem] flex-1 resize-y border-0 p-1 text-sm focus:ring-0" key={`text:${index}`} {...common} />
          ) : (
            <input aria-label={`${label} text ${index + 1}`} className="min-w-[8rem] flex-1 border-0 p-1 text-sm focus:ring-0" key={`text:${index}`} {...common} />
          );
        })}
      </div>
    </div>
  );
}
