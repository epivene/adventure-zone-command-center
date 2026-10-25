import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "wouter";
import { apiGet, apiPost } from "@/lib/auth-token";
import {
  mountainInput,
  mountainInstant,
} from "@/features/today/follow-up-time";
import { ComDraftPanel } from "./com-draft-panel";

type Bucket = "needsNextStep" | "overdue" | "today" | "upcoming";
type Item = {
  id: string;
  source: "followup" | "booking" | "opportunity" | "conversation";
  revision: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  eventYear?: number | null;
  name: string;
  nextAction: string;
  dueAt: string | null;
  status: string | null;
};
type Page = {
  items: Item[];
  total: number;
  counts: Record<Bucket, number>;
  offset: number;
  limit: number;
  timeZone: string;
};
const buckets: { id: Bucket; label: string }[] = [
  { id: "needsNextStep", label: "Needs a next step" },
  { id: "today", label: "Due today" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Coming up" },
];
const button =
  "min-h-11 rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-muted";
const cardButton =
  "min-h-9 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 hover:bg-muted";
const field =
  "w-full rounded-md border border-border bg-background p-2 text-foreground";
const afterDays = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Denver",
  }).format(new Date(value));

export function FollowUpBoard({
  onChanged,
}: { onChanged?: () => Promise<unknown> } = {}) {
  const [pages, setPages] = useState<Partial<Record<Bucket, Page>>>({});
  const [days, setDays] = useState(7);
  const [offsets, setOffsets] = useState<Record<Bucket, number>>({
    needsNextStep: 0,
    overdue: 0,
    today: 0,
    upcoming: 0,
  });
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null),
    [selected, setSelected] = useState<Item | null>(null);
  const [outcome, setOutcome] = useState(""),
    [kind, setKind] = useState("Email follow-up"),
    [dueAt, setDueAt] = useState(mountainInput(afterDays(7)));
  const [noFurther, setNoFurther] = useState(false),
    [reason, setReason] = useState("");
  const generation = useRef(0);
  const [draftProfile, setDraftProfile] = useState<{
    id: string;
    name: string;
    eventYear?: number | null;
  } | null>(null);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const results = await Promise.all(
        buckets.map(
          async (b) =>
            [
              b.id,
              await apiGet<Page>(
                `/work-queue?bucket=${b.id}&days=${days}&offset=${offsets[b.id]}&limit=25`,
              ),
            ] as const,
        ),
      );
      if (request === generation.current) {
        setPages(Object.fromEntries(results));
        setLoading(false);
      }
    } catch (cause) {
      if (request === generation.current) {
        setError(
          cause instanceof Error ? cause.message : "Could not load work.",
        );
        setLoading(false);
      }
      throw cause;
    }
  }, [days, offsets]);
  useEffect(() => {
    void refresh().catch(() => {});
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const update = () => {
      if (!document.hidden && !busy && !selected)
        void refresh().catch(() => {});
    };
    window.addEventListener("focus", update);
    const timer = window.setInterval(update, 60000);
    return () => {
      window.removeEventListener("focus", update);
      window.clearInterval(timer);
    };
  }, [refresh, busy, selected]);
  const counts = pages.needsNextStep?.counts;
  function choose(item: Item) {
    setSelected(item);
    setOutcome("");
    setKind(item.nextAction || "Email follow-up");
    setDueAt(mountainInput(afterDays(7)));
    setNoFurther(false);
    setReason("");
    setError(null);
  }
  async function mutate(path: string, payload: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let saved = false;
    try {
      await apiPost(path, payload);
      saved = true;
      setSelected(null);
      setNotice("Follow-up saved.");
      await refresh();
      await onChanged?.();
    } catch (cause) {
      setError(
        saved
          ? "Saved, but refresh failed. Reload to see the current queue."
          : cause instanceof Error
            ? cause.message
            : "Could not save follow-up.",
      );
      // Never retry a write automatically. Read the current revisions first.
      if (!saved) {
        setSelected(null);
        await refresh().catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    let nextAction: { kind: string; dueAt: string } | null = null;
    try {
      if (!noFurther) nextAction = { kind, dueAt: mountainInstant(dueAt) };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Choose a valid date.");
      return;
    }
    if (selected.source === "followup")
      await mutate(`/follow-ups/${selected.id}/resolve`, {
        expectedRevision: selected.revision,
        outcome,
        nextAction: noFurther ? null : nextAction,
        ...(noFurther ? { noFurtherActionReason: reason } : {}),
      });
    else
      await mutate("/work-queue/decide", {
        id: selected.id,
        source: selected.source,
        expectedRevision: selected.revision,
        outcome: outcome || "Next action reviewed",
        nextAction: noFurther ? null : nextAction,
        ...(noFurther ? { noFurtherActionReason: reason } : {}),
      });
  }
  return (
    <section className="grid gap-4" aria-label="Follow-up work queue">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Work queue</h2>
          <p className="text-xs text-muted-foreground">
            All times Mountain Time
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="work-horizon">Coming up</label>
          <select
            id="work-horizon"
            className={button}
            value={days}
            disabled={busy}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setOffsets({
                needsNextStep: 0,
                overdue: 0,
                today: 0,
                upcoming: 0,
              });
            }}
          >
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
          </select>
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              setError(null);
              void refresh().catch(() => {});
            }}
          >
            Refresh
          </button>
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {loading ? <p role="status">Loading follow-ups…</p> : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {buckets.map((bucket) => {
          const page = pages[bucket.id];
          const emptyToday = bucket.id === "today" && page?.total === 0;
          return (
            <section
              key={bucket.id}
              id={`work-${bucket.id}`}
              aria-label={bucket.label}
              className={`min-w-0 rounded-xl border bg-card ${bucket.id === "needsNextStep" ? "lg:col-span-2 border-2 border-destructive p-4" : bucket.id === "today" ? "lg:col-span-2 border-border p-3" : "border-border p-3"}`}
            >
              <div
                className={`flex flex-wrap items-center justify-between gap-2 ${emptyToday ? "" : "mb-3"}`}
              >
                <h3 className="text-lg font-bold">
                  {bucket.label}{" "}
                  <span className="text-sm">({page?.total ?? "…"})</span>
                </h3>
                {emptyToday ? (
                  <p className="text-xs text-muted-foreground">
                    All clear for today
                  </p>
                ) : null}
              </div>
              {bucket.id === "needsNextStep" ? (
                <div
                  role={
                    counts && counts.needsNextStep > 0 ? "alert" : undefined
                  }
                  aria-label="Missing next steps"
                  className="mb-3 text-sm"
                >
                  {counts && counts.needsNextStep > 0 ? (
                    <>
                      <strong>
                        {counts.needsNextStep} records need a next step.
                      </strong>{" "}
                      Choose an action so nothing gets missed.
                    </>
                  ) : counts ? (
                    "Every active record has a next step."
                  ) : (
                    "Checking for missing next steps…"
                  )}
                </div>
              ) : null}
              <ul
                className={`grid gap-2 ${bucket.id === "needsNextStep" || bucket.id === "today" ? "md:grid-cols-2" : ""}`}
              >
                {page?.items.map((item) => (
                  <li
                    className="min-w-0 grid content-start gap-1.5 rounded-lg border border-border bg-background p-3"
                    key={`${item.source}:${item.id}`}
                  >
                    {item.organizationId ? (
                      <Link
                        href={`/profiles/${item.organizationId}`}
                        className="break-words font-bold underline"
                      >
                        {item.name}
                      </Link>
                    ) : (
                      <span className="font-bold">{item.name}</span>
                    )}
                    {item.eventYear ? (
                      <strong className="text-xs">
                        {item.eventYear} season
                      </strong>
                    ) : null}
                    <p className="break-words text-sm">{item.nextAction}</p>
                    {item.dueAt ? (
                      <p className="text-xs text-muted-foreground">
                        {dateLabel(item.dueAt)} MT
                      </p>
                    ) : (
                      <strong className="text-sm text-destructive">
                        No next action scheduled
                      </strong>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {item.source === "followup" ? (
                        <button
                          className={cardButton}
                          disabled={busy}
                          aria-label={`Snooze ${item.name} 7 days`}
                          onClick={() =>
                            void mutate(`/follow-ups/${item.id}/snooze`, {
                              expectedRevision: item.revision,
                              dueAt: afterDays(7),
                            })
                          }
                        >
                          Snooze 7d
                        </button>
                      ) : null}
                      <button
                        className={cardButton}
                        disabled={busy}
                        aria-label={`Complete ${item.name}`}
                        onClick={() => choose(item)}
                      >
                        {item.source === "followup"
                          ? "Done + next"
                          : "Set next step"}
                      </button>
                      {item.organizationId ? (
                        <button
                          className={cardButton}
                          disabled={busy}
                          aria-label={`Draft with COM for ${item.name}`}
                          onClick={() =>
                            setDraftProfile({
                              id: item.organizationId!,
                              name: item.name,
                              eventYear: item.eventYear,
                            })
                          }
                        >
                          Draft with COM
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {page && !page.items.length && !emptyToday ? (
                <p className="text-sm text-muted-foreground">
                  {page.total
                    ? "No items on this page. Use Previous to return."
                    : "Nothing in this bucket."}
                </p>
              ) : null}
              {page && (page.total > 25 || offsets[bucket.id] > 0) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={busy || offsets[bucket.id] === 0}
                    onClick={() =>
                      setOffsets((x) => ({
                        ...x,
                        [bucket.id]: Math.max(0, x[bucket.id] - 25),
                      }))
                    }
                  >
                    Previous
                  </button>
                  <button
                    className={button}
                    disabled={busy || offsets[bucket.id] + 25 >= page.total}
                    onClick={() =>
                      setOffsets((x) => ({
                        ...x,
                        [bucket.id]: x[bucket.id] + 25,
                      }))
                    }
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      {draftProfile ? (
        <ComDraftPanel
          key={`${draftProfile.id}:${draftProfile.eventYear ?? "any"}`}
          profileId={draftProfile.id}
          name={draftProfile.name}
          eventYear={draftProfile.eventYear}
          onClose={() => setDraftProfile(null)}
        />
      ) : null}
      {selected ? (
        <form
          onSubmit={(e) => void save(e)}
          aria-label="Follow-up decision"
          className="grid gap-3 rounded-xl border-2 border-primary bg-card p-4"
        >
          <h3 className="text-lg font-bold">
            {selected.name}:{" "}
            {selected.source === "followup"
              ? "done + next step"
              : "set next step"}
          </h3>
          <label>
            Outcome
            <input
              className={field}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              required
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={noFurther}
              onChange={(e) => setNoFurther(e.target.checked)}
            />
            No further action
          </label>
          {noFurther ? (
            <label>
              Reason
              <input
                className={field}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </label>
          ) : (
            <>
              <label>
                Next action
                <input
                  className={field}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  required
                />
              </label>
              <label>
                Due date and time (Mountain)
                <input
                  className={field}
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  required
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {[4, 7, 21].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={button}
                    onClick={() => setDueAt(mountainInput(afterDays(n)))}
                  >
                    In {n} days
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              type="submit"
              disabled={
                busy ||
                !outcome.trim() ||
                (noFurther ? !reason.trim() : !kind.trim() || !dueAt)
              }
            >
              Save decision
            </button>
            <button
              className={button}
              type="button"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
