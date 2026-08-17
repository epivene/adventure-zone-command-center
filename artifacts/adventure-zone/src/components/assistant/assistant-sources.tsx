import { Link } from "wouter";

import type { AssistantSourceReference } from "@/features/assistant/assistant-types";

function sourceHref(source: AssistantSourceReference): string | null {
  if (source.kind === "booking") return `/bookings/${source.recordId}`;
  if (source.kind === "route") return "/routes";
  return null;
}

export function AssistantSources({
  sources,
}: {
  sources: AssistantSourceReference[];
}) {
  if (sources.length === 0) return null;

  return (
    <details className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-600">
        Sources / Why ({sources.length})
      </summary>
      <ul className="mt-2 grid gap-2">
        {sources.map((source) => {
          const href = sourceHref(source);
          const content = (
            <>
              <span className="font-semibold text-slate-800">{source.label}</span>
              <span className="ml-1 text-slate-500">
                · {source.kind.replaceAll("_", " ")}
              </span>
            </>
          );
          return (
            <li key={source.id}>
              {href ? (
                <Link className="link" href={href}>
                  {content}
                </Link>
              ) : (
                <span>{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
