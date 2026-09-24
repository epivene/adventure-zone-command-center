import { useEffect, useState } from "react";
import type { Rule } from "@/features/assistant-workspace/types";
import { workspaceApi } from "@/features/assistant-workspace/api";
export function KnowledgePanel() {
  const [rules, setRules] = useState<Rule[]>([]),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<Rule | null>(null),
    [body, setBody] = useState(""),
    [source, setSource] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => setRules(await workspaceApi<Rule[]>("/knowledge"));
  useEffect(() => {
    void load().catch(() => setError("Business rules could not be loaded."));
  }, []);
  async function propose() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await workspaceApi("/knowledge", "POST", {
        ruleKey: editing.ruleKey,
        body,
        sourceLabel: source,
        organizationId: editing.organizationId,
        eventYear: editing.eventYear,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        effectiveTo: null,
      });
      setEditing(null);
      await load();
    } catch {
      setError("The correction could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function approve(rule: Rule) {
    setBusy(true);
    setError("");
    try {
      const version = Math.max(
        0,
        ...rules
          .filter(
            (r) =>
              r.ruleKey === rule.ruleKey &&
              r.organizationId === rule.organizationId &&
              r.eventYear === rule.eventYear,
          )
          .map((r) => r.version ?? 0),
      );
      await workspaceApi(`/knowledge/${rule.id}/approve`, "POST", {
        expectedVersion: version,
      });
      await load();
    } catch {
      setError(
        "This rule changed. Reload and review the current version before approving.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Business knowledge" className="space-y-3">
      <h2 className="text-lg font-semibold">Business rules</h2>
      <p className="text-sm text-slate-600">
        Corrections retain their source and history. Customer exceptions apply
        only to their recorded scope.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {editing && (
        <div className="space-y-3 rounded-xl border bg-white p-4">
          <label className="block text-sm">
            Correction
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 min-h-28 w-full rounded border p-2"
            />
          </label>
          <label className="block text-sm">
            Source or reason
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="mt-1 w-full rounded border p-2"
            />
          </label>
          <button
            type="button"
            disabled={busy || !body.trim() || !source.trim()}
            onClick={() => void propose()}
            className="rounded bg-teal-800 px-3 py-2 text-white"
          >
            Save proposal
          </button>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="ml-3"
          >
            Cancel
          </button>
        </div>
      )}
      {rules
        .filter((r) => r.status !== "superseded")
        .map((rule) => (
          <article key={rule.id} className="rounded-xl border bg-white p-4">
            <div className="flex justify-between gap-2">
              <strong>{rule.ruleKey.replaceAll("-", " ")}</strong>
              <span className="text-xs">{rule.status}</span>
            </div>
            <p className="my-2 whitespace-pre-wrap text-sm">{rule.body}</p>
            <p className="text-xs text-slate-500">
              {rule.sourceLabel} ·{" "}
              {rule.organizationId ? "Customer-specific" : "Global"}
              {rule.eventYear ? ` · ${rule.eventYear}` : ""} · Effective{" "}
              {rule.effectiveFrom}
            </p>
            {rule.status === "proposed" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void approve(rule)}
                className="mt-3 text-sm font-semibold text-teal-800"
              >
                Approve correction
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditing(rule);
                  setBody(rule.body);
                  setSource("");
                }}
                className="mt-3 text-sm font-semibold text-teal-800"
              >
                Correct this rule
              </button>
            )}
          </article>
        ))}
      <details>
        <summary className="cursor-pointer text-sm">Superseded history</summary>
        {rules
          .filter((r) => r.status === "superseded")
          .map((r) => (
            <p key={r.id} className="my-2 text-sm text-slate-600">
              {r.body} <span className="text-xs">({r.sourceLabel})</span>
            </p>
          ))}
      </details>
    </section>
  );
}
