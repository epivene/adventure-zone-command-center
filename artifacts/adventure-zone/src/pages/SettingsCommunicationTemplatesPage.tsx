import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/auth-token";

type TemplateState = "draft" | "reviewed" | "active" | "archived";
type Template = {
  id: string;
  code: string;
  name: string;
  channel: "email" | "internal_email";
  category: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  requiredPlaceholders: string[];
  accessScope: "owner" | "office";
  state: TemplateState;
};

const placeholderTokens = [
  "contactName", "eventName", "eventCity", "eventState", "eventDates",
  "senderName", "senderPhone", "senderEmail", "packageName", "packagePrice",
  "packageDuration", "followUpDate", "conventionName", "additionalInsuredWording",
  "additionalInsuredInfo",
];

function stateLabel(state: TemplateState) {
  return state === "active" ? "Active" : state === "reviewed" ? "Reviewed" : state === "archived" ? "Archived" : "Draft";
}

export default function SettingsCommunicationTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await apiFetch("/communication-templates");
    if (!response.ok) throw new Error("Could not load communication templates.");
    const data = (await response.json()) as { templates: Template[] };
    setTemplates(data.templates);
    setSelectedId((current) => current ?? data.templates[0]?.id ?? null);
  }

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load templates."));
  }, []);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setSubject(selected.subjectTemplate ?? "");
    setBody(selected.bodyTemplate);
    setMessage("");
    setError("");
  }, [selected?.id]);

  async function save() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch(`/communication-templates/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ subjectTemplate: subject || null, bodyTemplate: body }),
      });
      const data = (await response.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error ?? "Could not save template.");
      setTemplates((current) => current.map((item) => item.id === data.template!.id ? data.template! : item));
      setMessage("Template saved. Review it before activating.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save template.");
    } finally { setBusy(false); }
  }

  async function changeState(action: "activate" | "archive") {
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch(`/communication-templates/${selected.id}/${action}`, { method: "POST", body: "{}" });
      const data = (await response.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error ?? `Could not ${action} template.`);
      setTemplates((current) => current.map((item) => item.id === data.template!.id ? data.template! : item));
      setMessage(action === "activate" ? "Template activated." : "Template archived.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} template.`);
    } finally { setBusy(false); }
  }

  function insert(token: string, target: "subject" | "body") {
    const value = `{{${token}}}`;
    if (target === "subject") setSubject((current) => `${current}${current ? " " : ""}${value}`);
    else setBody((current) => `${current}${current && !current.endsWith("\n") ? " " : ""}${value}`);
  }

  return <div className="mx-auto grid max-w-7xl gap-5 py-6">
    <header><h1 className="text-3xl font-bold">Communication templates</h1><p className="mt-1 text-slate-600">Reviewed starting language for emails. Package prices and durations are inserted from current package data instead of being buried in old copy.</p></header>
    {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 font-semibold text-rose-700">{error}</p> : null}
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <aside className="grid content-start gap-2 rounded-xl border bg-white p-3">
        {templates.map((template) => <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} className={`rounded-lg border p-3 text-left ${selectedId === template.id ? "border-orange-400 bg-orange-50" : "border-slate-200"}`}><div className="flex items-center justify-between gap-2"><span className="font-bold">{template.name}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{stateLabel(template.state)}</span></div><p className="mt-1 text-xs text-slate-500">{template.category} · {template.accessScope === "office" ? "Office-safe" : "Owner only"}</p></button>)}
      </aside>
      {selected ? <section className="grid gap-4 rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{selected.code}</p><h2 className="text-xl font-bold">{selected.name}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{stateLabel(selected.state)}</span></div>
        <label className="grid gap-1 text-sm font-bold">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-bold">Body<textarea rows={14} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <div><p className="text-sm font-bold">Insert placeholder</p><div className="mt-2 flex flex-wrap gap-2">{placeholderTokens.map((token) => <div className="flex overflow-hidden rounded-full border" key={token}><button className="px-2 py-1 text-xs" type="button" onClick={() => insert(token, "subject")}>{token} → subject</button><button className="border-l px-2 py-1 text-xs" type="button" onClick={() => insert(token, "body")}>body</button></div>)}</div></div>
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Required for this template: {selected.requiredPlaceholders.length ? selected.requiredPlaceholders.join(", ") : "None"}</p>
        {message ? <p role="status" className="rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-800">{message}</p> : null}
        <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy || !body.trim()} type="button" onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button>{selected.state !== "active" ? <button className="button-secondary" disabled={busy} type="button" onClick={() => void changeState("activate")}>Activate</button> : null}{selected.state !== "archived" ? <button className="button-secondary" disabled={busy} type="button" onClick={() => void changeState("archive")}>Archive</button> : null}</div>
      </section> : <section className="rounded-xl border bg-white p-6 text-slate-500">No templates available.</section>}
    </div>
  </div>;
}
