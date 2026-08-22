"use client";

import { useState, type FormEvent } from "react";

import {
  packageTemplateInputSchema,
  type PackageTemplateInput,
} from "@/features/packages/package-input";

type EditorResult = { ok: true } | { ok: false; error: string };

export type PackageTemplateSettingsRecord = {
  id: string;
  code: string;
  name: string;
  basePriceCents?: number | null;
  baseAttractionCount: number;
  minimumAttractionCount?: number;
  maximumAttractionCount?: number;
  baseDurationMinDays?: number | null;
  baseDurationMaxDays?: number | null;
  customerDescription?: string | null;
  bookingTalkingPoints?: string | null;
  operationalRequirements?: string | null;
  setupNotes?: string | null;
  knowledgeReviewNote?: string | null;
  active: boolean;
};

function dollarsForInput(cents: number | null): string {
  if (cents === null) return "";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

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
    basePriceCents: template.basePriceCents ?? null,
    baseAttractionCount: template.baseAttractionCount,
    minimumAttractionCount:
      template.minimumAttractionCount ?? template.baseAttractionCount,
    maximumAttractionCount:
      template.maximumAttractionCount ?? template.baseAttractionCount,
    baseDurationMinDays: template.baseDurationMinDays ?? null,
    baseDurationMaxDays: template.baseDurationMaxDays ?? null,
    customerDescription: template.customerDescription ?? null,
    bookingTalkingPoints: template.bookingTalkingPoints ?? null,
    operationalRequirements: template.operationalRequirements ?? null,
    setupNotes: template.setupNotes ?? null,
    knowledgeReviewNote: template.knowledgeReviewNote ?? null,
    active: template.active,
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update<K extends keyof PackageTemplateInput>(
    key: K,
    next: PackageTemplateInput[K],
  ) {
    setValue((current) => ({ ...current, [key]: next }));
    setSaved(false);
  }

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
            onChange={(event) => update("name", event.currentTarget.value)}
            type="text"
            value={value.name}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Base price ($)
          <input
            aria-label={`${template.name} base price`}
            min={0}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              update(
                "basePriceCents",
                raw === "" ? null : Math.round(Number(raw) * 100),
              );
            }}
            placeholder="Unknown"
            step="0.01"
            type="number"
            value={dollarsForInput(value.basePriceCents)}
          />
          <span className="text-xs font-normal text-slate-500">
            Editable starting price; leave blank if unknown.
          </span>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Suggested count
          <input
            aria-label={`${template.name} suggested attraction count`}
            min={1}
            onChange={(event) =>
              update("baseAttractionCount", Number(event.currentTarget.value))
            }
            step={1}
            type="number"
            value={value.baseAttractionCount}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Normal minimum
          <input
            aria-label={`${template.name} normal minimum`}
            min={1}
            onChange={(event) =>
              update("minimumAttractionCount", Number(event.currentTarget.value))
            }
            step={1}
            type="number"
            value={value.minimumAttractionCount}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Normal maximum
          <input
            aria-label={`${template.name} normal maximum`}
            min={1}
            onChange={(event) =>
              update("maximumAttractionCount", Number(event.currentTarget.value))
            }
            step={1}
            type="number"
            value={value.maximumAttractionCount}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Minimum duration (days)
          <input
            aria-label={`${template.name} minimum duration days`}
            min={1}
            max={31}
            onChange={(event) =>
              update(
                "baseDurationMinDays",
                event.currentTarget.value === ""
                  ? null
                  : Number(event.currentTarget.value),
              )
            }
            type="number"
            value={value.baseDurationMinDays ?? ""}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Maximum duration (days)
          <input
            aria-label={`${template.name} maximum duration days`}
            min={1}
            max={31}
            onChange={(event) =>
              update(
                "baseDurationMaxDays",
                event.currentTarget.value === ""
                  ? null
                  : Number(event.currentTarget.value),
              )
            }
            type="number"
            value={value.baseDurationMaxDays ?? ""}
          />
        </label>
      </div>

      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Prices, package sizes, and durations are starting points, not locked quotes. Bookings can still be customized for each event.
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Customer description
          <textarea
            onChange={(event) => update("customerDescription", event.currentTarget.value)}
            placeholder="How we describe this package to customers"
            rows={3}
            value={value.customerDescription ?? ""}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Booking talking points
          <textarea
            onChange={(event) => update("bookingTalkingPoints", event.currentTarget.value)}
            placeholder="Useful sales points, common fits, or questions to ask"
            rows={3}
            value={value.bookingTalkingPoints ?? ""}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Operational requirements
          <textarea
            onChange={(event) => update("operationalRequirements", event.currentTarget.value)}
            placeholder="Space, water, power, forklift, or site needs"
            rows={3}
            value={value.operationalRequirements ?? ""}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Setup notes
          <textarea
            onChange={(event) => update("setupNotes", event.currentTarget.value)}
            placeholder="Typical setup or teardown guidance"
            rows={3}
            value={value.setupNotes ?? ""}
          />
        </label>
      </div>

      <label className="grid gap-1 text-sm font-semibold">
        Owner review note
        <textarea
          aria-label={`${template.name} owner review note`}
          onChange={(event) => update("knowledgeReviewNote", event.currentTarget.value)}
          placeholder="Internal source conflict or fact that still needs confirmation"
          rows={2}
          value={value.knowledgeReviewNote ?? ""}
        />
        <span className="text-xs font-normal text-slate-500">
          Internal only. Do not copy unresolved source conflicts into customer-facing wording.
        </span>
      </label>

      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input
          aria-label={`${template.name} active`}
          checked={value.active}
          onChange={(event) => update("active", event.currentTarget.checked)}
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
          Set editable starting prices, normal package sizes, durations, and booking/setup knowledge in one place. Equipment remains editable for each event.
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
