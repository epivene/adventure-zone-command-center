import { useEffect, useMemo, useState } from "react";

import type { GuidedCallScriptKind } from "@/features/calls/call-types";
import {
  GUIDED_CALL_SCRIPT_KINDS,
  getGuidedCallScript,
  renderGuidedText,
  type GuidedCallNode,
} from "@/features/calls/guided-call-scripts";
import {
  loadCallScriptOverrides,
  resetCallScriptOverride,
  saveCallScriptOverride,
  type SavedGuidedCallScriptOverride,
} from "@/features/calls/call-script-settings-client";

const scriptLabels: Record<GuidedCallScriptKind, string> = {
  first_outreach: "First outreach",
  rebooking: "Past customer / rebooking",
  follow_up: "Follow-up",
  proposal_contract: "Proposal / contract",
  callback: "Requested callback",
  incoming_inquiry: "Incoming inquiry",
};

const nodeOrder = [
  "opening",
  "details",
  "package_interest",
  "pricing",
  "already_booked_response",
  "space_constraint",
  "budget_constraint",
  "event_not_happening",
  "policy_restriction",
  "past_customer_feedback",
  "next_step",
  "callback_time",
  "decision_maker",
  "close_declined",
];

const nodeLabels: Record<string, string> = {
  opening: "Opening",
  details: "Interested / event details",
  package_interest: "Choosing the attraction mix",
  pricing: "Pricing question",
  already_booked_response: "Already booked / future season",
  space_constraint: "Space constraint",
  budget_constraint: "Budget constraint",
  event_not_happening: "Event not happening",
  policy_restriction: "Policy restriction",
  past_customer_feedback: "Past-customer feedback",
  next_step: "Next step",
  callback_time: "Schedule a callback",
  decision_maker: "Wrong person / decision-maker",
  close_declined: "Not interested / already booked",
};

const placeholders = [
  { label: "Contact name", token: "{{contactName}}" },
  { label: "Event name", token: "{{eventName}}" },
  { label: "Event date", token: "{{eventDate}}" },
  { label: "Location", token: "{{location}}" },
  { label: "Package interest", token: "{{packageInterest}}" },
];

const previewContext = {
  contactName: "Sarah",
  eventName: "River Days",
  eventDate: "July 4",
  location: "Denver, CO",
  packageInterest: "Adventure Zone",
};

function overrideKey(scriptKind: GuidedCallScriptKind, nodeId: string) {
  return `${scriptKind}:${nodeId}`;
}

function StepEditor({
  scriptKind,
  node,
  override,
  onSaved,
  onReset,
}: {
  scriptKind: GuidedCallScriptKind;
  node: GuidedCallNode;
  override?: SavedGuidedCallScriptOverride;
  onSaved(record: SavedGuidedCallScriptOverride): void;
  onReset(nodeId: string): void;
}) {
  const [sayText, setSayText] = useState(override?.sayText ?? node.say);
  const [coachText, setCoachText] = useState(override ? (override.coachText ?? "") : (node.coach ?? ""));
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function insertPlaceholder(token: string) {
    setSayText((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${token}`);
    setMessage("");
  }

  async function save() {
    if (!sayText.trim() || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const record = await saveCallScriptOverride({
        scriptKind,
        nodeId: node.id,
        sayText: sayText.trim(),
        coachText: coachText.trim() || null,
      });
      onSaved(record);
      setMessage("Saved. New calls will use this wording.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this script step.");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!override || resetting) return;
    setResetting(true);
    setError("");
    setMessage("");
    try {
      await resetCallScriptOverride(scriptKind, node.id);
      onReset(node.id);
      setSayText(node.say);
      setCoachText(node.coach ?? "");
      setMessage("Reset to the Adventure Zone default.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset this script step.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{node.id.replaceAll("_", " ")}</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">{nodeLabels[node.id] ?? node.id}</h2>
        </div>
        {override ? <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">Customized</span> : null}
      </div>

      <label className="mt-4 grid gap-1.5 text-sm font-bold text-slate-800">
        Say this
        <textarea
          className="min-h-32 rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal leading-6"
          maxLength={2000}
          onChange={(event) => { setSayText(event.target.value); setMessage(""); }}
          value={sayText}
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Insert placeholders">
        {placeholders.map((placeholder) => (
          <button
            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-orange-300 hover:bg-orange-50"
            key={placeholder.token}
            onClick={() => insertPlaceholder(placeholder.token)}
            type="button"
          >
            + {placeholder.label}
          </button>
        ))}
      </div>

      <label className="mt-4 grid gap-1.5 text-sm font-bold text-slate-800">
        Coaching tip
        <textarea
          className="min-h-24 rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal leading-6"
          maxLength={2000}
          onChange={(event) => { setCoachText(event.target.value); setMessage(""); }}
          placeholder="Optional note for the person making the call"
          value={coachText}
        />
      </label>

      <div className="mt-4 rounded-2xl bg-slate-950 p-4 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-300">Preview</p>
        <p className="mt-2 text-lg font-semibold leading-relaxed">{renderGuidedText(sayText || node.say, previewContext)}</p>
        {coachText.trim() ? <p className="mt-3 border-t border-slate-700 pt-3 text-sm text-slate-300">Coaching: {coachText}</p> : null}
      </div>

      {error ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      {message ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{message}</p> : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button className="button-primary min-h-11" disabled={saving || !sayText.trim()} onClick={() => void save()} type="button">
          {saving ? "Saving…" : "Save changes"}
        </button>
        {override ? (
          <button className="button-secondary min-h-11" disabled={resetting} onClick={() => void reset()} type="button">
            {resetting ? "Resetting…" : "Reset to Adventure Zone default"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export default function SettingsCallScriptsPage() {
  const [scriptKind, setScriptKind] = useState<GuidedCallScriptKind>("first_outreach");
  const [overrides, setOverrides] = useState<SavedGuidedCallScriptOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCallScriptOverrides()
      .then((records) => {
        if (!cancelled) setOverrides(records);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load call scripts.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const overridesByKey = useMemo(
    () => new Map(overrides.map((record) => [overrideKey(record.scriptKind, record.nodeId), record])),
    [overrides],
  );
  const script = getGuidedCallScript(scriptKind);
  const nodes = nodeOrder.map((nodeId) => script.nodes[nodeId]).filter((node): node is GuidedCallNode => Boolean(node));

  function onSaved(record: SavedGuidedCallScriptOverride) {
    setOverrides((current) => [
      ...current.filter((item) => overrideKey(item.scriptKind, item.nodeId) !== overrideKey(record.scriptKind, record.nodeId)),
      record,
    ]);
  }

  function onReset(nodeId: string) {
    setOverrides((current) => current.filter((item) => overrideKey(item.scriptKind, item.nodeId) !== overrideKey(scriptKind, nodeId)));
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-5 pb-12">
      <header className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">Settings · Calling</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Call Scripts</h1>
        <p className="mt-2 max-w-3xl text-slate-700">
          Change the words you want to say on calls. Your response buttons and call outcomes stay protected, so editing wording cannot break the guided call workflow.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="grid gap-1.5 text-sm font-bold text-slate-800">
          Script
          <select
            className="min-h-11"
            onChange={(event) => setScriptKind(event.target.value as GuidedCallScriptKind)}
            value={scriptKind}
          >
            {GUIDED_CALL_SCRIPT_KINDS.map((kind) => <option key={kind} value={kind}>{scriptLabels[kind]}</option>)}
          </select>
        </label>
        <p className="mt-2 text-sm text-slate-500">Edit one conversation step at a time. Changes save for every device that uses Command Center.</p>
      </section>

      {loading ? <p className="rounded-xl bg-white p-5 text-slate-500">Loading call scripts…</p> : null}
      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 font-semibold text-rose-700" role="alert">{error}</p> : null}

      {!loading ? nodes.map((node) => (
        <StepEditor
          key={`${scriptKind}:${node.id}`}
          node={node}
          onReset={onReset}
          onSaved={onSaved}
          override={overridesByKey.get(overrideKey(scriptKind, node.id))}
          scriptKind={scriptKind}
        />
      )) : null}
    </div>
  );
}
