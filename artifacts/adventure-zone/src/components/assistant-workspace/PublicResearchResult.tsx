import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { DocumentResult } from "@/features/assistant-workspace/types";
import { AssistantMessage } from "./AssistantMessage";

type Research = Extract<DocumentResult["data"], { view: "public_research" }>;
type Source = { title: string; url: string };

function SavedResearchStatus({ saved }: { saved: Research["savedResearch"] }) {
  if (!saved) return null;
  const stale = saved.stale || Date.parse(saved.expiresAt) <= Date.now();
  return (
    <div className="mt-2 space-y-1 text-xs text-slate-600">
      <p>
        Saved research ·{" "}
        <time dateTime={saved.generatedAt}>
          {new Date(saved.generatedAt).toLocaleString()}
        </time>
      </p>
      {saved.reusedAt && (
        <p>Reused saved report; no new web search was made.</p>
      )}
      {stale && (
        <p className="text-amber-800">
          This research is older than 24 hours. Ask to refresh for current
          information.
        </p>
      )}
    </div>
  );
}

function SourceLink({ source }: { source: Source }) {
  let url: URL | null = null;
  try {
    const parsed = new URL(source.url);
    if (["http:", "https:"].includes(parsed.protocol)) url = parsed;
  } catch {
    // Keep the source label readable without making malformed URLs clickable.
  }
  const label =
    source.title.trim() && source.title !== source.url
      ? source.title
      : (url?.hostname ?? (source.title || "Unavailable source"));
  return (
    <li className="min-w-0 break-words [overflow-wrap:anywhere]">
      {url ? (
        <>
          <a
            href={source.url}
            title={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center break-words py-2 text-teal-800 underline underline-offset-2 [overflow-wrap:anywhere]"
          >
            {label}
          </a>
          {label !== url.hostname && (
            <span className="block text-xs text-slate-500">{url.hostname}</span>
          )}
        </>
      ) : (
        <span>
          <span>{label}</span> (link unavailable)
        </span>
      )}
    </li>
  );
}

export function PublicResearchResult({ data }: { data: Research }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const queryId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    // The compact workspace itself is a native modal. Another showModal()
    // puts this report above that sheet in the browser's modal top layer.
    if (!node.open) node.showModal();
    closeButton.current?.focus();
  }, [open]);
  const close = () => {
    if (dialog.current?.open) dialog.current.close();
    setOpen(false);
    trigger.current?.focus();
  };
  // This is an exact excerpt, never a generated summary. All original parts
  // and their citation lists remain available together in the expanded report.
  const firstText = data.parts[0]?.text ?? "";
  const excerpt = firstText.slice(0, 700);
  return (
    <>
      <h3 className="font-semibold">Public research</h3>
      <p className="mt-1 line-clamp-2 break-words text-xs text-slate-600 [overflow-wrap:anywhere]">
        {data.query}
      </p>
      <SavedResearchStatus saved={data.savedResearch} />
      {!data.complete && (
        <p className="mt-2 text-amber-800">Research incomplete</p>
      )}
      {excerpt && (
        <div
          role="region"
          aria-label="Research excerpt"
          tabIndex={0}
          className="mt-3 max-h-48 min-w-0 overflow-y-auto overscroll-contain pr-1 text-sm leading-relaxed"
        >
          <AssistantMessage text={excerpt} />
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Preview. Open the full report for all findings and sources.
      </p>
      {data.warnings.length > 0 && (
        <p className="mt-1 text-xs text-amber-800">
          {data.warnings.length} research note(s) in the full report.
        </p>
      )}
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="mt-3 min-h-11 w-full rounded-lg border px-3 py-2 text-sm font-semibold"
      >
        View full report
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={queryId}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
          onClose={(event) => {
            event.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
          }}
          onClick={(event) => {
            event.stopPropagation();
            if (event.target !== event.currentTarget) return;
            const box = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            )
              close();
          }}
          className="fixed inset-0 m-auto flex h-[90dvh] max-h-[90dvh] w-[calc(100%_-_1.5rem)] max-w-5xl flex-col gap-4 overflow-hidden rounded-xl border bg-background p-4 text-foreground shadow-2xl backdrop:bg-slate-950/40 sm:p-6"
        >
          <header className="min-w-0 shrink-0 space-y-2 pr-12 text-left">
            <h2 id={titleId} className="text-lg font-semibold">
              Public research report
            </h2>
            <p
              id={queryId}
              tabIndex={0}
              className="max-h-24 overflow-y-auto break-words text-sm text-muted-foreground [overflow-wrap:anywhere]"
            >
              {data.query}
            </p>
            <p className="break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
              {data.model} · Saved research; ask to refresh for current
              information.
            </p>
            <SavedResearchStatus saved={data.savedResearch} />
          </header>
          <button
            ref={closeButton}
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-3 top-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border bg-background"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
          <div
            role="region"
            aria-label="Full research report"
            tabIndex={0}
            className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain pr-2 text-base leading-relaxed"
          >
            {!data.complete && (
              <p className="text-sm text-amber-800">Research incomplete</p>
            )}
            {data.parts.map((part, index) => (
              <section key={index} className="min-w-0">
                <AssistantMessage text={part.text} />
                {part.citations.length > 0 && (
                  <div className="mt-3 rounded-lg border bg-slate-50 p-3 text-sm">
                    <h4 className="font-semibold">Sources for this section</h4>
                    <ol className="mt-1 list-decimal space-y-1 pl-5">
                      {part.citations.map((source, sourceIndex) => (
                        <SourceLink
                          key={`${source.url}:${sourceIndex}`}
                          source={source}
                        />
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            ))}
            <section className="min-w-0 border-t pt-4 text-sm">
              <h4 className="font-semibold">Consulted sources</h4>
              {data.consultedSources.length ? (
                <ul className="mt-1 space-y-1">
                  {data.consultedSources.map((source, index) => (
                    <SourceLink
                      key={`${source.url}:${index}`}
                      source={source}
                    />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-slate-600">
                  No additional consulted sources recorded.
                </p>
              )}
            </section>
            {data.warnings.length > 0 && (
              <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <h4 className="font-semibold">Research notes</h4>
                {data.warnings.map((warning, index) => (
                  <p
                    key={index}
                    className="mt-2 break-words [overflow-wrap:anywhere]"
                  >
                    {warning}
                  </p>
                ))}
              </section>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
