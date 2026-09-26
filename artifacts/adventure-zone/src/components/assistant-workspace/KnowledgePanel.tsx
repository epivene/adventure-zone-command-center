import { useEffect, useRef, useState } from "react";
import type { Rule, Selection } from "@/features/assistant-workspace/types";
import { workspaceApi } from "@/features/assistant-workspace/api";
import { apiFetch } from "@/lib/auth-token";

type InitialNote = { id: string; text: string; sourceLabel: string };
type NoteForm = {
  base: Rule | null;
  title: string;
  body: string;
  source: string;
  scope: string;
  yearMode: string;
  year: string;
  effectiveFrom: string;
  effectiveTo: string;
};
type Proposal = { rule: Rule; expectedVersion: number };
const today = () => new Date().toISOString().slice(0, 10);
const titleKey = (title: string) => title.trim().toLocaleLowerCase();
function sameScope(a: Rule, b: Rule) {
  return (
    a.ruleKey === b.ruleKey &&
    a.organizationId === b.organizationId &&
    a.eventYear === b.eventYear
  );
}
function versionOf(rule: Rule, rules: Rule[]) {
  return (
    rule.headVersion ??
    Math.max(
      0,
      ...rules
        .filter((item) => sameScope(item, rule))
        .map((item) => item.version ?? 0),
    )
  );
}
function newForm(selection?: Selection, note?: InitialNote): NoteForm {
  const scope =
    selection?.organizationIds.length === 1 ? selection.organizationIds[0] : "";
  return {
    base: null,
    title: "",
    body: note?.text ?? "",
    source: note?.sourceLabel ?? "",
    scope,
    yearMode: scope && selection?.eventYear ? "year" : "",
    year: String(selection?.eventYear ?? new Date().getFullYear()),
    effectiveFrom: today(),
    effectiveTo: "",
  };
}
const fieldClass =
  "mt-1 min-h-11 w-full rounded border bg-white p-2 text-base disabled:bg-slate-100";
const buttonClass =
  "min-h-11 rounded border px-3 py-2 text-sm disabled:opacity-50";

export function KnowledgePanel({
  selection,
  initialNote,
  onDirtyChange,
}: {
  selection?: Selection;
  initialNote?: InitialNote;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>(
    {},
  );
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<NoteForm | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pendingNote, setPendingNote] = useState<InitialNote | null>(null);
  const [retiring, setRetiring] = useState<Rule | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const seenNote = useRef<string | null>(null);
  const lock = useRef(false);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const dirty = !!form || !!proposal || !!retiring || busy;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  useEffect(() => {
    let active = true;
    void workspaceApi<Rule[]>("/knowledge")
      .then((items) => {
        if (active) {
          setRules(items);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError(
            "Saved info could not be loaded. Reload before making changes.",
          );
          setNeedsReload(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!initialNote || seenNote.current === initialNote.id) return;
    seenNote.current = initialNote.id;
    if (form || proposal || retiring || busy) setPendingNote(initialNote);
    else {
      setForm(newForm(selection, initialNote));
      setNotice("");
    }
  }, [initialNote, selection, form, proposal, retiring, busy]);

  const organizations = [...new Set(selection?.organizationIds ?? [])];
  const customerIdsKey = JSON.stringify(
    [
      ...new Set([
        ...organizations,
        ...rules.flatMap((rule) =>
          rule.organizationId ? [rule.organizationId] : [],
        ),
        ...(form?.scope && form.scope !== "all" ? [form.scope] : []),
      ]),
    ].sort(),
  );
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    for (const id of JSON.parse(customerIdsKey) as string[]) {
      if (customerNames[id]) continue;
      void apiFetch(`/organizations/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Customer name unavailable");
          const data = await response.json();
          const name = data.organization?.name;
          if (active && typeof name === "string" && name.trim())
            setCustomerNames((current) => ({ ...current, [id]: name.trim() }));
        })
        .catch(() => {
          // The profile link still identifies this scope when its name cannot be read.
        });
    }
    return () => {
      active = false;
      controller.abort();
    };
    // Only changes to the set of customer IDs should start name requests.
  }, [customerIdsKey]);
  function customerName(id: string) {
    return customerNames[id] ?? `Customer profile (${id.slice(0, 8)})`;
  }
  function customerLink(id: string) {
    return (
      <a
        key={id}
        className="text-teal-800 underline"
        href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/profiles/${encodeURIComponent(id)}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${customerName(id)}${customerNames[id] ? " profile" : ""}`}
      >
        {customerName(id)}
      </a>
    );
  }
  function scopeLabel(rule: Rule) {
    return (
      <>
        {rule.organizationId
          ? customerLink(rule.organizationId)
          : "All customers"}{" "}
        · {rule.eventYear ?? "All years"}
      </>
    );
  }
  function upsert(rule: Rule) {
    setRules((current) => [
      ...current.filter((item) => item.id !== rule.id),
      rule,
    ]);
  }
  const formYear = form?.yearMode === "all" ? null : Number(form?.year);
  const duplicate =
    form &&
    !form.base &&
    rules.some(
      (rule) =>
        rule.status !== "superseded" &&
        rule.id !== proposal?.rule.id &&
        titleKey(rule.ruleKey) === titleKey(form.title) &&
        rule.organizationId === (form.scope === "all" ? null : form.scope) &&
        rule.eventYear === formYear,
    );
  const valid =
    !!form &&
    !!form.title.trim() &&
    form.title.trim().length <= 120 &&
    !!form.body.trim() &&
    form.body.length <= 12000 &&
    !!form.source.trim() &&
    form.source.trim().length <= 1000 &&
    !!form.scope &&
    !!form.yearMode &&
    (form.yearMode === "all" ||
      (Number.isInteger(formYear) &&
        Number(formYear) >= 2000 &&
        Number(formYear) <= 2200)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveFrom) &&
    (!form.effectiveTo || form.effectiveTo >= form.effectiveFrom) &&
    !duplicate;
  function change<K extends keyof NoteForm>(key: K, value: NoteForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }
  function closeForm() {
    setForm(null);
    setProposal(null);
    if (!needsReload) setError("");
    setNotice("");
  }
  async function remember(existing?: Rule) {
    if (lock.current || needsReload || (!existing && !proposal && !valid))
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let candidate = existing
      ? { rule: existing, expectedVersion: versionOf(existing, rules) }
      : proposal;
    try {
      if (!candidate && form) {
        const organizationId = form.scope === "all" ? null : form.scope;
        const reviewedScope = rules.filter(
          (rule) =>
            titleKey(rule.ruleKey) === titleKey(form.title) &&
            rule.organizationId === organizationId &&
            rule.eventYear === formYear,
        );
        // Reuse the recorded title when restoring a retired scope, including its casing.
        const ruleKey =
          form.base?.ruleKey ?? reviewedScope[0]?.ruleKey ?? form.title.trim();
        // Freeze the version from the list the user reviewed, before the request can
        // observe a newer head created by another tab.
        const expectedVersion = form.base
          ? versionOf(form.base, rules)
          : Math.max(
              0,
              ...reviewedScope
                .filter((rule) => rule.ruleKey === ruleKey)
                .map((rule) => rule.headVersion ?? rule.version ?? 0),
            );
        const saved = await workspaceApi<Rule>("/knowledge", "POST", {
          ruleKey,
          body: form.body.trim(),
          sourceLabel: form.source.trim(),
          organizationId,
          eventYear: formYear,
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || null,
        });
        candidate = { rule: saved, expectedVersion };
        setProposal(candidate);
        upsert(saved);
        if (
          saved.headVersion !== undefined &&
          saved.headVersion !== expectedVersion
        )
          throw new Error("ASSISTANT_RULE_VERSION_CONFLICT");
      }
      if (!candidate) return;
      // Keep the proposal and its reviewed version until approval is confirmed.
      setProposal(candidate);
      const approved = await workspaceApi<Rule>(
        `/knowledge/${candidate.rule.id}/approve`,
        "POST",
        { expectedVersion: candidate.expectedVersion },
      );
      setRules((current) => [
        ...current
          .filter((item) => item.id !== approved.id)
          .map((item) =>
            item.status === "approved" && sameScope(item, approved)
              ? { ...item, status: "superseded" }
              : item,
          ),
        approved,
      ]);
      setForm(null);
      setProposal(null);
      setNotice(
        "Saved and ready for the assistant to use in the selected scope and effective dates.",
      );
    } catch (cause) {
      const conflict =
        cause instanceof Error &&
        cause.message === "ASSISTANT_RULE_VERSION_CONFLICT";
      if (conflict || !candidate) {
        setNeedsReload(true);
        setError(
          conflict
            ? "This saved info changed. Reload and review the current version before approving."
            : "The save could not be confirmed. Reload and review saved proposals before trying again.",
        );
      } else
        setError(
          "Your proposal is saved, but it is not yet remembered. Retry saving, or close this review and return to the saved proposal later.",
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const current = await workspaceApi<Rule[]>("/knowledge");
      setRules(current);
      setLoaded(true);
      setNeedsReload(false);
      setRetiring(null);
      const saved = proposal
        ? current.find((item) => item.id === proposal.rule.id)
        : form
          ? current.find(
              (item) =>
                item.status !== "superseded" &&
                titleKey(item.ruleKey) === titleKey(form.title) &&
                item.body === form.body.trim() &&
                item.sourceLabel === form.source.trim() &&
                item.organizationId ===
                  (form.scope === "all" ? null : form.scope) &&
                item.eventYear === formYear &&
                item.effectiveFrom === form.effectiveFrom &&
                item.effectiveTo === (form.effectiveTo || null),
            )
          : undefined;
      if (saved) {
        setForm(null);
        setProposal(null);
        setNotice(
          saved.status === "approved"
            ? "Saved and ready for the assistant to use in the selected scope and effective dates."
            : "Review the saved proposal and current info below before choosing Remember this proposal.",
        );
      } else if (proposal) {
        setProposal(null);
        setNotice(
          "The earlier proposal is no longer available. Review the current saved info before making a new change.",
        );
      }
    } catch {
      setError("Saved info could not be reloaded. Your form is still here.");
      setNeedsReload(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function retire() {
    if (!retiring || lock.current || needsReload) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const retired = await workspaceApi<Rule>(
        `/knowledge/${retiring.id}/retire`,
        "POST",
        { expectedVersion: versionOf(retiring, rules) },
      );
      upsert(retired);
      setRetiring(null);
      setNotice("Stopped using this info. Its history is kept.");
    } catch {
      setNeedsReload(true);
      setError(
        "This change could not be confirmed. Reload and review the current saved info before trying again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Business knowledge"
      className="mx-auto max-w-3xl space-y-4"
    >
      <h2 className="text-lg font-semibold">Saved info and business rules</h2>
      <p className="text-sm text-slate-600">
        Chat history is saved automatically. Important information is reused in
        future conversations only after you review and save it here, and only
        for its customer scope, year and effective dates.
      </p>
      <button
        type="button"
        className={buttonClass}
        disabled={
          !loaded || busy || !!form || !!proposal || !!retiring || needsReload
        }
        onClick={() => {
          setForm(newForm(selection));
          setError("");
          setNotice("");
        }}
      >
        Add important info
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-teal-800">
          {notice}
        </p>
      )}
      {needsReload && (
        <button
          type="button"
          disabled={busy}
          className={buttonClass}
          onClick={() => void reload()}
        >
          Reload and review
        </button>
      )}
      {pendingNote && (
        <div
          role="alertdialog"
          aria-label="Keep your unfinished saved info"
          className="space-y-2 rounded-xl border bg-white p-4"
        >
          <p>
            Your current form is unfinished. Replace it with the new message?
            Any saved proposal remains in the list.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => setPendingNote(null)}
            >
              Keep current form
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy || needsReload}
              onClick={() => {
                setForm(newForm(selection, pendingNote));
                setProposal(null);
                setPendingNote(null);
                setRetiring(null);
                setError("");
                setNotice("");
              }}
            >
              Replace with new message
            </button>
          </div>
        </div>
      )}
      {form && (
        <form
          aria-label="Review important information"
          className="space-y-3 rounded-xl border bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void remember();
          }}
        >
          <h3 className="font-semibold">
            {form.base ? "Edit saved info" : "Review before remembering"}
          </h3>
          <fieldset
            disabled={busy || !!proposal || needsReload}
            className="space-y-3"
          >
            <label className="block text-sm">
              Title
              <input
                className={fieldClass}
                value={form.title}
                maxLength={120}
                readOnly={!!form.base}
                onChange={(event) => change("title", event.target.value)}
              />
            </label>
            {form.base && (
              <p className="text-xs text-slate-600">
                Corrections keep the same title and scope so the earlier version
                is replaced.
              </p>
            )}
            <label className="block text-sm">
              Important information
              <textarea
                className={`${fieldClass} min-h-40`}
                value={form.body}
                onChange={(event) => change("body", event.target.value)}
              />
            </label>
            {form.body.length > 12000 && (
              <p className="text-sm text-red-700">
                Shorten this note to 12,000 characters or fewer. The full
                message is still in the form.
              </p>
            )}
            <label className="block text-sm">
              Source or reason
              <input
                className={fieldClass}
                value={form.source}
                maxLength={1000}
                onChange={(event) => change("source", event.target.value)}
              />
            </label>
            <label className="block text-sm">
              Applies to
              <select
                className={fieldClass}
                value={form.scope}
                disabled={!!form.base}
                onChange={(event) => {
                  change("scope", event.target.value);
                  change(
                    "yearMode",
                    event.target.value === "all"
                      ? ""
                      : selection?.eventYear
                        ? "year"
                        : "",
                  );
                }}
              >
                <option value="">Choose who this applies to</option>
                <option value="all">All customers</option>
                {organizations.map((id) => (
                  <option key={id} value={id}>
                    {customerName(id)}
                  </option>
                ))}
                {form.base?.organizationId &&
                  !organizations.includes(form.base.organizationId) && (
                    <option value={form.base.organizationId}>
                      {customerName(form.base.organizationId)}
                    </option>
                  )}
              </select>
            </label>
            <div
              className="flex flex-wrap gap-x-4 gap-y-2 text-sm"
              aria-label="Customer profiles for scope review"
            >
              {[
                ...new Set([
                  ...organizations,
                  ...(form.base?.organizationId
                    ? [form.base.organizationId]
                    : []),
                ]),
              ].map(customerLink)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                Year scope
                <select
                  className={fieldClass}
                  value={form.yearMode}
                  disabled={!!form.base}
                  onChange={(event) => change("yearMode", event.target.value)}
                >
                  <option value="">Choose a year scope</option>
                  <option value="all">All years</option>
                  <option value="year">Specific event year</option>
                </select>
              </label>
              {form.yearMode === "year" && (
                <label className="block text-sm">
                  Event year
                  <input
                    type="number"
                    min={2000}
                    max={2200}
                    className={fieldClass}
                    value={form.year}
                    readOnly={!!form.base}
                    onChange={(event) => change("year", event.target.value)}
                  />
                </label>
              )}
              <label className="block text-sm">
                Effective from
                <input
                  type="date"
                  className={fieldClass}
                  value={form.effectiveFrom}
                  onChange={(event) =>
                    change("effectiveFrom", event.target.value)
                  }
                />
              </label>
              <label className="block text-sm">
                Effective through (optional)
                <input
                  type="date"
                  min={form.effectiveFrom}
                  className={fieldClass}
                  value={form.effectiveTo}
                  onChange={(event) =>
                    change("effectiveTo", event.target.value)
                  }
                />
              </label>
            </div>
          </fieldset>
          {duplicate && (
            <p className="text-sm text-red-700">
              This title already exists for that customer and year. Cancel this
              form and edit the existing saved info below.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!needsReload && (
              <button
                type="submit"
                disabled={busy || !loaded || (!proposal && !valid)}
                className={`${buttonClass} bg-teal-800 text-white`}
              >
                {busy
                  ? "Saving…"
                  : proposal
                    ? "Retry saving"
                    : "Save and remember"}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={closeForm}
            >
              {proposal ? "Close review" : "Cancel"}
            </button>
          </div>
        </form>
      )}
      {proposal && !form && (
        <div className="flex flex-wrap gap-2">
          {!needsReload && (
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => void remember()}
            >
              Retry saving
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={closeForm}
          >
            Close review
          </button>
        </div>
      )}
      {retiring && (
        <div
          role="alertdialog"
          aria-label="Stop using saved info"
          className="space-y-3 rounded-xl border bg-white p-4"
        >
          <p>
            Stop using “{retiring.ruleKey}” for {scopeLabel(retiring)}? It will
            be removed from active saved info for future runs. Previous chats
            and saved info history remain.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={busy || needsReload}
              onClick={() => void retire()}
            >
              Stop using this info
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => setRetiring(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!loaded && !error && <p className="text-sm">Loading saved info…</p>}
      {loaded && !rules.some((item) => item.status !== "superseded") && (
        <p className="text-sm text-slate-600">
          No current saved info yet. Add a fact or business rule you want the
          assistant to remember.
        </p>
      )}
      {rules
        .filter((item) => item.status !== "superseded")
        .map((rule) => (
          <article
            key={rule.id}
            className="space-y-2 rounded-xl border bg-white p-4"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <strong>{rule.ruleKey.replaceAll("-", " ")}</strong>
              <span className="text-xs">
                {rule.status === "approved" ? "Saved" : "Needs review"}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">
              {rule.body}
            </p>
            <p className="text-xs text-slate-600">
              {rule.sourceLabel} · {scopeLabel(rule)} · Effective{" "}
              {rule.effectiveFrom}
              {rule.effectiveTo ? ` through ${rule.effectiveTo}` : " onward"}
            </p>
            <div className="flex flex-wrap gap-2">
              {rule.status === "proposed" ? (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={
                    busy || !!form || !!proposal || !!retiring || needsReload
                  }
                  onClick={() => void remember(rule)}
                >
                  Remember this proposal
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={
                      busy || !!form || !!proposal || !!retiring || needsReload
                    }
                    onClick={() => {
                      setForm({
                        base: { ...rule, headVersion: versionOf(rule, rules) },
                        title: rule.ruleKey,
                        body: rule.body,
                        source: rule.sourceLabel,
                        scope: rule.organizationId ?? "all",
                        yearMode: rule.eventYear ? "year" : "all",
                        year: String(
                          rule.eventYear ?? new Date().getFullYear(),
                        ),
                        effectiveFrom: rule.effectiveFrom,
                        effectiveTo: rule.effectiveTo ?? "",
                      });
                      setError("");
                      setNotice("");
                    }}
                  >
                    Edit saved info
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={
                      busy || !!form || !!proposal || !!retiring || needsReload
                    }
                    onClick={() => {
                      setRetiring(rule);
                      setError("");
                      setNotice("");
                    }}
                  >
                    Stop using
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm">
          Saved info history
        </summary>
        {rules
          .filter((item) => item.status === "superseded")
          .map((rule) => (
            <article
              key={rule.id}
              className="my-3 space-y-1 rounded border p-3 text-sm text-slate-600"
            >
              <strong>{rule.ruleKey.replaceAll("-", " ")}</strong>
              <p className="whitespace-pre-wrap break-words">{rule.body}</p>
              <p className="text-xs">
                {rule.sourceLabel} · {scopeLabel(rule)} · No longer used
              </p>
            </article>
          ))}
      </details>
    </section>
  );
}
