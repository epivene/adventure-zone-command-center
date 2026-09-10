import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { apiFetch } from "@/lib/auth-token";
import { bossFetch } from "@/lib/boss-auth-context";

const labels: Record<string, string> = {
  returning: "Returning",
  new: "New / reintroduction",
  replacement: "Replacement provider",
  confirm: "Confirm first",
  special: "Special handling",
};
const outcomes = [
  "not_contacted",
  "sent",
  "replied",
  "interested",
  "follow_up",
  "declined",
  "booked",
  "do_not_contact",
];
type Data = {
  sourceKey: string;
  event: string;
  contact: string;
  email: string;
  group: string;
  outcome: string;
  attendance: string;
  notes: string;
  reason: string;
  sources: string;
  nextAction: string;
  research?: Record<string, string>;
  conventionResponse?: {
    met: boolean;
    interested: boolean;
    followUp: boolean;
    contact: string;
    notes: string;
  };
};
type Member = {
  id: string;
  edition_id: string;
  organization_id: string | null;
  contact_id: string | null;
  revision: number;
  event_info?: {
    city: string | null;
    region: string | null;
    placeType: string | null;
    bookingName: string | null;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
  data: Data;
};
type Edition = {
  id: string;
  convention: string;
  year: number;
  summary: string;
  recommendation: string;
  sources: string;
  revision: number;
  member_count: number;
  unresolved_count: number;
  archived_at: string | null;
};
type Detail = {
  edition: Edition;
  members: Member[];
  review: { reviewed_revision: number; note: string } | null;
  history: {
    id: string;
    kind: string;
    actor: string;
    occurred_at: string;
    payload: unknown;
  }[];
};
const box = "rounded-xl border bg-card p-4";
const field = "w-full rounded-lg border bg-background p-2";
const button = "min-h-11 rounded-lg border px-3 py-2 disabled:opacity-50";
export async function conventionRequest<T>(
  boss: boolean,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await (boss ? bossFetch : apiFetch)(
    `${boss ? "/boss" : ""}/conventions${path}`,
    {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Could not load conventions.");
  return result;
}
export default function ConventionOutreachPage({
  boss = false,
}: {
  boss?: boolean;
}) {
  const search = useSearch();
  const requestedView = new URLSearchParams(search).get("view");
  const [editions, setEditions] = useState<Edition[]>([]),
    [selected, setSelected] = useState(
      new URLSearchParams(search).get("edition") || "",
    );
  const [year, setYear] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState(""),
    [page, setPage] = useState(0),
    [view, setView] = useState<"cards" | "game">(
      requestedView === "game" ? "game" : "cards",
    );
  const [error, setError] = useState(""),
    [gameError, setGameError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [note, setNote] = useState("");
  const [planEditing, setPlanEditing] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null),
    [gameEditing, setGameEditing] = useState<Member | null>(null),
    [conflictLatest, setConflictLatest] = useState<Member | null>(null),
    [savedCard, setSavedCard] = useState(""),
    [create, setCreate] = useState(false),
    [name, setName] = useState(""),
    [newYear, setNewYear] = useState(new Date().getFullYear());
  const [preview, setPreview] = useState<{
      revision: number;
      rows: { member: Data; match: unknown }[];
      mutationKey: string;
    } | null>(null),
    [rollover, setRollover] = useState(false);
  const request = <T,>(path: string, method = "GET", body?: unknown) =>
    conventionRequest<T>(boss, path, method, body);
  async function reload() {
    const result = await request<{ editions: Edition[] }>("");
    setEditions(result.editions);
    if (selected) {
      const d = await request<Detail>(`/${selected}`);
      setDetail(d);
      setNote(d.review?.note || "");
    }
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetail(null);
    setPreview(null);
    setEditing(null);
    setGameEditing(null);
    setConflictLatest(null);
    setSavedCard("");
    setGameError("");
    setRollover(false);
    setPlanEditing(false);
    setPage(0);
    Promise.all([
      request<{ editions: Edition[] }>(""),
      selected ? request<Detail>(`/${selected}`) : Promise.resolve(null),
    ])
      .then(([list, d]) => {
        if (active) {
          setEditions(list.editions);
          setDetail(d);
          setNote(d?.review?.note || "");
          setError("");
          if (!selected && requestedView === "game") {
            const newest =
              list.editions.find((edition) => !edition.archived_at) ||
              list.editions[0];
            if (newest) {
              setYear(String(newest.year));
              setSelected(newest.id);
            }
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, boss]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function saveGameCard(member: Member) {
    setBusy(true);
    setGameError("");
    setConflictLatest(null);
    try {
      await request(
        `/${member.edition_id}/members/${member.id}/convention-response`,
        "PATCH",
        {
          revision: member.revision,
          conventionResponse: member.data.conventionResponse,
        },
      );
      setDetail((current) =>
        current
          ? {
              ...current,
              edition: {
                ...current.edition,
                revision: current.edition.revision + 1,
              },
              members: current.members.map((item) =>
                item.id === member.id
                  ? { ...member, revision: member.revision + 1 }
                  : item,
              ),
            }
          : current,
      );
      setSavedCard(member.id);
      setGameEditing(null);
    } catch (cause) {
      setGameError(
        cause instanceof Error ? cause.message : "Could not save this card.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshGameCard(member: Member) {
    setBusy(true);
    setGameError("");
    try {
      const current = await request<Detail>(`/${member.edition_id}`);
      setDetail(current);
      const latest = current.members.find((item) => item.id === member.id);
      if (!latest)
        throw new Error("This convention card is no longer available.");
      setConflictLatest(latest);
    } catch (cause) {
      setGameError(
        cause instanceof Error ? cause.message : "Could not reload this card.",
      );
    } finally {
      setBusy(false);
    }
  }
  const filtered =
    detail?.members.filter(
      (m) =>
        (!group || m.data.group === group) &&
        `${m.data.event} ${m.data.contact} ${m.data.email} ${m.data.notes}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 print:max-w-none print:p-0">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">Convention Outreach</h1>
        <Link href={boss ? "/boss" : "/dave-requests"} className={button}>
          Workspace
        </Link>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-lg bg-destructive/10 p-3 text-destructive"
        >
          {error}{" "}
          <button className={button} onClick={() => void act(reload)}>
            Retry
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 print:hidden">
        <label>
          Year{" "}
          <select
            disabled={busy}
            aria-label="Year"
            className={field}
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              setSelected("");
            }}
          >
            <option value="">All years</option>
            {[...new Set(editions.map((e) => e.year))].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="grow">
          Convention{" "}
          <select
            disabled={busy}
            aria-label="Convention"
            className={field}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a convention</option>
            {editions
              .filter((e) => !year || String(e.year) === year)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.convention} {e.year} ({e.member_count})
                </option>
              ))}
          </select>
        </label>
        {!boss && (
          <button className={button} onClick={() => setCreate(!create)}>
            Add convention year
          </button>
        )}
      </div>
      {create && !boss && (
        <form
          className={box}
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const r = await request<{ edition: Edition }>("", "POST", {
                convention: name,
                year: newYear,
              });
              setYear("");
              setSelected(r.edition.id);
              setCreate(false);
            });
          }}
        >
          <label>
            Convention name
            <input
              required
              maxLength={200}
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Year
            <input
              type="number"
              min={2000}
              max={2200}
              required
              className={field}
              value={newYear}
              onChange={(e) => setNewYear(Number(e.target.value))}
            />
          </label>
          <button disabled={busy} className={button}>
            Create
          </button>
        </form>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : !detail ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {editions
            .filter((e) => !year || String(e.year) === year)
            .map((e) => (
              <button
                disabled={busy}
                className={`${box} text-left`}
                key={e.id}
                onClick={() => setSelected(e.id)}
              >
                <strong>
                  {e.convention} {e.year}
                </strong>
                <p>
                  {e.member_count} entries · {e.unresolved_count} need profile
                  links
                </p>
              </button>
            ))}
          {!editions.length && (
            <p>No convention lists yet. Add a convention year to begin.</p>
          )}
        </div>
      ) : (
        <>
          <section className={`${box} print:hidden`}>
            <h2 className="text-xl font-bold">
              {detail.edition.convention} {detail.edition.year}
            </h2>
            {detail.edition.summary && (
              <p className="mt-3 whitespace-pre-wrap">
                {detail.edition.summary}
              </p>
            )}
            {detail.edition.recommendation && (
              <p className="mt-3 whitespace-pre-wrap">
                {detail.edition.recommendation}
              </p>
            )}
            <p className="mt-2 text-sm">
              {detail.members.length} entries
              {detail.review
                ? detail.review.reviewed_revision === detail.edition.revision
                  ? " · Reviewed"
                  : " · Updated since review"
                : ""}
            </p>
            <details>
              <summary>Research sources</summary>
              <p className="whitespace-pre-wrap">
                {detail.edition.sources ||
                  "Sources are listed with each contact."}
              </p>
            </details>
          </section>
          {detail.edition.archived_at && (
            <p className={`${box} print:hidden`}>
              Archived year · History stays available.
            </p>
          )}
          {!boss && (
            <button
              className={`${button} print:hidden`}
              disabled={busy}
              onClick={() => setPlanEditing(!planEditing)}
            >
              Edit convention notes
            </button>
          )}
          {planEditing && !boss && (
            <PlanEditor
              key={detail.edition.id}
              edition={detail.edition}
              busy={busy}
              cancel={() => setPlanEditing(false)}
              save={(values) =>
                void act(async () => {
                  await request(`/${selected}`, "PATCH", {
                    revision: detail.edition.revision,
                    ...values,
                  });
                  setPlanEditing(false);
                  await reload();
                })
              }
            />
          )}
          <div className="flex flex-wrap gap-2 print:hidden">
            <input
              aria-label="Search contacts"
              placeholder="Search contacts and events"
              className={`${field} max-w-sm`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <select
              aria-label="Email group"
              className={`${field} max-w-xs`}
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All email groups</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label} (
                  {detail.members.filter((m) => m.data.group === key).length})
                </option>
              ))}
            </select>
            <div
              role="group"
              aria-label="Convention display"
              className="flex rounded-lg border p-1"
            >
              <button
                type="button"
                aria-pressed={view === "cards"}
                className={`${button} border-0 ${view === "cards" ? "bg-muted font-semibold" : ""}`}
                onClick={() => {
                  setView("cards");
                  setPage(0);
                }}
              >
                Cards
              </button>
              <button
                type="button"
                aria-pressed={view === "game"}
                className={`${button} border-0 ${view === "game" ? "bg-muted font-semibold" : ""}`}
                onClick={() => {
                  setView("game");
                  setPage(0);
                }}
              >
                Convention Game
              </button>
            </div>
          </div>
          {!boss && !detail.edition.archived_at && (
            <section className={`${box} print:hidden`}>
              <label>
                Import list (JSON)
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void act(async () => {
                      if (file.size > 2000000)
                        throw new Error("Choose a file smaller than 2 MB.");
                      const contents = JSON.parse(await file.text());
                      const rows = Array.isArray(contents)
                        ? contents
                        : contents.rows;
                      const p = await request<{
                        revision: number;
                        rows: { member: Data; match: unknown }[];
                      }>(`/${selected}/import-preview`, "POST", { rows });
                      setPreview({ ...p, mutationKey: crypto.randomUUID() });
                    });
                  }}
                />
              </label>
              {preview && (
                <div>
                  <p>
                    {preview.rows.length} entries ·{" "}
                    {preview.rows.filter((r) => r.match).length} profile matches
                    · {preview.rows.filter((r) => !r.match).length} need review
                  </p>
                  <details>
                    <summary>Review imported entries</summary>
                    {preview.rows.map((r) => (
                      <p key={r.member.sourceKey}>
                        {r.member.event} — {r.member.contact} —{" "}
                        {r.match ? "Profile match" : "Needs profile link"}
                      </p>
                    ))}
                  </details>
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() =>
                      void act(async () => {
                        await request(`/${selected}/import`, "POST", {
                          rows: preview.rows.map((r) => r.member),
                          revision: preview.revision,
                          mutationKey: preview.mutationKey,
                        });
                        setPreview(null);
                        await reload();
                      })
                    }
                  >
                    Apply import
                  </button>
                  <button className={button} onClick={() => setPreview(null)}>
                    Cancel
                  </button>
                </div>
              )}
              <button
                disabled={busy}
                className={`${button} mt-3`}
                onClick={() => setRollover(true)}
              >
                Start next year’s list
              </button>
              {rollover && (
                <div>
                  <p>
                    Carry {detail.members.length} entries into{" "}
                    {detail.edition.year + 1}. Prior history stays here.
                    New-year outreach and attendance start unconfirmed;
                    restrictions remain.
                  </p>
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() =>
                      void act(async () => {
                        const r = await request<{ edition: Edition }>(
                          `/${selected}/rollover`,
                          "POST",
                          { revision: detail.edition.revision },
                        );
                        setYear("");
                        setSelected(r.edition.id);
                        setRollover(false);
                      })
                    }
                  >
                    Create next year
                  </button>
                  <button className={button} onClick={() => setRollover(false)}>
                    Cancel
                  </button>
                </div>
              )}
            </section>
          )}
          <p className="text-sm print:hidden">
            {filtered.length} matching entries
          </p>
          {view === "game" ? (
            <ConventionGame
              boss={boss}
              edition={detail.edition}
              members={filtered}
              savedCard={savedCard}
              edit={(member) => {
                setGameError("");
                setConflictLatest(null);
                setGameEditing(member);
              }}
            />
          ) : (
            <>
              {filtered.slice(page * 25, (page + 1) * 25).map((m) => (
                <article key={m.id} className={box}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <h3 className="font-bold">{m.data.event}</h3>
                      <p>
                        {m.data.contact} {m.data.email}
                      </p>
                    </div>
                    <span>
                      {labels[m.data.group]} ·{" "}
                      {m.data.outcome.replaceAll("_", " ")}
                    </span>
                  </div>
                  {m.data.group === "replacement" && (
                    <p className="mt-2 font-semibold">
                      Replacement only. Adventure Zone does not operate beside
                      another inflatable provider.
                    </p>
                  )}
                  {m.data.group === "special" && (
                    <p className="mt-2 font-semibold">
                      Personal handling. Keep out of bulk email.
                    </p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap">{m.data.reason}</p>
                  <p className="whitespace-pre-wrap">{m.data.notes}</p>
                  {m.data.nextAction && (
                    <p className="mt-2">Next: {m.data.nextAction}</p>
                  )}
                  <p className="text-sm">
                    Past attendance evidence:{" "}
                    {m.data.attendance.replaceAll("_", " ")}
                  </p>
                  <details>
                    <summary>Sources</summary>
                    <p className="whitespace-pre-wrap">
                      {m.data.sources || "No source recorded"}
                    </p>
                  </details>
                  {m.data.research && (
                    <details>
                      <summary>Detailed research notes</summary>
                      <dl className="mt-2 grid gap-2">
                        {Object.entries(m.data.research)
                          .filter(([, value]) => value)
                          .map(([key, value]) => (
                            <div key={key}>
                              <dt className="font-semibold">{key}</dt>
                              <dd className="whitespace-pre-wrap">{value}</dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  )}
                  <div className="mt-3 flex gap-2">
                    {m.organization_id ? (
                      <Link
                        className={button}
                        href={`${boss ? "/boss" : ""}/profiles/${m.organization_id}`}
                      >
                        Open Profile
                      </Link>
                    ) : (
                      <span>Profile link needed</span>
                    )}
                    {!boss && !detail.edition.archived_at && (
                      <button
                        disabled={busy}
                        className={button}
                        onClick={() => setEditing(structuredClone(m))}
                      >
                        Edit notes / link profile
                      </button>
                    )}
                  </div>
                  {m.organization_id && (
                    <MemberContext member={m} boss={boss} />
                  )}
                </article>
              ))}
              <div className="flex gap-3">
                <button
                  className={button}
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page + 1} of{" "}
                  {Math.max(1, Math.ceil(filtered.length / 25))}
                </span>
                <button
                  className={button}
                  disabled={(page + 1) * 25 >= filtered.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
          <section className={`${box} print:hidden`}>
            <label>
              My review notes
              <textarea
                className={field}
                maxLength={12000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              className={button}
              onClick={() =>
                void act(async () => {
                  await request(`/${selected}/review`, "POST", {
                    revision: detail.edition.revision,
                    note,
                  });
                  await reload();
                })
              }
            >
              Save notes and mark reviewed
            </button>
          </section>
          <details className={`${box} print:hidden`}>
            <summary>List history</summary>
            {detail.history.map((h) => (
              <p key={h.id}>
                {new Date(h.occurred_at).toLocaleString()} —{" "}
                {h.kind.replaceAll("_", " ")}
              </p>
            ))}
          </details>
        </>
      )}
      {editing && !boss && (
        <MemberEditor
          member={editing}
          busy={busy}
          cancel={() => setEditing(null)}
          save={(m) =>
            void act(async () => {
              await request(`/${m.edition_id}/members/${m.id}`, "PATCH", {
                revision: m.revision,
                data: m.data,
                organizationId: m.organization_id,
                contactId: m.contact_id,
              });
              setEditing(null);
              await reload();
            })
          }
        />
      )}
      {gameEditing && (
        <ConventionCardEditor
          key={`${gameEditing.id}:${gameEditing.revision}`}
          member={gameEditing}
          busy={busy}
          error={gameError}
          latest={conflictLatest}
          cancel={() => setGameEditing(null)}
          reload={() => void refreshGameCard(gameEditing)}
          resolve={(response) => {
            if (!conflictLatest) return;
            setGameEditing({
              ...conflictLatest,
              data: { ...conflictLatest.data, conventionResponse: response },
            });
            setConflictLatest(null);
            setGameError("");
          }}
          save={(member) => void saveGameCard(member)}
        />
      )}
    </main>
  );
}
function ConventionGame({
  boss,
  edition,
  members,
  savedCard,
  edit,
}: {
  boss: boolean;
  edition: Edition;
  members: Member[];
  savedCard: string;
  edit: (member: Member) => void;
}) {
  return (
    <section
      className={`${box} overflow-x-auto print:overflow-visible print:border-0 print:p-0`}
    >
      <style>{`@media print { @page { size: landscape; margin: 0.35in; } }`}</style>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">
            {edition.convention} {edition.year} Convention Game
          </h2>
          <p className="text-sm text-muted-foreground print:text-black">
            {members.length} people and organizations from the live convention
            roster
          </p>
        </div>
        <button
          type="button"
          className={`${button} print:hidden`}
          onClick={() => window.print()}
        >
          Print Game Sheet
        </button>
      </div>
      <div className="grid gap-3 print:hidden sm:grid-cols-2">
        {members.map((member) => {
          const response = member.data.conventionResponse;
          return (
            <article
              key={member.id}
              className="rounded-xl border bg-background p-4"
            >
              <button
                type="button"
                className="w-full text-left"
                aria-label={`Fill out ${member.data.event} convention card`}
                onClick={() => edit(structuredClone(member))}
              >
                <span className="block text-lg font-bold">
                  {member.data.event}
                </span>
                <span className="block text-sm">
                  {member.data.contact || "No contact listed"}
                  {member.data.email ? ` · ${member.data.email}` : ""}
                </span>
                {response?.contact && (
                  <span className="mt-1 block text-sm font-semibold">
                    Spoke with {response.contact}
                  </span>
                )}
                <EventInformation member={member} className="mt-2" />
                <span className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span>{response?.met ? "✓ Met" : "○ Not met"}</span>
                  <span>
                    {response?.interested
                      ? "✓ Interested"
                      : "○ Interest unknown"}
                  </span>
                  <span>
                    {response?.followUp
                      ? "✓ Follow up"
                      : "○ No follow-up marked"}
                  </span>
                  {savedCard === member.id && <strong>Saved</strong>}
                </span>
              </button>
              <div className="mt-3 border-t pt-3 text-sm">
                {member.organization_id ? (
                  <Link
                    className="underline"
                    href={`${boss ? "/boss" : ""}/profiles/${member.organization_id}`}
                    aria-label={`Open ${member.data.event} profile`}
                  >
                    Open linked profile
                  </Link>
                ) : (
                  <span>Profile needed</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <table
        aria-label={`${edition.convention} ${edition.year} convention game`}
        className="hidden w-full min-w-[1100px] border-collapse text-left text-sm print:table print:min-w-0 print:text-[9px]"
      >
        <thead className="print:table-header-group">
          <tr className="bg-muted print:bg-transparent">
            <th className="border p-2">Event / profile</th>
            <th className="border p-2">Contact</th>
            <th className="border p-2">Event info</th>
            <th className="border p-2 text-center">Met</th>
            <th className="border p-2 text-center">Interested</th>
            <th className="border p-2 text-center">Follow up</th>
            <th className="w-[38%] border p-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="break-inside-avoid align-top">
              <td className="border p-2">
                <strong>{member.data.event}</strong>
              </td>
              <td className="border p-2">
                <strong className="block">{member.data.contact || "—"}</strong>
                <span className="break-all">{member.data.email || "—"}</span>
                {member.data.conventionResponse?.contact && (
                  <span className="mt-1 block">
                    Spoke with: {member.data.conventionResponse.contact}
                  </span>
                )}
              </td>
              <td className="border p-2">
                <EventInformation member={member} />
                <span className="mt-1 block text-xs">
                  Past attendance: {member.data.attendance.replaceAll("_", " ")}
                </span>
              </td>
              <td
                className="border p-2 text-center text-lg"
                aria-label={`Met ${member.data.event}`}
              >
                {member.data.conventionResponse?.met ? "☑" : "☐"}
              </td>
              <td
                className="border p-2 text-center text-lg"
                aria-label={`Interested ${member.data.event}`}
              >
                {member.data.conventionResponse?.interested ? "☑" : "☐"}
              </td>
              <td
                className="border p-2 text-center text-lg"
                aria-label={`Follow up ${member.data.event}`}
              >
                {member.data.conventionResponse?.followUp ? "☑" : "☐"}
              </td>
              <td className="border p-2">
                {member.data.conventionResponse?.notes || (
                  <span className="block min-h-24 border-b border-dashed" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!members.length && (
        <p className="py-6 text-center">No roster entries match these filters.</p>
      )}
    </section>
  );
}

const eventTypeLabels: Record<string, string> = {
  fair: "Fair",
  city_government: "City event",
  festival_event: "Festival / event",
  venue: "Venue",
  school: "School event",
  tribe: "Tribal event",
  association: "Association event",
  company: "Company event",
  other: "Other event",
};

function eventDateRange(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt) return "Event dates not in profile";
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "Event dates not in profile";
  const short = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const full = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (!endsAt) return full.format(start);
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return full.format(start);
  if (start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10))
    return full.format(start);
  return `${short.format(start)}–${full.format(end)}`;
}

function factualResearch(member: Member) {
  const entries = Object.entries(member.data.research || {});
  const useful = entries.find(([key, value]) => {
    const normalized = key.toLowerCase();
    return Boolean(value.trim()) &&
      /(event info|event detail|about|audience|attendance|size|hours|schedule)/.test(normalized) &&
      !/(contact|email|phone|source|outreach|next|recommend|offer|reason)/.test(normalized);
  });
  if (!useful) return null;
  const value = useful[1].trim();
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function eventInformation(member: Member) {
  const info = member.event_info;
  const location = [info?.city, info?.region].filter(Boolean).join(", ");
  const type = info?.placeType
    ? eventTypeLabels[info.placeType] || info.placeType.replaceAll("_", " ")
    : "Event type not in profile";
  return [
    location || "Location not in profile",
    eventDateRange(info?.startsAt, info?.endsAt),
    type,
    factualResearch(member),
  ].filter((value): value is string => Boolean(value));
}

function EventInformation({ member, className = "" }: { member: Member; className?: string }) {
  return (
    <span className={`${className} block text-sm text-muted-foreground`}>
      {eventInformation(member).map((line) => (
        <span className="block" key={line}>{line}</span>
      ))}
    </span>
  );
}

function ConventionCardEditor({
  member,
  busy,
  error,
  latest,
  cancel,
  reload,
  resolve,
  save,
}: {
  member: Member;
  busy: boolean;
  error: string;
  latest: Member | null;
  cancel: () => void;
  reload: () => void;
  resolve: (response: NonNullable<Data["conventionResponse"]>) => void;
  save: (member: Member) => void;
}) {
  const empty = {
    met: false,
    interested: false,
    followUp: false,
    contact: member.data.contact || "",
    notes: "",
  };
  const [response, setResponse] = useState(
    member.data.conventionResponse || empty,
  );
  const toggle = (key: "met" | "interested" | "followUp") =>
    setResponse({ ...response, [key]: !response[key] });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${member.data.event} convention card`}
      className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4 print:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) cancel();
      }}
    >
      <form
        className="mx-auto grid max-w-xl gap-4 rounded-xl bg-background p-5"
        onSubmit={(event) => {
          event.preventDefault();
          save({
            ...member,
            data: { ...member.data, conventionResponse: response },
          });
        }}
      >
        <div>
          <h2 className="text-xl font-bold">{member.data.event}</h2>
          <EventInformation member={member} className="mt-1" />
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-destructive"
          >
            <p>{error}</p>
            {error.includes("changed") && !latest && (
              <button
                type="button"
                className={`${button} mt-2`}
                disabled={busy}
                onClick={reload}
              >
                Reload current card
              </button>
            )}
          </div>
        )}
        {latest && (
          <section className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-slate-950">
            <h3 className="font-bold">Latest saved version</h3>
            <p>
              {latest.data.conventionResponse?.met ? "Met" : "Not met"} ·{" "}
              {latest.data.conventionResponse?.interested
                ? "Interested"
                : "Interest not marked"}{" "}
              ·{" "}
              {latest.data.conventionResponse?.followUp
                ? "Follow-up needed"
                : "No follow-up marked"}
            </p>
            {latest.data.conventionResponse?.contact && (
              <p>Spoke with {latest.data.conventionResponse.contact}</p>
            )}
            {latest.data.conventionResponse?.notes && (
              <p className="whitespace-pre-wrap">
                {latest.data.conventionResponse.notes}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={button}
                onClick={() =>
                  resolve(
                    latest.data.conventionResponse || {
                      met: false,
                      interested: false,
                      followUp: false,
                      contact: "",
                      notes: "",
                    },
                  )
                }
              >
                Use latest saved answers
              </button>
              <button
                type="button"
                className={button}
                onClick={() => resolve(response)}
              >
                Keep my answers and retry
              </button>
            </div>
          </section>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["met", "Met at convention"],
            ["interested", "Interested"],
            ["followUp", "Follow-up needed"],
          ] as const).map(([key, label]) => (
            <label
              key={key}
              className="flex min-h-12 items-center gap-2 rounded-lg border p-3"
            >
              <input
                autoFocus={key === "met"}
                type="checkbox"
                checked={response[key]}
                onChange={() => toggle(key)}
              />
              {label}
            </label>
          ))}
        </div>
        <label>
          Person spoken to
          <input
            className={field}
            maxLength={500}
            value={response.contact}
            onChange={(event) =>
              setResponse({ ...response, contact: event.target.value })
            }
          />
        </label>
        <label>
          Convention notes
          <textarea
            className={field}
            rows={8}
            maxLength={12000}
            value={response.notes}
            onChange={(event) =>
              setResponse({ ...response, notes: event.target.value })
            }
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy}>
            Save convention card
          </button>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
function MemberEditor({
  member,
  busy,
  cancel,
  save,
}: {
  member: Member;
  busy: boolean;
  cancel: () => void;
  save: (m: Member) => void;
}) {
  const [m, set] = useState(member),
    [q, setQ] = useState(member.data.event),
    [matches, setMatches] = useState<
      {
        organizationId: string;
        contactId: string | null;
        name: string;
        contact: string;
        email: string;
      }[]
    >([]),
    [error, setError] = useState("");
  const searchSequence = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const change = (
    key: "group" | "outcome" | "notes" | "reason" | "sources" | "nextAction",
    value: string,
  ) =>
    set({ ...m, data: { ...m.data, [key]: value } });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit convention contact"
      className="fixed inset-0 z-50 overflow-auto bg-black/50 p-4"
    >
      <form
        className="mx-auto grid max-w-xl gap-3 rounded-xl bg-background p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save(m);
        }}
      >
        <h2 className="text-xl font-bold">{m.data.event}</h2>
        <label>
          Email group
          <select
            className={field}
            value={m.data.group}
            onChange={(e) => change("group", e.target.value)}
          >
            {Object.entries(labels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Outcome
          <select
            className={field}
            value={m.data.outcome}
            onChange={(e) => change("outcome", e.target.value)}
          >
            {outcomes.map((o) => (
              <option key={o} value={o}>
                {o.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        {(["notes", "reason", "sources", "nextAction"] as const).map((k) => (
          <label key={k}>
            {k === "nextAction" ? "Next action" : k}
            <textarea
              maxLength={12000}
              className={field}
              value={m.data[k]}
              onChange={(e) => change(k, e.target.value)}
            />
          </label>
        ))}
        <label>
          Find profile
          <input
            ref={searchInput}
            className={field}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          className={button}
          type="button"
          onClick={() => {
            const sequence = ++searchSequence.current;
            const query = searchInput.current?.value ?? q;
            setError("");
            void conventionRequest<{ profiles: typeof matches }>(
              false,
              `/profile-search?q=${encodeURIComponent(query)}`,
            )
              .then((r) => {
                if (sequence === searchSequence.current) {
                  setMatches(r.profiles);
                }
              })
              .catch((e) => {
                if (sequence === searchSequence.current) {
                  setError(e.message);
                }
              });
          }}
        >
          Search profiles
        </button>
        {error && <p role="alert">{error}</p>}
        {matches.map((p) => (
          <button
            className={`${button} text-left`}
            type="button"
            key={`${p.organizationId}:${p.contactId}`}
            onClick={() => {
              set({
                ...m,
                organization_id: p.organizationId,
                contact_id: p.contactId,
              });
              setMatches([]);
              setQ(`${p.name} — ${p.contact || p.email || "Event profile"}`);
            }}
          >
            {p.name} — {p.contact} {p.email}
          </button>
        ))}
        <p>{m.organization_id ? "Profile linked" : "Profile link needed"}</p>
        <div className="flex gap-2">
          <button className={button} disabled={busy}>
            Save
          </button>
          <button
            className={button}
            type="button"
            disabled={busy}
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
type Context = {
  activities: {
    id: string;
    subject: string;
    body: string;
    occurred_at: string;
  }[];
  promotions: {
    id: string;
    event_year: number;
    status: string;
    deadline_date: string;
    interest_confirmed_at: string | null;
    deposit_received_at: string | null;
    reminder_draft_id: string | null;
  }[];
  followUps: {
    id: string;
    kind: string;
    due_at: string;
    completed_at: string | null;
  }[];
  submissions: {
    id: string;
    payload: { notes?: string; nextStep?: string };
    created_at: string;
  }[];
};
function MemberContext({ member, boss }: { member: Member; boss: boolean }) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<Context | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError("");
    setData(null);
    conventionRequest<Context>(
      boss,
      `/${member.edition_id}/members/${member.id}/context`,
    )
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [open, version, member.id, member.organization_id, boss]);
  return (
    <div className="mt-3">
      <button className={button} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "View"} profile history and discounts
      </button>
      {open && (
        <div className="mt-3 grid gap-3 border-t pt-3">
          <p className="text-sm">
            Profile history across all years. These records are not
            automatically attributed to this convention.
          </p>
          <button className={button} onClick={() => setVersion(version + 1)}>
            Refresh history
          </button>
          {error && <p role="alert">{error}</p>}
          {!data && !error && <p>Loading history…</p>}
          {data && (
            <>
              <h4 className="font-bold">Early Bird offers</h4>
              {data.promotions.length ? (
                data.promotions.map((p) => (
                  <div key={p.id}>
                    <p>
                      {p.event_year} · 10% Early Bird · {p.status}
                    </p>
                    <p>
                      Original deadline: {String(p.deadline_date).slice(0, 10)}
                    </p>
                    <p>
                      {p.interest_confirmed_at
                        ? "Interest confirmed"
                        : "Interest not confirmed"}{" "}
                      ·{" "}
                      {p.deposit_received_at
                        ? "Deposit received"
                        : "Deposit not recorded"}
                      {p.reminder_draft_id
                        ? " · Reminder prepared for review"
                        : ""}
                    </p>
                  </div>
                ))
              ) : (
                <p>No Early Bird offer recorded.</p>
              )}
              <h4 className="font-bold">Follow-ups</h4>
              {data.followUps.map((f) => (
                <p key={f.id}>
                  {new Date(f.due_at).toLocaleDateString()} ·{" "}
                  {f.kind.replaceAll("_", " ")} ·{" "}
                  {f.completed_at ? "Completed" : "Open"}
                </p>
              ))}
              <h4 className="font-bold">Applied convention notes</h4>
              {data.submissions.map((s) => (
                <p key={s.id} className="whitespace-pre-wrap">
                  {new Date(s.created_at).toLocaleDateString()} ·{" "}
                  {s.payload.notes ||
                    s.payload.nextStep ||
                    "Convention conversation saved"}
                </p>
              ))}
              <h4 className="font-bold">Recent profile activity</h4>
              {data.activities.map((a) => (
                <details key={a.id}>
                  <summary>
                    {a.occurred_at
                      ? new Date(a.occurred_at).toLocaleDateString()
                      : "Date not recorded"}{" "}
                    · {a.subject || "Activity"}
                  </summary>
                  <p className="whitespace-pre-wrap">{a.body}</p>
                </details>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PlanEditor({
  edition,
  busy,
  cancel,
  save,
}: {
  edition: Edition;
  busy: boolean;
  cancel: () => void;
  save: (values: {
    summary: string;
    recommendation: string;
    sources: string;
    archived: boolean;
  }) => void;
}) {
  const [values, setValues] = useState({
    summary: edition.summary,
    recommendation: edition.recommendation,
    sources: edition.sources,
    archived: Boolean(edition.archived_at),
  });
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        save(values);
      }}
    >
      {(
        [
          ["summary", "What I found"],
          ["recommendation", "What I think"],
          ["sources", "Research sources"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="mb-3 block">
          {label}
          <textarea
            className={field}
            maxLength={12000}
            value={values[key]}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          />
        </label>
      ))}
      <label className="mb-3 block">
        <input
          type="checkbox"
          checked={values.archived}
          onChange={(e) => setValues({ ...values, archived: e.target.checked })}
        />{" "}
        Archive this year and keep its history
      </label>
      <button className={button} disabled={busy}>
        Save convention notes
      </button>{" "}
      <button className={button} type="button" disabled={busy} onClick={cancel}>
        Cancel
      </button>
    </form>
  );
}
