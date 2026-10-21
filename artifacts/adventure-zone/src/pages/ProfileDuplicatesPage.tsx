import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { apiGet, apiPost } from "@/lib/auth-token";

type Profile = {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
  [key: string]: any;
};
type Pair = {
  left: Profile;
  right: Profile;
  score: number;
  confidence: string;
  reasons: string[];
};
type Comparison = {
  profiles: Profile[];
  fingerprint: string;
  tables: {
    table: string;
    columns: string[];
    json: boolean;
    rows: Record<string, any>[];
  }[];
};
const display = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "Not set"
    : typeof v === "object"
      ? JSON.stringify(v, null, 2)
      : String(v);
const pairKey = (p: Pair) => [p.left.id, p.right.id].sort().join(":");
const selectable = [
  "name",
  "city",
  "region",
  "phone",
  "website",
  "address_1",
  "address_2",
  "postal_code",
  "place_type",
];

export default function ProfileDuplicatesPage() {
  const search = useSearch();
  const [pairs, setPairs] = useState<Pair[]>([]),
    [scanned, setScanned] = useState(0);
  const [history, setHistory] = useState<any[]>([]),
    [filter, setFilter] = useState("All");
  const [skipped, setSkipped] = useState<string[]>([]),
    [comparison, setComparison] = useState<Comparison | null>(null);
  const [survivor, setSurvivor] = useState(""),
    [choices, setChoices] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyError, setHistoryError] = useState("");
  async function refresh() {
    setHistoryError("");
    // History availability must not discard a successful read-only scan.
    await Promise.all([
      apiGet<{ pairs: Pair[]; scanned: number }>("/profile-duplicates")
        .then((data) => {
          setPairs(data.pairs);
          setScanned(data.scanned);
        })
        .catch((e: unknown) => {
          throw new Error(
            "Duplicate scan could not be loaded: " +
              (e instanceof Error ? e.message : "Connection failed") +
              ". Use Scan again to retry.",
          );
        }),
      apiGet<any[]>("/profile-duplicates/history")
        .then(setHistory)
        .catch((e: unknown) => {
          setHistoryError(
            "Merge history could not be loaded: " +
              (e instanceof Error ? e.message : "Connection failed") +
              ". Use Scan again to retry.",
          );
        }),
    ]);
  }
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e: any) {
      setError(e.message ?? "Unable to complete duplicate review.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void perform(refresh);
  }, []);
  async function compare(ids: string[]) {
    await perform(async () => {
      const value = await apiPost<Comparison>("/profile-duplicates/compare", {
        ids,
      });
      setComparison(value);
      setSurvivor(ids[0]);
      setChoices({});
      setConfirmed(false);
    });
  }
  useEffect(() => {
    const params = new URLSearchParams(search),
      a = params.get("left"),
      b = params.get("right");
    if (a && b) void compare([a, b]);
  }, [search]);
  async function dismiss(p: Pair) {
    await perform(async () => {
      await apiPost("/profile-duplicates/dismiss", {
        ids: [p.left.id, p.right.id],
      });
      setPairs((all) => all.filter((other) => pairKey(other) !== pairKey(p)));
      setComparison(null);
    });
  }
  const visible = pairs.filter(
    (p) =>
      (filter === "All" || p.confidence === filter) &&
      !skipped.includes(pairKey(p)),
  );
  const left = comparison?.profiles[0],
    right = comparison?.profiles[1];
  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Find duplicate profiles</h1>
          <p className="mt-2 text-muted-foreground">
            Read-only suggestions. Similar names do not prove two events are the
            same.
          </p>
        </div>
        <Link className="button-secondary" href="/profiles">
          Back to profiles
        </Link>
      </header>
      {error && (
        <p role="alert" className="rounded-xl border border-destructive p-4">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-primary bg-card p-4"
        >
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Confidence{" "}
          <select
            className="rounded border bg-card p-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {["All", "High", "Medium", "Low"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <span>
          {scanned} profiles scanned � {visible.length} suggestions
        </span>
        <button
          className="button-secondary"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              setSkipped([]);
              await refresh();
            })
          }
        >
          Scan again
        </button>
      </div>
      {busy && <p role="status">Working.</p>}
      {!busy && !error && !visible.length && (
        <p>
          No suggestions in this filter. Skipped pairs return on the next scan.
        </p>
      )}
      {visible.map((p) => (
        <article
          key={pairKey(p)}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h2 className="font-bold">
                {p.left.name} / {p.right.name}
              </h2>
              <p>
                {p.confidence} � {p.score}/100
              </p>
              <p className="text-sm text-muted-foreground">
                {p.reasons.join(" � ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="button-primary"
                disabled={busy}
                onClick={() => void compare([p.left.id, p.right.id])}
              >
                Compare / Merge
              </button>
              <button
                className="button-secondary"
                disabled={busy}
                onClick={() => void dismiss(p)}
              >
                Not duplicates
              </button>
              <button
                className="button-secondary"
                onClick={() => setSkipped((s) => [...s, pairKey(p)])}
              >
                Skip for now
              </button>
            </div>
          </div>
        </article>
      ))}
      {comparison && left && right && (
        <section
          aria-label="Side-by-side profile comparison"
          className="rounded-xl border-2 border-primary bg-card p-4"
        >
          <div className="flex justify-between gap-3">
            <h2 className="text-xl font-bold">Compare every saved field</h2>
            <button
              className="button-secondary"
              onClick={() => setComparison(null)}
            >
              Close comparison
            </button>
          </div>
          <fieldset className="my-4">
            <legend className="font-bold">Profile to keep</legend>
            {comparison.profiles.map((p) => (
              <label className="mr-5 inline-flex gap-2" key={p.id}>
                <input
                  type="radio"
                  name="survivor"
                  checked={survivor === p.id}
                  onChange={() => {
                    setSurvivor(p.id);
                    setChoices({});
                    setConfirmed(false);
                  }}
                />
                {p.name}
              </label>
            ))}
          </fieldset>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Field</th>
                  <th className="p-2">
                    <Link href={`/profiles/${left.id}`}>{left.name}</Link>
                  </th>
                  <th className="p-2">
                    <Link href={`/profiles/${right.id}`}>{right.name}</Link>
                  </th>
                  <th className="p-2">Use value from</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(left).map((field) => (
                  <tr
                    className={
                      display(left[field]) !== display(right[field])
                        ? "border-t border-border bg-primary/10"
                        : "border-t border-border"
                    }
                    key={field}
                  >
                    <th className="p-2 align-top">
                      {field.replaceAll("_", " ")}
                    </th>
                    <td className="max-w-sm whitespace-pre-wrap break-words p-2 align-top">
                      {display(left[field])}
                    </td>
                    <td className="max-w-sm whitespace-pre-wrap break-words p-2 align-top">
                      {display(right[field])}
                    </td>
                    <td className="p-2">
                      {selectable.includes(field) ? (
                        <select
                          aria-label={`Use ${field} from`}
                          className="max-w-48 rounded border bg-card p-2"
                          value={choices[field] ?? survivor}
                          onChange={(e) =>
                            setChoices((c) => ({
                              ...c,
                              [field]: e.target.value,
                            }))
                          }
                        >
                          {comparison.profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        "Preserved in history"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="my-4 block">
            Primary contact preference{" "}
            <select
              className="ml-2 max-w-sm rounded border bg-card p-2"
              value={choices.contacts ?? survivor}
              onChange={(e) =>
                setChoices((c) => ({ ...c, contacts: e.target.value }))
              }
            >
              {comparison.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm">
            All contacts are retained. Conflicting profile values remain in the
            audit record. Linked-record conflicts stop the merge without
            changing either profile.
          </p>
          {comparison.tables
            .filter((t) => t.rows.length)
            .map((t) => (
              <details
                className="my-3 rounded border border-border p-3"
                key={t.table}
              >
                <summary className="cursor-pointer font-bold">
                  {t.table.replaceAll("_", " ")} ({t.rows.length})
                </summary>
                <div className="grid gap-3 md:grid-cols-2">
                  {[left, right].map((p) => (
                    <div key={p.id}>
                      <h3 className="my-2 font-bold">{p.name}</h3>
                      {t.rows
                        .filter((r) =>
                          t.json
                            ? r.content?.organizationId === p.id
                            : t.columns.some((c) => r[c] === p.id) ||
                              (t.table === "contacts" &&
                                comparison.tables
                                  .find(
                                    (item) =>
                                      item.table === "organization_contacts",
                                  )
                                  ?.rows.some(
                                    (m) =>
                                      m.organization_id === p.id &&
                                      m.contact_id === r.id,
                                  )),
                        )
                        .map((r, i) => (
                          <pre
                            className="mb-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2 text-xs"
                            key={i}
                          >
                            {JSON.stringify(r, null, 2)}
                          </pre>
                        ))}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          <label className="my-4 flex gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed these records and confirm they are the same event or
            organization.
          </label>
          <button
            className="button-primary"
            disabled={busy || !confirmed}
            onClick={() =>
              void perform(async () => {
                const result = await apiPost<any>("/profile-duplicates/merge", {
                  survivorId: survivor,
                  sourceId: comparison.profiles.find((p) => p.id !== survivor)!
                    .id,
                  fingerprint: comparison.fingerprint,
                  choices: {
                    ...Object.fromEntries(
                      [...selectable, "contacts"].map((k) => [k, survivor]),
                    ),
                    ...choices,
                  },
                  confirmed,
                });
                setComparison(null);
                setNotice(
                  `Merge saved. The original is archived. ${result.conflicts.length} field or membership differences are preserved in merge history.`,
                );
                await refresh();
              })
            }
          >
            Merge and archive duplicate
          </button>
        </section>
      )}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-xl font-bold">Merge history and undo</h2>
        {historyError ? (
          <p role="alert" className="mt-2 text-destructive">
            {historyError}
          </p>
        ) : null}
        <p className="mt-2 text-sm">
          Original snapshots are kept without a time limit. Undo never
          overwrites newer work silently.
        </p>
        {history.map((h) => (
          <details className="mt-3 rounded border border-border p-3" key={h.id}>
            <summary className="cursor-pointer">
              {new Date(h.created_at).toLocaleString()} �{" "}
              {h.undone_at ? "Undone" : "Merged"}
            </summary>
            <p className="my-2">
              <Link href={`/profiles/${h.survivor_id}`}>
                Open surviving profile
              </Link>
            </p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(
                { fieldChoices: h.choices, preservedDifferences: h.conflicts },
                null,
                2,
              )}
            </pre>
            {!h.undone_at && (
              <button
                className="button-secondary mt-3"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await apiPost("/profile-duplicates/undo", { id: h.id });
                    setNotice("Merge undone. Both profiles restored.");
                    setComparison(null);
                    await refresh();
                  })
                }
              >
                Undo merge
              </button>
            )}
          </details>
        ))}
      </section>
    </div>
  );
}
