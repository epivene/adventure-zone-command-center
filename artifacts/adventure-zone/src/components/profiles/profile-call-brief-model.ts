export type CallBriefProfile = {
  id: string;
  contacts: Array<{ id: string; name: string; role?: string | null; isPrimary?: boolean; phone?: string | null; email?: string | null }>;
  bookings: Array<{ id: string; name: string; startsAt: Date | string | null; endsAt?: Date | string | null; status: string }>;
  effectiveEventDate?: { startsOn: string; endsOn: string | null; displayStatus: string; sourceId: string } | null;
  notes?: Array<{ id: string; kind?: string; body: string; occurredAt: Date | string }>;
  followUps?: Array<{ kind: string; dueAt: Date | string; completedAt: Date | string | null }>;
  decisionSummary?: { nextActionKind?: string | null; nextActionDueAt?: Date | string | null };
};
export function briefTime(value: Date | string | null | undefined): number {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}
export function projectCallBrief(profile: CallBriefProfile, year: number) {
  const contact = profile.contacts.find(item => item.isPrimary) ?? profile.contacts[0] ?? null;
  const bookings = profile.bookings.filter(item => item.startsAt && new Date(item.startsAt).getUTCFullYear() === year)
    .sort((a, b) => Number(["cancelled", "declined"].includes(a.status)) - Number(["cancelled", "declined"].includes(b.status)) || briefTime(a.startsAt) - briefTime(b.startsAt));
  const discussion = (profile.notes ?? []).filter(item => ["call", "phone_call", "email", "meeting"].includes(item.kind ?? "") && item.body.trim())
    .sort((a, b) => briefTime(b.occurredAt) - briefTime(a.occurredAt))[0] ?? null;
  const followUp = (profile.followUps ?? []).filter(item => !item.completedAt).sort((a, b) => briefTime(a.dueAt) - briefTime(b.dueAt))[0] ?? null;
  const nextAction = profile.decisionSummary?.nextActionKind
    ? { kind: profile.decisionSummary.nextActionKind, dueAt: profile.decisionSummary.nextActionDueAt }
    : followUp;
  const date = profile.effectiveEventDate?.startsOn.startsWith(String(year)) ? profile.effectiveEventDate : null;
  return { contact, bookings, discussion, nextAction, date };
}
