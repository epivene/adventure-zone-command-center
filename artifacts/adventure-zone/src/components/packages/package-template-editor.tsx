"use client";

import { useState, type FormEvent } from "react";

import {
  packageTemplateInputSchema,
  type PackageTemplateInput,
} from "@/features/packages/package-input";
import type { PackageTemplateSettingsRecord } from "@/features/packages/package-repository";

type EditorResult = { ok: true } | { ok: false; error: string };

function PackageTemplateForm({
  template,
  onSubmit,
}: {
  template: PackageTemplateSettingsRecord;
  onSubmit: (
    input: PackageTemplateInput,
  ) => Promise<EditorResult> | EditorResult;
}) {
  const [value, setValue] = useState<PackageTemplateInput>({
    id: template.id,
    name: template.name,
    baseAttractionCount: template.baseAttractionCount,
    active: template.active,
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = packageTemplateInputSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review this package.");
      setSaved(false);
      return;
    }

    setError("");
    setSaved(false);
    setIsSubmitting(true);
    try {
      const result = await onSubmit(parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setValue(parsed.data);
      setSaved(true);
      // Data re-fetches on navigation; no client-side refresh needed.
    } catch {
      setError("The package template could not be saved. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      aria-label={`Edit ${template.name} package`}
      className="grid gap-4 rounded-xl border border-slate-200 p-4"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm font-semibold">
          Stable code
          <input
            aria-label={`${template.name} stable code`}
            readOnly
            type="text"
            value={template.code}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-1 lg:col-span-2">
          Name
          <input
            aria-label={`${template.name} name`}
            onChange={(event) => {
              const name = event.currentTarget.value;
              setValue((current) => ({
                ...current,
                name,
              }));
              setSaved(false);
            }}
            type="text"
            value={value.name}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Base attraction count
          <input
            aria-label={`${template.name} base attraction count`}
            min={1}
            onChange={(event) => {
              const baseAttractionCount = Number(event.currentTarget.value);
              setValue((current) => ({
                ...current,
                baseAttractionCount,
              }));
              setSaved(false);
            }}
            step={1}
            type="number"
            value={value.baseAttractionCount}
          />
        </label>
      </div>

      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input
          aria-label={`${template.name} active`}
          checked={value.active}
          onChange={(event) => {
            const active = event.currentTarget.checked;
            setValue((current) => ({
              ...current,
              active,
            }));
            setSaved(false);
          }}
          type="checkbox"
        />
        Active package
      </label>

      {error ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {saved ? (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"
          role="status"
        >
          Package saved.
        </p>
      ) : null}

      <div>
        <button className="button-primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving…" : "Save package"}
        </button>
      </div>
    </form>
  );
}

export function PackageTemplateEditor({
  templates,
  onSubmit,
}: {
  templates: PackageTemplateSettingsRecord[];
  onSubmit: (
    input: PackageTemplateInput,
  ) => Promise<EditorResult> | EditorResult;
}) {
  return (
    <section
      aria-labelledby="package-template-editor-title"
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div>
        <h2 className="text-xl font-bold" id="package-template-editor-title">
          Package templates
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Update the name and base attraction count. Turn Active off to
          deactivate a package while preserving booking history.
        </p>
      </div>
      <div className="grid gap-4">
        {templates.map((template) => (
          <PackageTemplateForm
            key={template.id}
            onSubmit={onSubmit}
            template={template}
          />
        ))}
      </div>
    </section>
  );
}
