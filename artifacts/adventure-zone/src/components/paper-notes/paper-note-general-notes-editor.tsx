export function PaperNoteGeneralNotesEditor({
  notes,
  onChange,
}: {
  notes: string[];
  onChange(index: number, value: string): void;
}) {
  if (!notes.length) return null;

  return (
    <section className="mt-6 grid gap-3 border-t border-slate-200 pt-5">
      <div>
        <h3 className="font-bold text-slate-900">Other notes from paper</h3>
        <p className="mt-1 text-sm text-slate-600">
          These lines will be included in the imported historical note. Correct anything the handwriting reader got wrong.
        </p>
      </div>
      {notes.map((note, index) => (
        <label className="grid gap-1 text-sm font-semibold text-slate-700" key={index}>
          Other paper note {index + 1}
          <textarea
            aria-label={`Other paper note ${index + 1}`}
            className="min-h-20 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
            value={note}
            onChange={(event) => onChange(index, event.target.value)}
          />
        </label>
      ))}
    </section>
  );
}
