export type ScoutNoteSource = {
  url: string;
  title: string;
  publisher: string | null;
  category: string;
  retrievedAt: string;
};

export type ScoutNoteView = {
  id: string;
  occurredAt: Date | string;
  runId: string;
  candidateId: string;
  createdAt: string;
  originalQuestion: string;
  criteriaSummary: string | null;
  fitScore: number | null;
  summary: string;
  positives: string[];
  cautions: string[];
  coverageGaps: string[];
  suggestedNextAction: {
    kind: "call" | "email" | "prepare_quote";
    dueAt: string;
  };
  sources: ScoutNoteSource[];
};

function readableDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function businessDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : readableDate(date) ?? value;
}

function actionLabel(kind: ScoutNoteView["suggestedNextAction"]["kind"]) {
  if (kind === "prepare_quote") return "Prepare quote";
  if (kind === "email") return "Send email";
  return "Call";
}

function uniqueItems(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function ScoutNotesPanel({ notes }: { notes: ScoutNoteView[] }) {
  if (!notes.length) return null;

  const orderedNotes = notes.toSorted((left, right) => {
    const leftTime = new Date(left.occurredAt).getTime();
    const rightTime = new Date(right.occurredAt).getTime();
    return rightTime - leftTime || left.id.localeCompare(right.id);
  });

  return (
    <section aria-labelledby="scout-notes-heading" className="overflow-hidden rounded-xl border border-orange-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-orange-100 bg-orange-50 px-4 py-4 sm:px-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">Booking intelligence</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900" id="scout-notes-heading">Scout Notes</h2>
          <p className="mt-1 text-sm text-slate-600">Research Scout saved when this potential booking was added.</p>
        </div>
        <span className="rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-orange-800">
          {notes.length} {notes.length === 1 ? "report" : "reports"}
        </span>
      </header>

      <div className="grid gap-4 p-4 sm:p-5">
        {orderedNotes.map((note) => {
          const verificationItems = uniqueItems([...note.cautions, ...note.coverageGaps]);
          const savedAt = readableDate(note.occurredAt);
          return (
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={note.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-slate-900">{note.summary}</p>
                  {note.criteriaSummary ? <p className="mt-1 text-sm text-slate-600">{note.criteriaSummary}</p> : null}
                </div>
                {note.fitScore !== null ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800">
                    {Math.round(note.fitScore)}% fit
                  </span>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <h3 className="text-sm font-bold text-emerald-900">Why it fits</h3>
                  {note.positives.length ? (
                    <ul className="mt-2 grid gap-1 text-sm text-emerald-950">
                      {note.positives.map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                  ) : <p className="mt-2 text-sm text-emerald-900">Scout did not save separate fit bullets.</p>}
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <h3 className="text-sm font-bold text-amber-950">Things to verify</h3>
                  {verificationItems.length ? (
                    <ul className="mt-2 grid gap-1 text-sm text-amber-950">
                      {verificationItems.map((item) => <li key={item}>• {item}</li>)}
                    </ul>
                  ) : <p className="mt-2 text-sm text-amber-900">No unresolved concerns were saved.</p>}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Suggested next step</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {actionLabel(note.suggestedNextAction.kind)} by {businessDate(note.suggestedNextAction.dueAt)}
                </p>
              </div>

              {note.sources.length ? (
                <div className="mt-4">
                  <h3 className="text-sm font-bold text-slate-800">Sources</h3>
                  <ul className="mt-2 grid gap-2">
                    {note.sources.map((source) => (
                      <li className="flex flex-wrap items-baseline gap-x-2 text-sm" key={`${source.url}:${source.title}`}>
                        <a
                          className="font-semibold text-orange-700 underline decoration-orange-300 underline-offset-2 hover:text-orange-900"
                          href={source.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {source.title}
                        </a>
                        {source.publisher ? <span className="text-slate-500">{source.publisher}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <p className="mt-4 text-sm text-slate-500">No source links were saved with this Scout report.</p>}

              <footer className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
                {savedAt ? `Scouted ${savedAt}` : "Scout report"} · Original request: {note.originalQuestion}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}