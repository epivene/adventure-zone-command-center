import { useEffect, useMemo, useState } from "react";
import { compileEmailBuilderDocument, type EmailBuilderDocument } from "@workspace/api-zod";
import { Link } from "wouter";

import { EmailBuilder } from "@/components/email-template-builder/EmailBuilder";
import { createBlankEmailDocument, createBrandedStarterDocument } from "@/features/email-template-builder/email-builder-types";
import { importLegacyEmail } from "@/features/email-template-builder/legacy-email-import";
import { apiFetch } from "@/lib/auth-token";

type TemplateState = "draft" | "reviewed" | "active" | "archived";
type TemplateOwnerKind = "company" | "shared_office" | "office_user";
type Template = {
  id: string; code: string; name: string; channel: "email" | "internal_email"; category: string;
  subjectTemplate: string | null; bodyTemplate: string; bodyFormat: "plain_text" | "html";
  editorDocument?: EmailBuilderDocument | null; editorDocumentVersion?: number | null;
  requiredPlaceholders: string[]; accessScope: "owner" | "office"; state: TemplateState;
  ownerKind: TemplateOwnerKind; creatorDisplayName: string | null;
};
type NewTemplate = {
  code: string; name: string; category: string; channel: "email" | "internal_email";
  subjectTemplate: string; editorDocument: EmailBuilderDocument; requiredPlaceholders: string[];
};

const placeholderTokens = [
  "contactName", "eventName", "eventCity", "eventState", "eventDates", "senderName", "senderPhone",
  "senderEmail", "packageName", "packagePrice", "packageDuration", "followUpDate", "conventionName",
  "additionalInsuredWording", "additionalInsuredInfo",
];
const groupOrder = ["Adventure Zone Templates", "Shared Office Templates", "Coordinator Templates", "Archived"] as const;

function createEmptyTemplate(): NewTemplate {
  return { code: "", name: "", category: "General", channel: "email", subjectTemplate: "", editorDocument: createBlankEmailDocument(), requiredPlaceholders: [] };
}
function documentForTemplate(template: Template): EmailBuilderDocument {
  if (template.editorDocument) return template.editorDocument;
  if (template.bodyFormat === "html") return importLegacyEmail(template.bodyTemplate).document;
  const document = createBlankEmailDocument();
  const block = document.blocks[0];
  if (block?.type === "text") block.content = template.bodyTemplate;
  return document;
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

export default function SettingsCommunicationTemplatesPage() {
  const [initialRequest] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { templateId: params.get("template"), startNew: params.get("new") === "1" };
  });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [plainBody, setPlainBody] = useState("");
  const [savedPlainBody, setSavedPlainBody] = useState("");
  const [visualMode, setVisualMode] = useState(true);
  const [builderDocument, setBuilderDocument] = useState<EmailBuilderDocument>(() => createBlankEmailDocument());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savedDocument, setSavedDocument] = useState("");
  const [savedSubject, setSavedSubject] = useState("");
  const [originalHtml, setOriginalHtml] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(initialRequest.startNew);
  const [newTemplate, setNewTemplate] = useState<NewTemplate>(() => createEmptyTemplate());
  const [newTemplateBaseline, setNewTemplateBaseline] = useState(() => initialRequest.startNew ? JSON.stringify(createEmptyTemplate()) : "");

  async function load() {
    const response = await apiFetch("/communication-templates");
    if (!response.ok) throw new Error("Could not load communication templates.");
    const data = (await response.json()) as { templates: Template[] };
    setTemplates(data.templates);
    setSelectedId((current) => {
      if (current && data.templates.some((item) => item.id === current)) return current;
      if (initialRequest.templateId && data.templates.some((item) => item.id === initialRequest.templateId)) return initialRequest.templateId;
      return data.templates[0]?.id ?? null;
    });
    return data.templates;
  }
  useEffect(() => { load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load templates.")); }, []);

  const selected = useMemo(() => templates.find((template) => template.id === selectedId) ?? null, [templates, selectedId]);
  const grouped = useMemo(() => new Map(groupOrder.map((title) => [title, templates.filter((template) => groupTitle(template) === title)])), [templates]);
  const documentJson = JSON.stringify(builderDocument);
  const existingUnsavedChanges = !!selected && !showCreate && editingId === selected.id && (subject !== savedSubject || (visualMode ? documentJson !== savedDocument : plainBody !== savedPlainBody));
  const newTemplateUnsavedChanges = showCreate && JSON.stringify(newTemplate) !== newTemplateBaseline;
  const hasUnsavedChanges = existingUnsavedChanges || newTemplateUnsavedChanges;
  const previewHtml = useMemo(() => documentJson === savedDocument && originalHtml ? originalHtml : compileEmailBuilderDocument(builderDocument), [builderDocument, documentJson, originalHtml, savedDocument]);
  const newPreviewHtml = useMemo(() => compileEmailBuilderDocument(newTemplate.editorDocument), [newTemplate.editorDocument]);

  useEffect(() => {
    if (!selected) return;
    const nextDocument = documentForTemplate(selected);
    const nextSubject = selected.subjectTemplate ?? "";
    setSubject(nextSubject); setPlainBody(selected.bodyTemplate); setSavedPlainBody(selected.bodyTemplate);
    setVisualMode(!!selected.editorDocument || selected.bodyFormat === "html");
    setBuilderDocument(nextDocument); setSavedDocument(JSON.stringify(nextDocument));
    setSavedSubject(nextSubject); setOriginalHtml(selected.bodyFormat === "html" ? selected.bodyTemplate : "");
    setEditingId(selected.id); setMessage(""); setError("");
  }, [selected?.id]);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

  function confirmDiscard() { return !hasUnsavedChanges || window.confirm("Discard your unsaved email changes?"); }
  async function save() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const write = visualMode
        ? { subjectTemplate: subject || null, bodyFormat: "html" as const, editorDocument: builderDocument }
        : { subjectTemplate: subject || null, bodyFormat: "plain_text" as const, bodyTemplate: plainBody };
      const response = await apiFetch(`/communication-templates/${selected.id}`, { method: "PATCH", body: JSON.stringify(write) });
      const data = (await response.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error ?? "Could not save template.");
      const saved = data.template;
      setTemplates((current) => current.map((template) => template.id === saved.id ? saved : template));
      const nextDocument = saved.editorDocument ?? builderDocument;
      setBuilderDocument(nextDocument); setSavedDocument(JSON.stringify(nextDocument)); setSavedSubject(saved.subjectTemplate ?? subject);
      setPlainBody(saved.bodyTemplate); setSavedPlainBody(saved.bodyTemplate);
      setOriginalHtml(saved.bodyFormat === "html" ? saved.bodyTemplate : ""); setMessage("Template saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save template."); }
    finally { setBusy(false); }
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
  async function promoteShared() {
    if (!selected || selected.ownerKind !== "office_user" || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch(`/communication-templates/${selected.id}/promote-shared`, { method: "POST", body: "{}" });
      const data = (await response.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error ?? "Could not share template.");
      await load(); setMessage("Template is now shared with Office Coordinators.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not share template."); }
    finally { setBusy(false); }
  }
  async function createTemplate() {
    if (busy || !newTemplate.name.trim() || !newTemplate.code.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiFetch("/communication-templates", {
        method: "POST",
        body: JSON.stringify({ ...newTemplate, subjectTemplate: newTemplate.subjectTemplate || null, bodyTemplate: newPreviewHtml, bodyFormat: "html", accessScope: "owner" }),
      });
      const data = (await response.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error ?? "Could not create template.");
      await load(); setSelectedId(data.template.id); setShowCreate(false); setNewTemplate(createEmptyTemplate());
      setMessage(`Created "${data.template.name}" as a draft. Review it before activating.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create template."); }
    finally { setBusy(false); }
  }
  function openTemplate(id: string) {
    if (!confirmDiscard()) return;
    setEditingId(null); setShowCreate(false); setSelectedId(id);
  }

  return <div className="mx-auto grid max-w-7xl gap-5 py-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Adventure Zone Design Studio</p><h1 className="mt-1 text-3xl font-bold">Email Template Studio</h1><p className="mt-1 text-slate-600">Drag, drop, and edit reusable HTML emails for Adventure Zone drafts.</p></div><Link className="button-secondary" href="/design-studio">← Back to Design Studio</Link></header>
    {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 font-semibold text-rose-700">{error}</p> : null}
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-4 rounded-xl border bg-white p-3">
        <button className="button-primary w-full" type="button" onClick={() => { if (!confirmDiscard()) return; const next = createEmptyTemplate(); setNewTemplate(next); setNewTemplateBaseline(JSON.stringify(next)); setShowCreate(true); setError(""); setMessage(""); }}><span aria-hidden="true">＋</span> New reusable template</button>
        {groupOrder.map((title) => {
          const items = grouped.get(title) ?? [];
          return <section className="grid gap-2" key={title}><div className="flex items-center justify-between"><h2 className="text-sm font-bold">{title}</h2><span className="text-xs text-slate-500">{items.length}</span></div>{items.length ? items.map((template) => <button key={template.id} type="button" onClick={() => openTemplate(template.id)} className={`rounded-lg border p-3 text-left ${selectedId === template.id && !showCreate ? "border-orange-400 bg-orange-50" : "border-slate-200"}`}><div className="flex items-center justify-between gap-2"><span className="font-bold">{template.name}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{stateLabel(template.state)}</span></div><p className="mt-1 text-xs text-slate-500">{template.category} · {template.accessScope === "office" ? "Office-safe" : "Owner only"}</p>{template.creatorDisplayName ? <p className="mt-1 text-xs font-semibold text-slate-600">Created by {template.creatorDisplayName}</p> : null}</button>) : <p className="rounded-lg border border-dashed p-2 text-xs text-slate-500">None</p>}</section>;
        })}
      </aside>
      {showCreate ? <CreateTemplateForm template={newTemplate} busy={busy} previewHtml={newPreviewHtml} onChange={setNewTemplate} onCreate={() => void createTemplate()} onCancel={() => { setShowCreate(false); setNewTemplate(createEmptyTemplate()); }} />
        : selected ? <section className="grid min-w-0 gap-4 rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{selected.code}</p><h2 className="text-xl font-bold">{selected.name}</h2>{selected.creatorDisplayName ? <p className="mt-1 text-sm text-slate-600">Created by {selected.creatorDisplayName}</p> : null}</div><div className="flex items-center gap-2">{hasUnsavedChanges ? <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">Unsaved</span> : null}<span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{stateLabel(selected.state)}</span></div></div>
          <label className="grid gap-1 text-sm font-bold">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          {editingId !== selected.id ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Preparing editor…</p> : visualMode
            ? <EmailBuilder key={`${selected.id}:${savedDocument}`} value={builderDocument} onChange={setBuilderDocument} previewHtml={previewHtml} />
            : <section className="grid gap-3 rounded-xl border bg-slate-50 p-4"><label className="grid gap-1 text-sm font-bold">Plain-text body<textarea rows={14} value={plainBody} onChange={(event) => setPlainBody(event.target.value)} /></label><div><button className="button-secondary" type="button" onClick={() => { const next = documentForTemplate({ ...selected, bodyTemplate: plainBody }); setBuilderDocument(next); setSavedDocument(""); setVisualMode(true); }}>Convert to visual email</button></div></section>}
          <div><p className="text-sm font-bold">Insert a placeholder in the subject</p><div className="mt-2 flex flex-wrap gap-2">{placeholderTokens.map((token) => <button className="rounded-full border px-2 py-1 text-xs" type="button" key={token} onClick={() => setSubject((current) => `${current}${current ? " " : ""}{{${token}}}`)}>{token}</button>)}</div></div>
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Required for this template: {selected.requiredPlaceholders.length ? selected.requiredPlaceholders.join(", ") : "None"}</p>
          {message ? <p role="status" className="rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-800">{message}</p> : null}
          <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy} type="button" onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button>{selected.ownerKind === "office_user" && selected.state !== "archived" ? <button className="button-secondary" disabled={busy} type="button" onClick={() => void promoteShared()}>Make shared template</button> : null}{selected.state !== "archived" ? <button className="button-secondary" disabled={busy} type="button" onClick={() => void archiveTemplate()}>Archive</button> : null}</div>
        </section> : <section className="rounded-xl border bg-white p-6 text-slate-500">No templates available.</section>}
    </div>
  </div>;
}

function CreateTemplateForm({ template, busy, previewHtml, onChange, onCreate, onCancel }: { template: NewTemplate; busy: boolean; previewHtml: string; onChange: React.Dispatch<React.SetStateAction<NewTemplate>>; onCreate(): void; onCancel(): void }) {
  return <section className="grid min-w-0 gap-4 rounded-xl border bg-white p-4 shadow-sm">
    <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">New draft</p><h2 className="text-xl font-bold">Create a reusable template</h2><p className="mt-1 text-sm text-slate-600">Start with the full Adventure Zone design or a blank visual email.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-bold">Template name<input value={template.name} placeholder="Proposal follow-up" onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} /></label>
      <label className="grid gap-1 text-sm font-bold">Template code<input value={template.code} placeholder="proposal_follow_up" onChange={(event) => onChange((current) => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_") }))} /></label>
      <label className="grid gap-1 text-sm font-bold">Category<input value={template.category} onChange={(event) => onChange((current) => ({ ...current, category: event.target.value }))} /></label>
      <label className="grid gap-1 text-sm font-bold">Channel<select value={template.channel} onChange={(event) => onChange((current) => ({ ...current, channel: event.target.value as NewTemplate["channel"] }))}><option value="email">Email</option><option value="internal_email">Internal email</option></select></label>
    </div>
    <label className="grid gap-1 text-sm font-bold">Subject<input value={template.subjectTemplate} placeholder="A note for {{contactName}}" onChange={(event) => onChange((current) => ({ ...current, subjectTemplate: event.target.value }))} /></label>
    <div className="flex flex-wrap gap-2 rounded-xl border bg-slate-50 p-3"><span className="mr-2 self-center text-sm font-bold">Start from</span><button className="button-secondary" type="button" onClick={() => onChange((current) => ({ ...current, editorDocument: createBrandedStarterDocument() }))}>Adventure Zone branded</button><button className="button-secondary" type="button" onClick={() => onChange((current) => ({ ...current, editorDocument: createBlankEmailDocument() }))}>Blank visual email</button></div>
    <EmailBuilder key={template.editorDocument.blocks[0]?.id} value={template.editorDocument} onChange={(editorDocument) => onChange((current) => current.editorDocument === editorDocument ? current : { ...current, editorDocument })} previewHtml={previewHtml} />
    <div><p className="text-sm font-bold">Required placeholders</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{placeholderTokens.map((token) => <label className="flex items-center gap-2 text-sm" key={token}><input type="checkbox" checked={template.requiredPlaceholders.includes(token)} onChange={(event) => onChange((current) => ({ ...current, requiredPlaceholders: event.target.checked ? [...current.requiredPlaceholders, token] : current.requiredPlaceholders.filter((item) => item !== token) }))} />{`{{${token}}}`}</label>)}</div></div>
    <div className="flex flex-wrap gap-2"><button className="button-primary" disabled={busy || !template.name.trim() || !template.code.trim()} type="button" onClick={onCreate}>{busy ? "Creating…" : "Create draft"}</button><button className="button-secondary" disabled={busy} type="button" onClick={onCancel}>Cancel</button></div>
  </section>;
}
