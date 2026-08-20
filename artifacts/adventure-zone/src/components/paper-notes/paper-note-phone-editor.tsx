import type {
  PaperNoteReviewedPhone,
  PaperNoteSavedPhone,
} from "@/features/paper-notes/paper-note-review-types";

type PhoneConflict = {
  kind: "phone";
  fieldPath: string;
  decision:
    | "keep_saved"
    | "same_phone_update_details"
    | "add_alternate"
    | "replace_primary"
    | "inactivate_saved_add_paper"
    | "add_questionable"
    | "ignore_paper"
    | "crossed_out_note_only";
  existingPhoneId: string | null;
};

function normalized(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function exactSavedPhone(phone: PaperNoteReviewedPhone, saved: PaperNoteSavedPhone[]) {
  const paperNumber = normalized(phone.number);
  const extension = phone.extension?.trim() || "";
  return saved.find((candidate) =>
    normalized(candidate.number) === paperNumber
    && (candidate.extension?.trim() || "") === extension,
  ) ?? null;
}

export function PaperNotePhoneEditor({
  phone,
  path,
  prefix = "",
  savedPhones = [],
  conflict,
  requireDecision = false,
  allowPrimaryChoice = false,
  onChange,
  onConflict,
}: {
  phone: PaperNoteReviewedPhone;
  path: string;
  prefix?: string;
  savedPhones?: PaperNoteSavedPhone[];
  conflict?: unknown;
  requireDecision?: boolean;
  allowPrimaryChoice?: boolean;
  onChange(patch: Partial<PaperNoteReviewedPhone>): void;
  onConflict(value: PhoneConflict | null): void;
}) {
  const currentConflict = conflict && typeof conflict === "object" && (conflict as { kind?: unknown }).kind === "phone"
    ? conflict as PhoneConflict
    : null;
  const exact = exactSavedPhone(phone, savedPhones);
  const primary = savedPhones.find((saved) => saved.primary && saved.status === "active") ?? null;
  const defaultTarget = exact ?? primary ?? savedPhones[0] ?? null;
  const selectedExistingId = currentConflict?.existingPhoneId ?? defaultTarget?.id ?? null;

  function chooseDecision(decision: PhoneConflict["decision"] | "") {
    if (!decision) {
      onConflict(null);
      return;
    }
    const needsExisting = decision === "keep_saved"
      || decision === "same_phone_update_details"
      || decision === "inactivate_saved_add_paper";
    onConflict({
      kind: "phone",
      fieldPath: path,
      decision,
      existingPhoneId: needsExisting ? selectedExistingId : null,
    });
  }

  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        {prefix ? `${prefix} phone number` : "Phone number"}
        <input
          aria-label={prefix ? `${prefix} phone number` : "Phone number"}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          value={phone.number}
          onChange={(event) => onChange({ number: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        {prefix ? `${prefix} extension` : "Extension"}
        <input
          aria-label={prefix ? `${prefix} extension` : "Extension"}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          value={phone.extension ?? ""}
          onChange={(event) => onChange({ extension: event.target.value || null })}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Phone type
        <select
          aria-label={prefix ? `${prefix} phone type` : "Phone type"}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          value={phone.type}
          onChange={(event) => onChange({ type: event.target.value as PaperNoteReviewedPhone["type"] })}
        >
          <option value="office">Office</option>
          <option value="mobile">Mobile</option>
          <option value="alternate">Alternate</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Phone label
        <input
          aria-label={prefix ? `${prefix} phone label` : "Phone label"}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          value={phone.label ?? ""}
          onChange={(event) => onChange({ label: event.target.value || null })}
          placeholder="Main office, fair office, direct…"
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Phone status
        <select
          aria-label={prefix ? `${prefix} phone status` : "Phone status"}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          value={phone.status}
          onChange={(event) => onChange({ status: event.target.value as PaperNoteReviewedPhone["status"] })}
        >
          <option value="active">Active</option>
          <option value="questionable">Questionable / verify</option>
          <option value="inactive">Inactive / old</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">
        Calling instruction
        <input
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          value={phone.instructions ?? ""}
          onChange={(event) => onChange({ instructions: event.target.value || null })}
          placeholder="Ask for Tina, call main office, email only…"
        />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2">
        <input
          aria-label={prefix ? `${prefix} import as structured phone` : "Import as structured phone"}
          type="checkbox"
          checked={phone.importAsStructuredValue}
          onChange={(event) => {
            onChange({ importAsStructuredValue: event.target.checked });
            if (!event.target.checked) onConflict(null);
          }}
        />
        Import as structured phone
        <span className="font-normal text-slate-500">Uncheck to keep it only in the historical paper note.</span>
      </label>
      {allowPrimaryChoice && phone.importAsStructuredValue ? (
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2">
          <input
            aria-label={prefix ? `${prefix} primary phone` : "Primary phone"}
            type="checkbox"
            checked={phone.primary}
            onChange={(event) => onChange({ primary: event.target.checked })}
          />
          Primary phone for this {prefix ? "profile" : "contact"}
        </label>
      ) : null}
      {phone.crossedOut ? (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900 sm:col-span-2">
          Crossed out on the original paper. Nothing will be deactivated automatically.
        </p>
      ) : null}

      {phone.importAsStructuredValue && (requireDecision || savedPhones.length > 0) ? (
        <div className="grid gap-3 border-t border-slate-200 pt-3 sm:col-span-2">
          {savedPhones.length ? (
            <div className="rounded-lg bg-white p-3 text-sm text-slate-700">
              <p className="font-bold text-slate-900">Saved phone{savedPhones.length === 1 ? "" : "s"}</p>
              {savedPhones.map((saved) => (
                <p className="mt-1" key={saved.id}>
                  {saved.number}{saved.extension ? ` ext ${saved.extension}` : ""}
                  {saved.label ? ` · ${saved.label}` : ""} · {saved.status}{saved.primary ? " · primary" : ""}
                </p>
              ))}
            </div>
          ) : null}
          {savedPhones.length > 1 ? (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Saved phone involved
              <select
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
                value={selectedExistingId ?? ""}
                onChange={(event) => {
                  if (!currentConflict) return;
                  onConflict({
                    ...currentConflict,
                    existingPhoneId: event.target.value || null,
                  });
                }}
              >
                <option value="">None</option>
                {savedPhones.map((saved) => (
                  <option key={saved.id} value={saved.id}>{saved.number}{saved.extension ? ` ext ${saved.extension}` : ""}{saved.primary ? " · primary" : ""}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Phone decision
            <select
              aria-label={prefix ? `${prefix} phone decision` : "Phone decision"}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              value={currentConflict?.decision ?? ""}
              onChange={(event) => chooseDecision(event.target.value as PhoneConflict["decision"] | "")}
            >
              <option value="">Choose what to do…</option>
              {exact ? <option value="keep_saved">Same phone — keep saved value</option> : null}
              {exact ? <option value="same_phone_update_details">Same phone — update its label/type/instructions from paper</option> : null}
              <option value="add_alternate">Add paper phone as another number</option>
              <option value="replace_primary">Make paper phone the primary number</option>
              {savedPhones.length ? <option value="inactivate_saved_add_paper">Mark selected saved number inactive and add paper number</option> : null}
              <option value="add_questionable">Add paper phone as questionable / needs verification</option>
              <option value="ignore_paper">Ignore paper phone as structured data</option>
              {phone.crossedOut ? <option value="crossed_out_note_only">Crossed out — history only</option> : null}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
