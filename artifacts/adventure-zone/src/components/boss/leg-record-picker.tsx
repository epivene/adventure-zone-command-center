import { Button } from "@workspace/avz-crm/components/ui/button";

export type LegOwnedRecord = {
  legId?: string | null;
  legName?: string | null;
};

export type LegRecordGroup = {
  key: string;
  name: string;
  count: number;
};

export const UNASSIGNED_LEG_KEY = "unassigned";

function legKey(record: LegOwnedRecord) {
  return record.legId ?? UNASSIGNED_LEG_KEY;
}

export function groupRecordsByLeg(records: LegOwnedRecord[]): LegRecordGroup[] {
  const grouped = new Map<string, LegRecordGroup>();

  for (const record of records) {
    const key = legKey(record);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    grouped.set(key, {
      key,
      name:
        key === UNASSIGNED_LEG_KEY
          ? "Unassigned"
          : record.legName?.trim() || "Unnamed leg",
      count: 1,
    });
  }

  const unassigned = grouped.get(UNASSIGNED_LEG_KEY);
  const assigned = Array.from(grouped.values()).filter(
    (group) => group.key !== UNASSIGNED_LEG_KEY,
  );
  return unassigned ? [...assigned, unassigned] : assigned;
}

export function recordsForLeg<T extends LegOwnedRecord>(
  records: T[],
  selectedLegKey: string | null,
): T[] {
  if (!selectedLegKey) return [];
  return records.filter((record) => legKey(record) === selectedLegKey);
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

type LegRecordPickerProps = {
  groups: LegRecordGroup[];
  noun: string;
  selectedLegKey: string | null;
  onSelect: (legKey: string | null) => void;
};

export function LegRecordPicker({
  groups,
  noun,
  selectedLegKey,
  onSelect,
}: LegRecordPickerProps) {
  const selected = groups.find((group) => group.key === selectedLegKey);

  if (selected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            Selected leg
          </p>
          <p className="mt-0.5 font-bold text-foreground">
            {selected.name} {noun}s
          </p>
          <p className="text-sm text-muted-foreground">
            {countLabel(selected.count, noun)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onSelect(null)}
        >
          Change leg
        </Button>
      </div>
    );
  }

  return (
    <section
      className="grid gap-3"
      aria-label={`Choose a leg to view ${noun}s`}
    >
      <p className="text-sm font-semibold text-foreground">
        Choose a leg to view {noun}s.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <Button
            key={group.key}
            type="button"
            variant="outline"
            className="h-auto justify-between rounded-xl px-4 py-3"
            aria-label={`${group.name}, ${countLabel(group.count, noun)}`}
            onClick={() => onSelect(group.key)}
          >
            <span className="font-semibold">{group.name}</span>
            <span className="text-xs text-muted-foreground">{group.count}</span>
          </Button>
        ))}
      </div>
    </section>
  );
}
