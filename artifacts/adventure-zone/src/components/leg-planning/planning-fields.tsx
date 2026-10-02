import type { ReactNode } from "react";
import type { WindowInput, PlanningRead } from "@workspace/api-zod";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
export const inputClass =
  "min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
export function emptyWindow(): WindowInput {
  return {
    startsAt: null,
    endsAt: null,
    semantics: "timestamp",
    source: "Recorded operational plan",
  };
}
export function WindowFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: WindowInput | null;
  onChange: (v: WindowInput) => void;
}) {
  const v = value ?? emptyWindow();
  return (
    <fieldset className="grid min-w-0 gap-2 rounded-lg border p-3">
      <legend className="font-semibold">{label}</legend>
      <Field label={`${label} date meaning`}>
        <select
          className={inputClass}
          value={v.semantics}
          onChange={(e) =>
            onChange({
              ...v,
              semantics: e.target.value as WindowInput["semantics"],
            })
          }
        >
          <option value="timestamp">Exact times with UTC offset</option>
          <option value="inclusive_date">
            Mountain dates, last day included
          </option>
          <option value="exclusive_date">
            Mountain dates, end day excluded
          </option>
        </select>
      </Field>
      <Field label={`${label} start`}>
        <input
          className={inputClass}
          placeholder={
            v.semantics === "timestamp"
              ? "2027-07-04T08:00:00-06:00"
              : "2027-07-04"
          }
          value={v.startsAt ?? ""}
          onChange={(e) => onChange({ ...v, startsAt: e.target.value || null })}
        />
      </Field>
      <Field label={`${label} end`}>
        <input
          className={inputClass}
          value={v.endsAt ?? ""}
          onChange={(e) => onChange({ ...v, endsAt: e.target.value || null })}
        />
      </Field>
      <Field label={`${label} source`}>
        <input
          className={inputClass}
          value={v.source}
          onChange={(e) => onChange({ ...v, source: e.target.value })}
        />
      </Field>
    </fieldset>
  );
}
export function Readiness({ read }: { read: PlanningRead }) {
  return (
    <div className="grid gap-2 rounded-xl border bg-slate-50 p-3">
      <p className="font-bold">
        Readiness: {read.readiness.overall.replaceAll("_", " ")}
      </p>
      <p className="text-xs text-slate-600">
        Checked {new Date(read.readiness.evaluatedAt).toLocaleString()}
      </p>
      {Object.entries(read.readiness.dimensions).map(([name, d]) => (
        <div key={name}>
          <p className="text-sm font-semibold">
            {name.replaceAll("_", " ")} · {d.state.replaceAll("_", " ")}
          </p>
          {d.reasons.map((r, i) => (
            <p className="text-sm" key={`${r.code}-${i}`}>
              {r.message}{" "}
              <a className="underline" href={r.href ?? undefined}>
                Review
              </a>
            </p>
          ))}
        </div>
      ))}
      <p className="text-xs text-slate-600">
        Drafts reserve nothing. Readiness is separate from customer
        confirmation.
      </p>
    </div>
  );
}
export function Choices({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="grid min-w-0 gap-2 rounded-lg border p-3">
      <legend className="font-semibold">{label}</legend>
      {items.length ? (
        items.map((i) => (
          <label key={i.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(i.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, i.id]
                    : selected.filter((id) => id !== i.id),
                )
              }
            />
            <span className="break-words">{i.name}</span>
          </label>
        ))
      ) : (
        <p className="text-sm text-slate-600">No recorded items available.</p>
      )}
    </fieldset>
  );
}
