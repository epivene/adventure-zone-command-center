import { useState } from "react";
import { connectionButton } from "./client";

export function MergePreview({
  proposal: p,
  disabled,
  approve,
}: {
  proposal: any;
  disabled: boolean;
  approve: (body: { contentHash: string; confirmedSameEvent: boolean }) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const c = p.content;
  return (
    <section className="grid gap-3 rounded border p-3">
      <h4 className="font-semibold">Merge duplicate profiles</h4>
      <p>
        Keep:{" "}
        <a className="underline" href={`/profiles/${c.primary.id}`}>
          {c.primary.name}
        </a>
      </p>
      <p>
        Move linked records from these profiles, then remove the duplicates:
      </p>
      <ul>
        {c.duplicates.map((d: any) => (
          <li key={d.id}>
            <a className="underline" href={`/profiles/${d.id}`}>
              {d.name}
            </a>{" "}
            —{" "}
            {[d.city, d.region].filter(Boolean).join(", ") ||
              "Location unknown"}
          </li>
        ))}
      </ul>
      <p>{c.reason}</p>
      <p>{c.policy}</p>
      {c.conflicts.length > 0 && (
        <div className="grid gap-2">
          <h5 className="font-semibold">Field differences</h5>
          <p>
            The kept profile’s values stay unchanged. Other values are saved in
            merge history.
          </p>
          {c.conflicts.map((f: any, i: number) => (
            <p className="break-words" key={i}>
              {f.field}: keep {String(f.primaryValue ?? "(empty)")}; from{" "}
              {c.duplicates.find((d: any) => d.id === f.duplicateId)?.name}:{" "}
              {String(f.duplicateValue)}
            </p>
          ))}
        </div>
      )}
      <details>
        <summary>Linked record counts across selected profiles</summary>
        <ul>
          {c.references
            .filter((r: any) => r.count > 0)
            .map((r: any) => (
              <li key={r.table}>
                {r.table.replaceAll("_", " ")}: {r.count}
              </li>
            ))}
        </ul>
      </details>
      <details>
        <summary>Original profile fields preserved in history</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify([c.primary, ...c.duplicates], null, 2)}
        </pre>
      </details>
      {c.blockers.map((b: string) => (
        <p role="alert" key={b}>
          {b}
        </p>
      ))}
      {!p.consumed_at && !p.approved_at && (
        <>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={disabled || c.blockers.length > 0}
            />
            I verified these profiles represent the same event or organization
            and reviewed the differences.
          </label>
          <button
            className={connectionButton}
            disabled={disabled || !confirmed || c.blockers.length > 0}
            onClick={() =>
              approve({
                contentHash: p.content_hash,
                confirmedSameEvent: confirmed,
              })
            }
          >
            Approve this exact merge
          </button>
        </>
      )}
    </section>
  );
}
