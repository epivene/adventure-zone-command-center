import { useState } from "react";

import type { GoogleWorkspaceScopePreview } from "@/features/google-workspace/google-workspace-client";

type Props = {
  preview: GoogleWorkspaceScopePreview;
  selectedLabelIds: string[];
  selectedCalendarIds: string[];
  onLabelChange(id: string, selected: boolean): void;
  onCalendarChange(id: string, selected: boolean): void;
};

function SelectionCard({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange(selected: boolean): void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <input
        checked={checked}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-slate-900">
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

function MissingSources({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        {title}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function GoogleScopePreview({
  preview,
  selectedLabelIds,
  selectedCalendarIds,
  onLabelChange,
  onCalendarChange,
}: Props) {
  const selectedLabels = new Set(selectedLabelIds);
  const selectedCalendars = new Set(selectedCalendarIds);
  const [showExcludedLabels, setShowExcludedLabels] = useState(false);
  const excludedLabels = preview.excludedLabels ?? [];

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Gmail labels</h3>
          <p className="mt-1 text-sm text-slate-600">
            Only these business labels and their saved descendants can enter the Command Center.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {preview.labels.map((label) => (
            <SelectionCard
              checked={selectedLabels.has(label.id)}
              description={
                label.id === label.rootId
                  ? "Business label root"
                  : `Under ${label.rootName}`
              }
              key={label.id}
              onChange={(selected) => onLabelChange(label.id, selected)}
              title={label.name}
            />
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {preview.excludedLabelCount} other Gmail labels not selected
            </p>
            {excludedLabels.length > 0 ? (
              <button
                aria-expanded={showExcludedLabels}
                className="text-xs font-semibold text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
                onClick={() => setShowExcludedLabels((current) => !current)}
                type="button"
              >
                {showExcludedLabels ? "Hide excluded labels" : "Review excluded labels"}
              </button>
            ) : null}
          </div>
          {showExcludedLabels ? (
            <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Read-only review. These labels are not being added to the approved Google scope.
              </p>
              <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2">
                {excludedLabels.map((label) => (
                  <li
                    className="rounded-md bg-white px-2.5 py-2 text-xs text-slate-700 shadow-sm dark:bg-slate-950/50 dark:text-slate-300"
                    key={label.id}
                  >
                    <span className="font-medium">{label.name}</span>
                    <span className="ml-1 text-slate-400">
                      ({label.type === "system" ? "Gmail system" : "custom"})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <MissingSources
          items={preview.missingLabelRoots}
          title="Expected business labels not found"
        />
      </section>

      <section className="grid gap-3 border-t border-slate-200 pt-5">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Google Calendars</h3>
          <p className="mt-1 text-sm text-slate-600">
            Each selected calendar stays separate, including the zone.pirate.warrior account calendar.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {preview.calendars.map((calendar) => (
            <SelectionCard
              checked={selectedCalendars.has(calendar.id)}
              description={calendar.primary ? "Primary calendar" : calendar.id}
              key={calendar.id}
              onChange={(selected) => onCalendarChange(calendar.id, selected)}
              title={calendar.summary}
            />
          ))}
        </div>
        <p className="text-xs font-medium text-slate-500">
          {preview.excludedCalendarCount} calendars excluded
        </p>
        <MissingSources
          items={preview.missingCalendars}
          title="Expected calendars not found"
        />
      </section>
    </div>
  );
}
