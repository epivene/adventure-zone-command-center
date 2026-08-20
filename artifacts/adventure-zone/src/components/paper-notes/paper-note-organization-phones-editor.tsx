import { PaperNotePhoneEditor } from "./paper-note-phone-editor";
import type {
  PaperNoteReviewedPhone,
  PaperNoteSavedPhone,
} from "@/features/paper-notes/paper-note-review-types";

export function PaperNoteOrganizationPhonesEditor({
  phones,
  savedPhones,
  conflicts,
  requireDecision,
  onPhoneChange,
  onConflictChange,
}: {
  phones: PaperNoteReviewedPhone[];
  savedPhones: PaperNoteSavedPhone[];
  conflicts: Record<string, unknown>;
  requireDecision: boolean;
  onPhoneChange(index: number, patch: Partial<PaperNoteReviewedPhone>): void;
  onConflictChange(path: string, value: unknown | null): void;
}) {
  if (!phones.length) return null;
  return (
    <section className="mt-6 grid gap-3 border-t border-slate-200 pt-5">
      <div>
        <h3 className="font-bold text-slate-900">Organization / main office phones</h3>
        <p className="mt-1 text-sm text-slate-600">
          Use these for numbers that belong to the event, city/fair office, or department rather than a named person.
        </p>
      </div>
      {phones.map((phone, index) => (
        <PaperNotePhoneEditor
          key={phone.key}
          phone={phone}
          path={`organizationPhones.${index}`}
          prefix="Organization"
          savedPhones={savedPhones}
          conflict={conflicts[`organizationPhones.${index}`]}
          requireDecision={requireDecision}
          onChange={(patch) => onPhoneChange(index, patch)}
          onConflict={(value) => onConflictChange(`organizationPhones.${index}`, value)}
        />
      ))}
    </section>
  );
}
