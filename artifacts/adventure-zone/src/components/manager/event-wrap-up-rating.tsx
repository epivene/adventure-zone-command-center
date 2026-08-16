export function EventWrapUpRating({ stars, notes, disabled, onStarsChange, onNotesChange }: {
  stars: number | null;
  notes: string;
  disabled?: boolean;
  onStarsChange: (stars: number) => void;
  onNotesChange: (notes: string) => void;
}) {
  return <section className="grid gap-3 rounded-xl border bg-white p-4">
    <div><h2 className="text-lg font-bold">How did it go?</h2><p className="text-sm text-slate-600">Give the event one overall rating and add anything worth remembering.</p></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Event rating">
      {[0,1,2,3,4,5].map((value) => <button key={value} type="button" aria-label={`${value} stars`} aria-pressed={stars === value} disabled={disabled} onClick={() => onStarsChange(value)} className={stars === value ? "button-primary px-3" : "button-secondary px-3"}>{value === 0 ? "0" : "★".repeat(value)}</button>)}
    </div>
    <label className="grid gap-1 text-sm font-semibold">Event notes<textarea aria-label="Event notes" rows={4} disabled={disabled} value={notes} onChange={(event) => onNotesChange(event.currentTarget.value)} placeholder="What should we remember about this event?" /></label>
  </section>;
}
