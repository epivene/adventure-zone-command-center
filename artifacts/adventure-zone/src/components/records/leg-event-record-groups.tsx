import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

export type LegEventOwnedRecord = {
  id?: string;
  legId?: string | null;
  legName?: string | null;
  bookingId?: string | null;
  bookingName?: string | null;
  eventName?: string | null;
  title?: string | null;
};

type EventRecordGroup<T> = { key: string; name: string; records: T[] };
type LegEventRecordGroup<T> = {
  key: string;
  name: string;
  records: T[];
  events: EventRecordGroup<T>[];
};

const UNASSIGNED_LEG_KEY = "unassigned-leg";
const UNASSIGNED_EVENT_KEY = "unassigned-event";

function labelCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function eventName(record: LegEventOwnedRecord) {
  if (!record.bookingId) return "Unassigned event";
  return record.bookingName?.trim()
    || record.eventName?.trim()
    || record.title?.trim()
    || "Unnamed event";
}

function eventKey(record: LegEventOwnedRecord) {
  return record.bookingId ? `booking:${record.bookingId}` : UNASSIGNED_EVENT_KEY;
}

export function groupRecordsByEvent<T extends LegEventOwnedRecord>(
  records: T[],
): EventRecordGroup<T>[] {
  const groups = new Map<string, EventRecordGroup<T>>();
  for (const record of records) {
    const key = eventKey(record);
    const existing = groups.get(key);
    if (existing) existing.records.push(record);
    else groups.set(key, { key, name: eventName(record), records: [record] });
  }
  const unassigned = groups.get(UNASSIGNED_EVENT_KEY);
  const assigned = Array.from(groups.values()).filter(
    (group) => group.key !== UNASSIGNED_EVENT_KEY,
  );
  return unassigned ? [...assigned, unassigned] : assigned;
}

export function groupRecordsByLegAndEvent<T extends LegEventOwnedRecord>(
  records: T[],
): LegEventRecordGroup<T>[] {
  const legs = new Map<string, { key: string; name: string; records: T[] }>();
  for (const record of records) {
    const legSnapshot = record.legName?.trim();
    const key = record.legId ?? UNASSIGNED_LEG_KEY;
    const existing = legs.get(key);
    if (existing) existing.records.push(record);
    else legs.set(key, {
      key,
      name: key === UNASSIGNED_LEG_KEY
        ? "Unassigned leg"
        : legSnapshot || "Unnamed leg",
      records: [record],
    });
  }
  const grouped = Array.from(legs.values()).map((leg) => ({
    ...leg,
    events: groupRecordsByEvent(leg.records),
  }));
  const unassigned = grouped.find((leg) => leg.key === UNASSIGNED_LEG_KEY);
  const assigned = grouped.filter((leg) => leg.key !== UNASSIGNED_LEG_KEY);
  return unassigned ? [...assigned, unassigned] : assigned;
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function EventRecordGroups<T extends LegEventOwnedRecord>({
  records,
  noun,
  openBookingId,
  children,
}: {
  records: T[];
  noun: string;
  openBookingId?: string | null;
  children: (record: T, index: number) => ReactNode;
}) {
  const groups = useMemo(() => groupRecordsByEvent(records), [records]);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(openBookingId ? [`booking:${openBookingId}`] : []),
  );
  const prefix = useId();

  useEffect(() => {
    if (!openBookingId) return;
    const key = `booking:${openBookingId}`;
    setOpen((current) => {
      if (current.has(key)) return current;
      return new Set(current).add(key);
    });
  }, [openBookingId]);

  return <div className="grid gap-3">
    {groups.map((group) => {
      const expanded = open.has(group.key);
      const panelId = `${safeId(prefix)}-event-${safeId(group.key)}`;
      return <section className="overflow-hidden rounded-xl border border-border bg-card" key={group.key}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${group.name}, ${labelCount(group.records.length, noun)}`}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
          onClick={() => setOpen((current) => {
            const next = new Set(current);
            if (expanded) next.delete(group.key); else next.add(group.key);
            return next;
          })}
        >
          <span className="font-bold text-foreground">{group.name}</span>
          <span className="text-sm text-muted-foreground">{labelCount(group.records.length, noun)}</span>
        </button>
        {expanded ? <div className="grid gap-3 border-t border-border p-3" id={panelId}>
          {group.records.map(children)}
        </div> : null}
      </section>;
    })}
  </div>;
}

export function LegEventRecordGroups<T extends LegEventOwnedRecord>({
  records,
  noun,
  children,
}: {
  records: T[];
  noun: string;
  children: (record: T, index: number) => ReactNode;
}) {
  const groups = useMemo(() => groupRecordsByLegAndEvent(records), [records]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const prefix = useId();

  return <div className="grid gap-3">
    {groups.map((group) => {
      const expanded = open.has(group.key);
      const panelId = `${safeId(prefix)}-leg-${safeId(group.key)}`;
      return <section className="overflow-hidden rounded-xl border border-border bg-card" key={group.key}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${group.name}, ${labelCount(group.records.length, noun)}`}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
          onClick={() => setOpen((current) => {
            const next = new Set(current);
            if (expanded) next.delete(group.key); else next.add(group.key);
            return next;
          })}
        >
          <span className="font-bold text-foreground">{group.name}</span>
          <span className="text-sm text-muted-foreground">{labelCount(group.records.length, noun)}</span>
        </button>
        {expanded ? <div className="border-t border-border p-3" id={panelId}>
          <EventRecordGroups records={group.records} noun={noun}>{children}</EventRecordGroups>
        </div> : null}
      </section>;
    })}
  </div>;
}
