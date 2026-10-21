import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/auth-token";
import {
  workRequest,
  labels,
  statuses,
  queues,
  type WorkActivity,
  type WorkPage,
  type Actor,
} from "./client";
import { BulkReleaseWork } from "./BulkReleaseWork";
import { WorkActivityCard } from "./WorkActivityCard";
export function WorkQueue({ profileId }: { profileId?: string }) {
  const [items, setItems] = useState<WorkActivity[]>([]),
    [actors, setActors] = useState<Actor[]>([]),
    [status, setStatus] = useState(""),
    [queue, setQueue] = useState(""),
    [year, setYear] = useState(""),
    [actor, setActor] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0),
    [creating, setCreating] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const generation = useRef(0);
  const previousQuery = useRef("");
  const editingIds = useRef(new Set<string>());
  const query = () => {
    const q = new URLSearchParams();
    if (profileId) q.set("profileId", profileId);
    if (status) q.set("status", status);
    if (queue) q.set("queue", queue);
    if (year) q.set("eventYear", year);
    if (actor) {
      const a = actors.find((x) => `${x.kind}:${x.id}` === actor);
      if (a) q.set("actor", JSON.stringify({ kind: a.kind, id: a.id }));
    }
    return q;
  };
  useEffect(() => {
    let live = true;
    workRequest<Actor[]>("/actors")
      .then((a) => {
        if (live) setActors(Array.isArray(a) ? a : []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const g = ++generation.current;
    setLoading(true);
    setError("");
    const queryKey = query().toString();
    const sameQuery = previousQuery.current === queryKey;
    previousQuery.current = queryKey;
    if (!sameQuery) {
      setItems([]);
      editingIds.current.clear();
    }
    setCursor(null);
    workRequest<WorkPage>("?" + query())
      .then((d) => {
        if (g !== generation.current) return;
        setItems((old) =>
          sameQuery
            ? [
                ...d.items,
                ...old.filter(
                  (a) =>
                    editingIds.current.has(a.id) &&
                    !d.items.some((b) => b.id === a.id),
                ),
              ]
            : d.items,
        );
        setCursor(d.nextCursor);
      })
      .catch((e) => {
        if (g === generation.current) setError(e.message);
      })
      .finally(() => {
        if (g === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [profileId, status, queue, year, actor, tick]);
  async function more() {
    if (!cursor) return;
    const g = generation.current,
      q = query();
    q.set("cursor", cursor);
    setLoading(true);
    try {
      const d = await workRequest<WorkPage>("?" + q);
      if (g !== generation.current) return;
      setItems((old) => [
        ...old,
        ...d.items.filter((a) => !old.some((x) => x.id === a.id)),
      ]);
      setCursor(d.nextCursor);
    } catch (e) {
      if (g === generation.current)
        setError(e instanceof Error ? e.message : "Could not load more.");
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  return (
    <section className="grid min-w-0 gap-3" aria-label="Shared booking work">
      <BulkReleaseWork
        query={query().toString()}
        canStart={() => editingIds.current.size === 0 && !creating}
        onBusy={setBulkBusy}
        onChanged={() => setTick(t => t + 1)}
      />
      <fieldset disabled={bulkBusy} className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Shared booking work</h2>
          <p className="text-sm text-muted-foreground">
            Progress, review links and next actions for you and Com.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="button-secondary"
            onClick={() => setTick((t) => t + 1)}
          >
            Refresh work
          </button>
          <button
            className="button-primary"
            onClick={() => setCreating((v) => !v)}
          >
            New work
          </button>
        </div>
      </div>
      {creating ? (
        <CreateWork
          profileId={profileId}
          onSaved={() => {
            setCreating(false);
            setTick((t) => t + 1);
          }}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="grid gap-1 text-xs">
          Filter status
          <select
            className="min-w-0 rounded border bg-background p-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          Filter queue
          <select
            className="min-w-0 rounded border bg-background p-2"
            value={queue}
            onChange={(e) => setQueue(e.target.value)}
          >
            <option value="">All queues</option>
            {queues.map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          Filter year
          <input
            className="min-w-0 rounded border bg-background p-2"
            type="number"
            min="2000"
            max="2200"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs">
          Filter owner
          <select
            className="min-w-0 rounded border bg-background p-2"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          >
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={`${a.kind}:${a.id}`} value={`${a.kind}:${a.id}`}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm">
          Loading work…
        </p>
      ) : null}
      {!loading && !error && !items.length ? (
        <p className="rounded border border-dashed p-4 text-sm">
          No matching work.
        </p>
      ) : null}
      {items.map((a) => (
        <WorkActivityCard
          key={a.id}
          activity={a}
          actors={actors}
          onEditingChange={(editing) => {
            if (editing) editingIds.current.add(a.id);
            else editingIds.current.delete(a.id);
          }}
          onChanged={() => setTick((t) => t + 1)}
        />
      ))}
      {cursor ? (
        <button
          className="button-secondary"
          disabled={loading}
          onClick={() => void more()}
        >
          Load more work
        </button>
      ) : null}
      </fieldset>
    </section>
  );
}
function CreateWork({
  profileId,
  onSaved,
}: {
  profileId?: string;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(profileId ?? ""),
    [search, setSearch] = useState(""),
    [matches, setMatches] = useState<Array<{ id: string; name: string }>>([]),
    [title, setTitle] = useState(""),
    [year, setYear] = useState("2027"),
    [queue, setQueue] = useState("replies"),
    [next, setNext] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function find() {
    setBusy(true);
    try {
      const r = await apiFetch(
        `/organizations?q=${encodeURIComponent(search)}&pageSize=10`,
      );
      if (!r.ok) throw Error("Could not search profiles.");
      const d = await r.json();
      setMatches(d.organizations?.records ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const d = await workRequest<{ created: boolean; activity: WorkActivity }>(
        "",
        "POST",
        {
          profileId: selected,
          eventYear: Number(year),
          queue,
          title,
          nextAction: next,
        },
      );
      if (!d.created) {
        setError(
          "This event already has active work for that year. Open its profile to continue that activity.",
        );
        return;
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2 rounded-xl border p-4">
      {!profileId ? (
        <>
          <label className="grid gap-1 text-sm">
            Find profile
            <input
              className="rounded border bg-background p-2"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelected("");
              }}
            />
          </label>
          <button
            className="button-secondary justify-self-start"
            disabled={busy || !search.trim()}
            onClick={() => void find()}
          >
            Search profiles
          </button>
          {matches.map((p) => (
            <button
              className="text-left underline"
              key={p.id}
              onClick={() => {
                setSelected(p.id);
                setSearch(p.name);
                setMatches([]);
              }}
            >
              {p.name}
            </button>
          ))}
        </>
      ) : null}
      <label className="grid gap-1 text-sm">
        Work title
        <input
          className="rounded border bg-background p-2"
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Booking year
        <input
          className="rounded border bg-background p-2"
          type="number"
          min="2000"
          max="2200"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Queue
        <select
          className="rounded border bg-background p-2"
          value={queue}
          onChange={(e) => setQueue(e.target.value)}
        >
          {queues.map((q) => (
            <option key={q} value={q}>
              {labels[q]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        First next action
        <textarea
          className="rounded border bg-background p-2"
          maxLength={2000}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <button
        className="button-primary justify-self-start"
        disabled={
          busy ||
          !selected ||
          !title.trim() ||
          !next.trim() ||
          Number(year) < 2000 ||
          Number(year) > 2200
        }
        onClick={() => void save()}
      >
        Create work
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
