import { useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { profileSelection } from "@/features/assistant-workspace/profile-scope";
import type { Selection } from "@/features/assistant-workspace/types";
export function WorkspaceScopePicker({
  scope,
  initialLabel,
  initialProfileId,
  disabled,
  onChange,
}: {
  scope?: Selection;
  initialLabel?: string;
  initialProfileId?: string;
  disabled: boolean;
  onChange(scope: Selection): void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const ids = scope?.organizationIds ?? [];
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setRows([]);
      return;
    }
    let live = true;
    setRows([]);
    setError("");
    const timer = setTimeout(() => {
      void apiGet<any>(
        `/organizations?q=${encodeURIComponent(query.trim())}&pageSize=20`,
      )
        .then((data) => {
          if (live) setRows(data.organizations?.records ?? data.records ?? []);
        })
        .catch(() => {
          if (live) setError("Could not find profiles. Try again.");
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, query]);
  const label = ids.length
    ? ids
        .map(
          (id) =>
            names[id] ??
            (id === initialProfileId ? initialLabel : undefined) ??
            `Profile ${id.slice(0, 8)}`,
        )
        .join(", ")
    : "General workspace";
  return (
    <section className="mb-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Working with: {label}</p>
        <button
          type="button"
          disabled={disabled}
          className="button-secondary"
          onClick={() => setOpen((value) => !value)}
        >
          Change profiles
        </button>
      </div>
      {open ? (
        <fieldset disabled={disabled} className="mt-3 grid gap-2">
          <button
            type="button"
            className="button-secondary justify-self-start"
            onClick={() => {
              onChange(profileSelection());
              setOpen(false);
            }}
          >
            Use general workspace
          </button>
          <label className="grid gap-1 text-sm">
            Find profiles
            <input
              className="rounded border p-2 text-base"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name"
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          {rows.map((row) => (
            <label className="flex gap-2 p-2 text-sm" key={row.id}>
              <input
                type="checkbox"
                checked={ids.includes(row.id)}
                onChange={(event) => {
                  const selected = event.target.checked
                    ? [...ids, row.id]
                    : ids.filter((id) => id !== row.id);
                  if (selected.length > 100) return;
                  setNames((value) => ({ ...value, [row.id]: row.name }));
                  onChange({
                    ...profileSelection(),
                    organizationIds: selected,
                  });
                }}
              />
              {row.name}
            </label>
          ))}
          <button
            type="button"
            className="button-primary justify-self-start"
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </fieldset>
      ) : null}
    </section>
  );
}
