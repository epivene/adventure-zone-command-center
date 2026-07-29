"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { ResourceWarning } from "@/features/resources/resource-types";

type ActionResult = { ok: true } | { ok: false; error: string };

export function ResourceWarningList({
  bookingId,
  warnings,
  acknowledge,
}: {
  bookingId: string;
  warnings: ResourceWarning[];
  acknowledge: (input: {
    bookingId: string;
    conflictKey: string;
    reason: string;
  }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function showError(message: string) {
    setError(message);
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
    warning: ResourceWarning,
  ) {
    event.preventDefault();
    if (pendingKey) return;
    setPendingKey(warning.conflictKey);
    setError("");
    try {
      const result = await acknowledge({
        bookingId,
        conflictKey: warning.conflictKey,
        reason: reasons[warning.conflictKey] ?? "",
      });
      if (!result.ok) showError(result.error);
      else router.refresh();
    } catch {
      showError("Could not override this conflict. Please try again.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
      id="resource-warnings"
    >
      <h2 className="text-xl font-bold">Resource warnings</h2>
      {error ? (
        <p className="mt-3" ref={errorRef} role="alert" tabIndex={-1}>
          {error}
        </p>
      ) : null}
      {warnings.length ? (
        <ul className="mt-4 grid gap-3">
          {warnings.map((warning) => (
            <li
              className={`rounded-lg border p-4 ${
                warning.overridden
                  ? "border-amber-200 bg-amber-50"
                  : "border-rose-200 bg-rose-50"
              }`}
              key={warning.conflictKey}
            >
              <p className="font-semibold">{warning.message}</p>
              {warning.override ? (
                <p className="mt-1 text-sm">
                  Overridden · {warning.override.reason} ·{" "}
                  {warning.override.acknowledgedBy} ·{" "}
                  {warning.override.createdAt.toISOString()}
                </p>
              ) : (
                <form
                  className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"
                  onSubmit={(event) => submit(event, warning)}
                >
                  <label className="grid gap-1.5 font-medium">
                    Override reason for {warning.message}
                    <input
                      onChange={(event) =>
                        setReasons((current) => ({
                          ...current,
                          [warning.conflictKey]: event.target.value,
                        }))
                      }
                      required
                      value={reasons[warning.conflictKey] ?? ""}
                    />
                  </label>
                  <button
                    className="button-secondary self-end"
                    disabled={pendingKey !== null}
                    type="submit"
                  >
                    Override {warning.message}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-slate-600">No current resource warnings.</p>
      )}
    </section>
  );
}
