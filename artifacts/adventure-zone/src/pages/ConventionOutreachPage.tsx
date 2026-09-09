import { useEffect, useState } from "react";
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
};
type Member = {
  id: string;
  edition_id: string;
  organization_id: string | null;
  contact_id: string | null;
  revision: number;
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
  const [editions, setEditions] = useState<Edition[]>([]),
    [selected, setSelected] = useState(
      new URLSearchParams(search).get("edition") || "",
    );
  const [year, setYear] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState(""),
    [page, setPage] = useState(0);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [note, setNote] = useState("");
  const [planEditing, setPlanEditing] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null),
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
  const filtered =
    detail?.members.filter(
      (m) =>
        (!group || m.data.group === group) &&
        `${m.data.event} ${m.data.contact} ${m.data.email} ${m.data.notes}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
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
      <div className="flex flex-wrap gap-2">
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
          <section className={box}>
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
            <p className={box}>Archived year · History stays available.</p>
          )}
          {!boss && (
            <button
              className={button}
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
          <div className="flex flex-wrap gap-2">
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
          </div>
          {!boss && !detail.edition.archived_at && (
            <section className={box}>
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
          <p className="text-sm">{filtered.length} matching entries</p>
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
                  {labels[m.data.group]} · {m.data.outcome.replaceAll("_", " ")}
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
              {m.organization_id && <MemberContext member={m} boss={boss} />}
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
              Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}
            </span>
            <button
              className={button}
              disabled={(page + 1) * 25 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
          <section className={box}>
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
          <details className={box}>
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
    </main>
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
  const change = (key: keyof Data, value: string) =>
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
            className={field}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          className={button}
          type="button"
          onClick={() => {
            setError("");
            void conventionRequest<{ profiles: typeof matches }>(
              false,
              `/profile-search?q=${encodeURIComponent(q)}`,
            )
              .then((r) => setMatches(r.profiles))
              .catch((e) => setError(e.message));
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
