import { useMemo, useState } from "react";

import { ProtectedTemplateText } from "@/components/office/protected-template-text";
import {
  appendTemplateToken,
  officeTemplatePlaceholderLabels,
  officeTemplatePlaceholders,
  type OfficeTemplatePlaceholder,
} from "@/features/office/template-authoring";

export type OfficeTemplateEditorValue = {
  name: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
};

export function OfficeTemplateEditor({
  initialValue,
  previewValues = {},
  onSave,
  onCancel,
  saving = false,
}: {
  initialValue: OfficeTemplateEditorValue;
  previewValues?: Partial<Record<OfficeTemplatePlaceholder, string | null>>;
  onSave(value: OfficeTemplateEditorValue): void | Promise<void>;
  onCancel(): void;
  saving?: boolean;
}) {
  const [name, setName] = useState(initialValue.name);
  const [subjectTemplate, setSubjectTemplate] = useState(initialValue.subjectTemplate ?? "");
  const [bodyTemplate, setBodyTemplate] = useState(initialValue.bodyTemplate);

  function preview(value: string) {
    return value.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (whole, rawToken: string) => {
      const replacement = previewValues[rawToken as OfficeTemplatePlaceholder]?.trim();
      return replacement || whole;
    });
  }

  const renderedPreview = useMemo(() => ({
    subject: preview(subjectTemplate),
    body: preview(bodyTemplate),
  }), [subjectTemplate, bodyTemplate, previewValues]);

  function insert(token: OfficeTemplatePlaceholder, target: "subject" | "body") {
    if (target === "subject") setSubjectTemplate((current) => appendTemplateToken(current, token));
    else setBodyTemplate((current) => appendTemplateToken(current, token));
  }

  return (
    <section className="grid gap-4 rounded-xl border border-orange-200 bg-white p-4 shadow-sm" aria-label="Template editor">
      <div>
        <h3 className="text-lg font-bold">Save/Edit Template</h3>
        <p className="mt-1 text-sm text-slate-600">Protected fields stay linked to the current profile and contact when this template is used.</p>
      </div>

      <label className="grid gap-1 text-sm font-semibold">Template name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <ProtectedTemplateText label="Subject" value={subjectTemplate} onChange={setSubjectTemplate} />
      <ProtectedTemplateText label="Body" value={bodyTemplate} onChange={setBodyTemplate} multiline />

      <div>
        <p className="text-sm font-bold">Insert field</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {officeTemplatePlaceholders.map((token) => (
            <div className="inline-flex overflow-hidden rounded-full border border-slate-200" key={token}>
              <span className="bg-slate-50 px-2 py-1 text-xs font-semibold">{officeTemplatePlaceholderLabels[token]}</span>
              <button className="border-l px-2 py-1 text-xs" type="button" onClick={() => insert(token, "subject")}>Subject</button>
              <button className="border-l px-2 py-1 text-xs" type="button" onClick={() => insert(token, "body")}>Body</button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 p-3">
        <p className="text-sm font-bold">Preview</p>
        <p className="mt-2 text-sm font-semibold">{renderedPreview.subject || "(No subject)"}</p>
        <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{renderedPreview.body}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="button-primary" disabled={saving || !name.trim() || !bodyTemplate.trim()} type="button" onClick={() => void onSave({ name: name.trim(), subjectTemplate: subjectTemplate.trim() || null, bodyTemplate })}>{saving ? "Saving…" : "Save Template"}</button>
        <button className="button-secondary" disabled={saving} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
