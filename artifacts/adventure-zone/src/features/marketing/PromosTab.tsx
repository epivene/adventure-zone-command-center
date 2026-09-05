import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import {
  formatDate,
  PROMO_KEY,
  readPromos,
  writePromos,
  type NoticeDispatch,
  type Promo,
} from "./types";

export function PromosTab({ setNotice }: { setNotice: NoticeDispatch }) {
  const [promos, setPromos] = useState<Promo[]>(() => readPromos());
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("Brochure");
  const [notes, setNotes] = useState("");

  const promoRef = useRef(promos);
  promoRef.current = promos;
  useEffect(() => { writePromos(promos); }, [promos]);

  function addPromo() {
    if (!title.trim()) return;
    const item: Promo = {
      id: crypto.randomUUID(),
      title: title.trim(),
      kind,
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
    };
    setPromos((prev) => [item, ...prev]);
    setTitle("");
    setNotes("");
    setNotice({
      kind: "ok",
      text: `Saved promo material "${item.title}". Note: brochure records are stored locally in this browser only.`,
    });
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-bold">Add Promo Material</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Track brochures, promo sheets, postcards, and reusable marketing pieces. These records
          are stored locally in this browser only — not on the server.
        </p>
        <div
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-border dark:bg-muted/40 dark:text-muted-foreground"
          data-testid="promo-local-storage-disclosure"
        >
          Browser-local storage only. Clearing browser data will remove these records.
        </div>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm font-semibold">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="2027 Adventure Zone brochure"
              data-testid="promo-title-input"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option>Brochure</option>
              <option>Promo sheet</option>
              <option>Postcard</option>
              <option>Flyer</option>
              <option>Other</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Notes
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Distribution plan, quantity, target event…"
            />
          </label>
          <button
            className="button-primary"
            disabled={!title.trim()}
            onClick={addPromo}
            data-testid="promo-save-btn"
          >
            Save Material
          </button>
        </div>
      </div>

      <div>
        {promos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No promo materials saved yet. Add one using the form.
          </div>
        ) : (
          <div className="grid gap-3" data-testid="promo-list">
            {promos.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
                data-testid={`promo-item-${p.id}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold">{p.title}</h3>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                      {p.kind}
                    </span>
                  </div>
                  {p.notes ? (
                    <p className="mt-1 text-sm text-muted-foreground">{p.notes}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Saved {formatDate(p.createdAt)} — {PROMO_KEY} (browser only)
                  </p>
                </div>
                <button
                  onClick={() =>
                    setPromos((prev) => prev.filter((x) => x.id !== p.id))
                  }
                  className="shrink-0 text-destructive hover:text-destructive/80"
                  aria-label={`Remove "${p.title}"`}
                  data-testid={`promo-delete-${p.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
