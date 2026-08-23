import { useEffect, useState } from "react";

import {
  listNeedsAnswers,
  resolveNeedsAnswer,
  type NeedsAnswerItem,
} from "@/features/assistant/needs-answer-api";

function contextHref(item: NeedsAnswerItem) {
  if (item.bookingId) return `/bookings/${item.bookingId}`;
  if (item.contactId) return `/contacts/${item.contactId}`;
  if (item.organizationId) return `/profiles/${item.organizationId}`;
  return null;
}

export default function NeedsAnswerPage() {
  const [items, setItems] = useState<NeedsAnswerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listNeedsAnswers());
    } catch {
      setError("Could not load Needs Answer right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function resolve(item: NeedsAnswerItem) {
    const resolution = resolutions[item.id]?.trim();
    if (!resolution) return;
    setSavingId(item.id);
    setError(null);
    try {
      const updated = await resolveNeedsAnswer(item.id, resolution);
      setItems((current) => current.map((candidate) => candidate.id === item.id ? updated : candidate));
    } catch {
      setError("Could not save that answer.");
    } finally {
      setSavingId(null);
    }
  }

  const open = items.filter((item) => item.status === "open");
  const resolved = items.filter((item) => item.status === "resolved");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Needs Answer</h1>
        <p className="mt-2 text-slate-600">Questions saved during calls that still need an answer.</p>
      </header>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
      {loading ? <p className="text-sm text-slate-600">Loading questions…</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Open</h2>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">{open.length}</span>
        </div>
        {open.length ? (
          <div className="mt-4 grid gap-4">
            {open.map((item) => {
              const href = contextHref(item);
              return (
                <article className="rounded-xl border border-slate-200 p-4" key={item.id}>
                  <p className="font-semibold text-slate-950">{item.question}</p>
                  {item.userNote ? <p className="mt-2 text-sm text-slate-600">{item.userNote}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium text-slate-500">
                    <span>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</span>
                    {href ? <a className="font-semibold text-orange-700 underline" href={href}>Open related profile</a> : null}
                  </div>
                  <label className="mt-4 grid gap-1.5 text-sm font-semibold">
                    Answer
                    <textarea
                      className="min-h-24"
                      onChange={(event) => setResolutions((current) => ({ ...current, [item.id]: event.target.value }))}
                      value={resolutions[item.id] ?? ""}
                    />
                  </label>
                  <button
                    className="button-primary mt-3"
                    disabled={savingId === item.id || !(resolutions[item.id]?.trim())}
                    onClick={() => void resolve(item)}
                    type="button"
                  >
                    {savingId === item.id ? "Saving…" : "Mark resolved"}
                  </button>
                </article>
              );
            })}
          </div>
        ) : !loading ? <p className="mt-4 text-sm text-slate-600">Nothing needs an answer right now.</p> : null}
      </section>

      {resolved.length ? (
        <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-xl font-bold">Resolved ({resolved.length})</summary>
          <div className="mt-4 grid gap-3">
            {resolved.map((item) => (
              <article className="rounded-lg border border-slate-200 p-4" key={item.id}>
                <p className="font-semibold">{item.question}</p>
                <p className="mt-2 text-sm text-slate-700">{item.resolution}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
