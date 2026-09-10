import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/auth-token";

type TemplateState = "draft" | "reviewed" | "active" | "archived";
type TemplateOwnerKind = "company" | "shared_office" | "office_user";
type Template = {
  id: string;
  code: string;
  name: string;
  channel: "email" | "internal_email";
  category: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  bodyFormat: "plain_text" | "html";
  requiredPlaceholders: string[];
  accessScope: "owner" | "office";
  state: TemplateState;
  ownerKind: TemplateOwnerKind;
  creatorDisplayName: string | null;
};
type NewTemplate = {
  code: string;
  name: string;
  category: string;
  channel: "email" | "internal_email";
  subjectTemplate: string;
  bodyTemplate: string;
  bodyFormat: "plain_text" | "html";
  requiredPlaceholders: string[];
};

const placeholderTokens = [
  "contactName", "eventName", "eventCity", "eventState", "eventDates",
  "senderName", "senderPhone", "senderEmail", "packageName", "packagePrice",
  "packageDuration", "followUpDate", "conventionName", "additionalInsuredWording",
  "additionalInsuredInfo",
];

const previewPlaceholderValues: Record<string, string> = {
  contactName: "Jamie",
  eventName: "Example Community Event",
  eventCity: "Your City",
  eventState: "WY",
  eventDates: "July 10–12, 2027",
  senderName: "Desiree",
  senderPhone: "(555) 555-0123",
  senderEmail: "desiree@example.com",
  packageName: "Adventure Zone",
  packagePrice: "$0.00",
  packageDuration: "three days",
  followUpDate: "October 1, 2026",
  conventionName: "Example Convention",
  additionalInsuredWording: "Example additional insured wording",
  additionalInsuredInfo: "Example insurance information",
  earlyBirdDeadline: "December 31, 2026",
};

function samplePlaceholder(token: string) {
  return previewPlaceholderValues[token]
    ?? token.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function renderExample(value: string) {
  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, token: string) => samplePlaceholder(token));
}

function looksHtml(value: string) {
  return /<\/?(?:html|body|div|p|table|br|span|h[1-6]|img|a)\b/i.test(value);
}

function stateLabel(state: TemplateState) {
  return state === "active" ? "Active" : state === "reviewed" ? "Reviewed" : state === "archived" ? "Archived" : "Draft";
}

function groupTitle(template: Template) {
  if (template.state === "archived") return "Archived";
  if (template.ownerKind === "shared_office") return "Shared Office Templates";
  if (template.ownerKind === "office_user") return "Coordinator Templates";
  return "Adventure Zone Templates";
}

const groupOrder = [
  "Adventure Zone Templates",
  "Shared Office Templates",
  "Coordinator Templates",
  "Archived",
] as const;

export default function SettingsCommunicationTemplatesPage() {
  const blankTemplate: NewTemplate = {
    code: "",
    name: "",
    category: "General",
    channel: "email",
    subjectTemplate: "",
    bodyTemplate: "",
    bodyFormat: "plain_text",
    requiredPlaceholders: [],
  };
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [newTemplate, setNewTemplate] = useState<NewTemplate>(blankTemplate);

  async function load() {
    const response = await apiFetch("/communication-templates");
    if (!response.ok) throw new Error("Could not load communication templates.");
    const data = (await response.json()) as { templates: Template[] };
    setTemplates(data.templates);
    setSelectedId((current) => current && data.templates.some((item) => item.id === current) ? current : data.templates[0]?.id ?? null);
    return data.templates;
  }

  useEffect(() => {
    load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load templates."));
  }, []);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const grouped = useMemo(() => new Map(groupOrder.map((title) => [
    title,
    templates.filter((template) => groupTitle(template) === title),
  ])), [templates]);

  const exampleSubject = useMemo(() => renderExample(subject), [subject]);
  const exampleBody = useMemo(() => renderExample(body), [body]);
  const selectedIsHtml = selected?.bodyFormat === "html" || looksHtml(body);

  useEffect(() => {
    if (!selected) return;
    setSubject(selected.subjectTemplate ?? "");
    setBody(selected.bodyTemplate);
    setEditingBody(false);
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
      await load();
      setMessage("Template saved. Send this version to Dave when it is ready.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save template.");
    } finally { setBusy(false); }
  }

  async function archiveTemplate() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch(`/communication-templates/${selected.id}/archive`, { method: "POST", body: "{}" });
      const data = (await response.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error ?? "Could not archive template.");
      await load(); setMessage("Template archived.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not archive template."); }
    finally { setBusy(false); }
  }

  async function sendToDave() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const accountsResponse = await apiFetch("/boss-admin/accounts");
      const accountsData = await accountsResponse.json() as { accounts?: { id: string; displayName: string; enabled: boolean }[]; error?: string };
      const account = accountsData.accounts?.find((item) => item.enabled && /dave/i.test(item.displayName))
        ?? accountsData.accounts?.find((item) => item.enabled);
      if (!accountsResponse.ok || !account) throw new Error(accountsData.error ?? "Dave’s active Boss account was not found.");
      const response = await apiFetch(`/communication-templates/${selected.id}/request-dave-approval`, {
        method: "POST", body: JSON.stringify({ assignedBossAccountId: account.id, priority: "normal" }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not send this template to Dave.");
      await load(); setMessage("Sent to Dave. His approval will activate this exact version.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send this template to Dave."); }
    finally { setBusy(false); }
  }

  async function promoteShared() {
    if (!selected || selected.ownerKind !== "office_user" || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch(`/communication-templates/${selected.id}/promote-shared`, { method: "POST", body: "{}" });
      const data = (await response.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error ?? "Could not share template.");
      await load();
      setMessage("Template is now shared with Office Coordinators.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not share template.");
    } finally { setBusy(false); }
  }

  async function createTemplate() {
    if (busy || !newTemplate.name.trim() || !newTemplate.code.trim() || !newTemplate.bodyTemplate.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch("/communication-templates", {
        method: "POST",
        body: JSON.stringify({
          ...newTemplate,
          subjectTemplate: newTemplate.subjectTemplate || null,
          accessScope: "owner",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error ?? "Could not create template.");
      const refreshed = await load();
      setSelectedId(data.template.id);
      setShowCreate(false);
      setNewTemplate(blankTemplate);
      setMessage(`Created "${data.template.name}" as a draft. Review it before activating.`);
      if (!refreshed.some((template) => template.id === data.template?.id)) await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create template.");
    } finally { setBusy(false); }
  }

  function insert(token: string, target: "subject" | "body") {
    const value = `{{${token}}}`;
    if (target === "subject") setSubject((current) => `${current}${current ? " " : ""}${value}`);
    else setBody((current) => `${current}${current && !current.endsWith("\n") ? " " : ""}${value}`);
  }

  return <div className="mx-auto grid max-w-7xl gap-5 py-6">
    <header><h1 className="text-3xl font-bold">Communication templates</h1><p className="mt-1 text-slate-600">Adventure Zone standards, shared Office wording, and coordinator-created templates all stay visible here.</p></header>
    {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 font-semibold text-rose-700">{error}</p> : null}
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <aside className="grid content-start gap-4 rounded-xl border bg-white p-3">
         <button className="button-primary w-full" type="button" onClick={() => { setShowCreate(true); setError(""); setMessage(""); }}><span aria-hidden="true">＋</span> New reusable template</button>
         {groupOrder.map((title) => {
          const items = grouped.get(title) ?? [];
          return <section className="grid gap-2" key={title}><div className="flex items-center justify-between"><h2 className="text-sm font-bold">{title}</h2><span className="text-xs text-slate-500">{items.length}</span></div>{items.length ? items.map((template) => <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} className={`rounded-lg border p-3 text-left ${selectedId === template.id ? "border-orange-400 bg-orange-50" : "border-slate-200"}`}><div className="flex items-center justify-between gap-2"><span className="font-bold">{template.name}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{stateLabel(template.state)}</span></div><p className="mt-1 text-xs text-slate-500">{template.category} · {template.accessScope === "office" ? "Office-safe" : "Owner only"}</p>{template.creatorDisplayName ? <p className="mt-1 text-xs font-semibold text-slate-600">Created by {template.creatorDisplayName}</p> : null}</button>) : <p className="rounded-lg border border-dashed p-2 text-xs text-slate-500">None</p>}</section>;
        })}
      </aside>
       {showCreate ? <section className="grid gap-4 rounded-xl border bg-white p-4 shadow-sm">
         <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">New draft</p><h2 className="text-xl font-bold">Create a reusable template</h2><p className="mt-1 text-sm text-slate-600">Save it as a draft, test the wording, then activate it for real email workflows.</p></div>
         <div className="grid gap-4 sm:grid-cols-2">
           <label className="grid gap-1 text-sm font-bold">Template name<input value={newTemplate.name} placeholder="Proposal follow-up" onChange={(event) => setNewTemplate((current) => ({ ...current, name: event.target.value }))} /></label>
           <label className="grid gap-1 text-sm font-bold">Template code<input value={newTemplate.code} placeholder="proposal_follow_up" onChange={(event) => setNewTemplate((current) => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_") }))} /><span className="text-xs font-normal text-slate-500">Lowercase letters, numbers, and underscores.</span></label>
           <label className="grid gap-1 text-sm font-bold">Category<input value={newTemplate.category} placeholder="Sales" onChange={(event) => setNewTemplate((current) => ({ ...current, category: event.target.value }))} /></label>
           <label className="grid gap-1 text-sm font-bold">Channel<select value={newTemplate.channel} onChange={(event) => setNewTemplate((current) => ({ ...current, channel: event.target.value as NewTemplate["channel"] }))}><option value="email">Email</option><option value="internal_email">Internal email</option></select></label>
         </div>
         <label className="grid gap-1 text-sm font-bold">Subject<input value={newTemplate.subjectTemplate} placeholder="A note for {{contactName}}" onChange={(event) => setNewTemplate((current) => ({ ...current, subjectTemplate: event.target.value }))} /></label>
         <label className="grid gap-1 text-sm font-bold">Body<textarea rows={14} value={newTemplate.bodyTemplate} placeholder={"Hi {{contactName}},\n\nWrite the reusable message here."} onChange={(event) => setNewTemplate((current) => ({ ...current, bodyTemplate: event.target.value }))} /></label>
         <div><p className="text-sm font-bold">Required placeholders</p><p className="mt-1 text-xs text-slate-500">Choose values that must be present before this draft can be activated.</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{placeholderTokens.map((token) => <label className="flex items-center gap-2 text-sm" key={token}><input type="checkbox" checked={newTemplate.requiredPlaceholders.includes(token)} onChange={(event) => setNewTemplate((current) => ({ ...current, requiredPlaceholders: event.target.checked ? [...current.requiredPlaceholders, token] : current.requiredPlaceholders.filter((item) => item !== token) }))} />{`{{${token}}}`}</label>)}</div></div>
         {message ? <p role="status" className="rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-800">{message}</p> : null}
         <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy || !newTemplate.name.trim() || !newTemplate.code.trim() || !newTemplate.bodyTemplate.trim()} type="button" onClick={() => void createTemplate()}>{busy ? "Creating…" : "Create draft"}</button><button className="button-secondary" disabled={busy} type="button" onClick={() => { setShowCreate(false); setNewTemplate(blankTemplate); }}>Cancel</button></div>
       </section> : selected ? <section className="grid gap-4 rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{selected.code}</p><h2 className="text-xl font-bold">{selected.name}</h2>{selected.creatorDisplayName ? <p className="mt-1 text-sm text-slate-600">Created by {selected.creatorDisplayName}</p> : null}</div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{stateLabel(selected.state)}</span></div>
        <label className="grid gap-1 text-sm font-bold">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <section className="grid gap-3" aria-label="Live email preview">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-sm font-bold">Live email preview</p><p className="mt-1 text-xs text-slate-500">Example names and dates stand in for placeholders. The saved template keeps the placeholders.</p></div>
            {selectedIsHtml ? <button className="button-secondary" type="button" onClick={() => setEditingBody((current) => !current)}>{editingBody ? "Hide HTML" : "Edit HTML"}</button> : null}
          </div>
          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b bg-slate-50 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Subject</p><p className="mt-1 break-words font-semibold">{exampleSubject || "(No subject)"}</p></div>
            {selectedIsHtml
              ? <iframe className="min-h-[42rem] w-full bg-white" sandbox="" srcDoc={exampleBody} title="Email body preview" />
              : <pre className="min-h-40 whitespace-pre-wrap break-words p-4 font-sans text-sm">{exampleBody}</pre>}
          </div>
        </section>
        {selectedIsHtml
          ? editingBody ? <label className="grid gap-1 text-sm font-bold">Email HTML source<textarea aria-label="Email HTML source" className="font-mono text-xs" rows={18} value={body} onChange={(event) => setBody(event.target.value)} /><span className="text-xs font-normal text-slate-500">Changes appear in the preview above as you type.</span></label> : null
          : <label className="grid gap-1 text-sm font-bold">Body<textarea rows={14} value={body} onChange={(event) => setBody(event.target.value)} /></label>}
        <div><p className="text-sm font-bold">Insert placeholder</p><div className="mt-2 flex flex-wrap gap-2">{placeholderTokens.map((token) => <div className="flex overflow-hidden rounded-full border" key={token}><button className="px-2 py-1 text-xs" type="button" onClick={() => insert(token, "subject")}>{token} → subject</button><button className="border-l px-2 py-1 text-xs" type="button" onClick={() => insert(token, "body")}>body</button></div>)}</div></div>
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Required for this template: {selected.requiredPlaceholders.length ? selected.requiredPlaceholders.join(", ") : "None"}</p>
        {message ? <p role="status" className="rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-800">{message}</p> : null}
        <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy || !body.trim()} type="button" onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button>{selected.state !== "active" && selected.state !== "archived" ? <button className="button-secondary" disabled={busy} type="button" onClick={() => void sendToDave()}>Send to Dave for Approval</button> : null}{selected.ownerKind === "office_user" && selected.state !== "archived" ? <button className="button-secondary" disabled={busy} type="button" onClick={() => void promoteShared()}>Make shared template</button> : null}{selected.state !== "archived" ? <button className="button-secondary" disabled={busy} type="button" onClick={() => void archiveTemplate()}>Archive</button> : null}</div>
      </section> : <section className="rounded-xl border bg-white p-6 text-slate-500">No templates available.</section>}
    </div>
  </div>;
}
