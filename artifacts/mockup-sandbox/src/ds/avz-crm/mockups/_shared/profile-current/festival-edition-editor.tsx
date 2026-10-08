import { useState } from "react";
import type { FestivalEdition } from "./adapter";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/avz-crm/components/ui/accordion";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { apiFetch } from "./adapter";
import { editionGroups } from "./festival-edition-fields";

export function FestivalEditionEditor({ organizationId, edition, initialYear, onSaved, onCancel }: {
  organizationId: string; edition: FestivalEdition | null; initialYear: number;
  onSaved(value: FestivalEdition): void; onCancel(): void;
}) {
  const [year, setYear] = useState(String(edition?.year ?? initialYear));
  const [details, setDetails] = useState<Record<string, string>>({ ...(edition?.details ?? {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setConflict(false);
    try {
      const res = await apiFetch(`/event-profiles/${organizationId}/editions/${year}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ details, expectedUpdatedAt: edition?.updatedAt ?? null }),
      });
      const value = await res.json();
      setConflict(res.status === 409);
      if (!res.ok) throw new Error(value.error ?? "The event year could not be saved.");
      onSaved(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this event year."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="grid gap-4" aria-label="Festival year editor">
    <p className="text-sm text-muted-foreground">All event details are optional. These fields belong only to this festival year; organizer and booking information will not be replaced.</p>
    <div className="grid max-w-52 gap-1"><Label htmlFor="festival-year">Event year</Label>
      <Input id="festival-year" type="number" min={1900} max={2200} required value={year} disabled={busy || Boolean(edition)} onChange={event => setYear(event.target.value)} /></div>
    <Accordion type="multiple" defaultValue={[editionGroups[0]!.title]}>
      {editionGroups.map(group => <AccordionItem value={group.title} key={group.title}>
        <AccordionTrigger>{group.title}</AccordionTrigger>
        <AccordionContent><div className="grid gap-4 sm:grid-cols-2">
          {group.fields.map(field => <div className={`grid content-start gap-1 ${field.type === "long" ? "sm:col-span-2" : ""}`} key={field.key}>
            <Label htmlFor={`edition-${field.key}`}>{field.label}</Label>
            {field.type === "long"
              ? <Textarea id={`edition-${field.key}`} maxLength={4000} disabled={busy} value={details[field.key] ?? ""} onChange={event => setDetails(current => ({ ...current, [field.key]: event.target.value }))} />
              : <Input id={`edition-${field.key}`} type={field.type ?? "text"} maxLength={4000} disabled={busy} value={details[field.key] ?? ""} onChange={event => setDetails(current => ({ ...current, [field.key]: event.target.value }))} />}
          </div>)}
        </div></AccordionContent>
      </AccordionItem>)}
    </Accordion>
    {error ? <p role="alert" className="text-sm text-destructive">{error} Your entries are still here.</p> : null}
    {conflict ? <Button type="button" variant="outline" className="w-fit" disabled={busy} onClick={onCancel}>Reload saved details (discard draft)</Button> : null}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} type="submit">{busy ? "Saving…" : "Save event year"}</Button><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </form>;
}
