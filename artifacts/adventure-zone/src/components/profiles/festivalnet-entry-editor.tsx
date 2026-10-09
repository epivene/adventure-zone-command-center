import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@workspace/avz-crm/components/ui/radio-group";
import type { FestivalNetDraft as Draft, FestivalNetPreview as Preview } from "@workspace/api-client-react";
import { editionGroups } from "./festival-edition-fields";

const topFields = [
  ["city", "City"], ["region", "State / region"], ["address1", "Address"], ["postalCode", "Postal code"],
  ["phone", "Phone"], ["website", "Website"], ["contactName", "Contact name"],
  ["contactEmail", "Contact email"], ["contactPhone", "Contact phone"],
] as const;
const fieldLabels: Record<string, string> = {
  name: "Name", year: "Year", sourceUrl: "FestivalNet link", sourceFilename: "Source file", importFileSha256: "Source fingerprint",
  ...Object.fromEntries(topFields),
  ...Object.fromEntries(editionGroups.flatMap(group => group.fields.map(field => [field.key, field.label]))),
};
export function fieldLabel(key: string): string {
  const bare = key.replace(/^details\./, "");
  return fieldLabels[bare] ?? bare.replace(/([A-Z])/g, " $1").replace(/^./, character => character.toUpperCase());
}
export function cleanDraft(draft: Draft): Draft {
  const clean = { ...draft, name: draft.name.trim(), details: {} } as Draft;
  for (const [key] of topFields) {
    const value = draft[key]?.trim();
    if (value) clean[key] = value; else delete clean[key];
  }
  for (const [key, value] of Object.entries(draft.details)) if (value.trim()) clean.details[key] = value.trim();
  return clean;
}

export function FestivalNetEntryEditor({ preview, draft, target, disabled, onDraft, onTarget }: {
  preview: Preview; draft: Draft; target: string | null; disabled: boolean;
  onDraft(draft: Draft): void; onTarget(target: string): void;
}) {
  const candidate = preview.candidates.find(candidate => candidate.id === target);
  const incoming: Record<string, string> = {
    ...draft.details, name: draft.name, sourceUrl: draft.sourceUrl, sourceFilename: draft.sourceFilename,
  };
  for (const [key] of topFields) if (draft[key]) incoming[key] = draft[key]!;
  const saved = candidate ? { ...candidate.existingFields, ...(draft.year === preview.draft.year ? candidate.details : {}) } : {};
  const conflicts = Object.entries(saved).filter(([key, value]) => value && incoming[key] && value.trim() !== incoming[key].trim());
  const detailKeys = new Set(Object.keys(draft.details).filter(key => key !== "importFileSha256"));
  const known = new Set(editionGroups.flatMap(group => group.fields.map(field => field.key)));
  const groups = [
    ...editionGroups.map(group => ({ title: group.title, keys: group.fields.map(field => field.key).filter(key => detailKeys.has(key)) })),
    { title: "Other details", keys: [...detailKeys].filter(key => !known.has(key)) },
  ].filter(group => group.keys.length);
  const yearOk = Number.isInteger(draft.year) && draft.year >= 1900 && draft.year <= 2200;
  return <section className="grid gap-4 rounded-md border p-3" aria-label={`Edit ${draft.sourceFilename}`}>
    <h3 className="text-sm font-semibold">Review: {draft.sourceFilename}</h3>
    {preview.warnings.length > 0 && <Alert data-testid="list-festivalnet-warnings">
      <AlertTitle>Review before importing</AlertTitle>
      <AlertDescription><ul className="grid gap-1 text-sm">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></AlertDescription>
    </Alert>}
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">Save to</legend>
      {preview.candidates.length ? <>
        <RadioGroup value={target ?? ""} onValueChange={onTarget} disabled={disabled} aria-label="Existing profile">
          {preview.candidates.map(candidate => <label key={candidate.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
            <RadioGroupItem value={candidate.id} className="mt-1" data-testid={`radio-target-${candidate.id}`} />
            <span>{candidate.name} <span className="text-muted-foreground">{[candidate.city, candidate.region].filter(Boolean).join(", ")}</span></span>
          </label>)}
        </RadioGroup>
        <p className="text-sm text-muted-foreground">Possible matches found. Choose the profile to update.</p>
      </> : <p className="text-sm text-muted-foreground">No matching profile found. A new profile will be created.</p>}
      {draft.year !== preview.draft.year && <p className="text-sm text-muted-foreground">Year changed. Use “Recheck matches” to see saved details for this year.</p>}
    </fieldset>
    {conflicts.length > 0 && <div className="rounded-md border p-3 text-sm" data-testid="list-festivalnet-conflicts">
      <p className="mb-2 font-semibold">Already saved — these stay as they are</p>
      <ul className="grid gap-2">{conflicts.map(([key, value]) => <li key={key}>
        <span className="font-semibold">{fieldLabel(key)}</span>
        <div className="text-muted-foreground">Saved: {value}</div>
        <div className="text-muted-foreground">Incoming (ignored): {incoming[key]}</div>
      </li>)}</ul>
    </div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1"><Label htmlFor="fn-name">Name</Label>
        <Input id="fn-name" value={draft.name} aria-invalid={!draft.name.trim()} disabled={disabled} onChange={event => onDraft({ ...draft, name: event.target.value })} /></div>
      <div className="grid gap-1"><Label htmlFor="fn-year">Year</Label>
        <Input id="fn-year" type="number" value={Number.isFinite(draft.year) ? draft.year : ""} aria-invalid={!yearOk} disabled={disabled}
          onChange={event => onDraft({ ...draft, year: event.target.value === "" ? NaN : Number(event.target.value) })} /></div>
      {topFields.map(([key, label]) => <div className="grid gap-1" key={key}>
        <Label htmlFor={`fn-${key}`}>{label} <span className="text-muted-foreground">(optional)</span></Label>
        <Input id={`fn-${key}`} value={draft[key] ?? ""} disabled={disabled} onChange={event => onDraft({ ...draft, [key]: event.target.value })} />
      </div>)}
      <div className="grid gap-1 sm:col-span-2"><Label htmlFor="fn-source">Source (read-only)</Label>
        <Input id="fn-source" readOnly value={draft.sourceUrl} /></div>
    </div>
    {groups.map(group => <section key={group.title} className="grid gap-2">
      <h4 className="text-sm font-semibold">{group.title}</h4>
      <div className="grid gap-3 sm:grid-cols-2">{group.keys.map(key => <div key={key} className="grid gap-1">
        <Label htmlFor={`fn-d-${key}`}>{fieldLabel(key)}</Label>
        <Input id={`fn-d-${key}`} value={draft.details[key] ?? ""} disabled={disabled}
          onChange={event => onDraft({ ...draft, details: { ...draft.details, [key]: event.target.value } })} />
      </div>)}</div>
    </section>)}
    <p className="text-sm text-muted-foreground">Clear any optional value to leave it out of the import.</p>
  </section>;
}
