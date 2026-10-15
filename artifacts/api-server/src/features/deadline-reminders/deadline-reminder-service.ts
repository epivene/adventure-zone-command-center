import { pool } from "@workspace/db";

export const DEADLINE_KINDS = ["event", "vendor", "application", "balance", "next_action"] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export type ReminderAction = "notification" | "badge" | "next_action" | "email";
type Trigger =
  | { type: "deadline_days_away"; days: number[] }
  | { type: "deadline_passed" }
  | { type: "no_activity"; days: number }
  | { type: "status_changed" };
type Rule = { id: string; name: string; enabled: boolean; trigger: Trigger; actions: ReminderAction[] };
type Profile = {
  id: string; name: string; event_date: string | null; booking_event_date: string | null;
  vendor_deadline: string | null; application_deadline: string | null;
  balance_due_date: string | null; invoice_balance_due_date: string | null;
  next_action_date: string | null; opportunity_next_action_date: string | null;
  reminder_offsets: unknown; last_activity_date: string; status: string | null;
};
export type Deadline = { organizationId: string; profileName: string; kind: DeadlineKind; date: string; daysAway: number; offsets: number[] };
export type ReminderNotification = { key: string; organizationId: string; profileName: string; kind: string; dueDate: string | null; title: string; createdAt: string };

const dateColumns: Record<DeadlineKind, keyof Profile> = {
  event: "event_date", vendor: "vendor_deadline", application: "application_deadline",
  balance: "balance_due_date", next_action: "next_action_date",
};
const labels: Record<DeadlineKind, string> = {
  event: "Event date", vendor: "Vendor deadline", application: "Application deadline",
  balance: "Balance due", next_action: "Next action",
};
const dayMs = 86_400_000;
let running: Promise<void> | null = null;
let lastRun = 0;

function businessDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function dayNumber(value: string): number {
  return Math.floor(Date.parse(`${value}T12:00:00Z`) / dayMs);
}
function daysBetween(start: string, end: string): number {
  return dayNumber(end) - dayNumber(start);
}
function offsets(value: unknown, kind: DeadlineKind): number[] {
  const item = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[kind] : null;
  return Array.isArray(item) && item.every((number) => Number.isInteger(number) && number >= 0 && number <= 365)
    ? [...new Set(item as number[])].sort((a, b) => b - a) : [14, 7];
}

async function profiles(): Promise<Profile[]> {
  const result = await pool.query<Profile>(`
    SELECT o.id, o.name, o.event_date::text, o.vendor_deadline::text,
      o.application_deadline::text, o.balance_due_date::text, o.next_action_date::text,
      o.reminder_offsets,
      (SELECT min((b.starts_at AT TIME ZONE 'America/Denver')::date)::text FROM bookings b
       WHERE b.organization_id=o.id AND b.starts_at >= now() - interval '30 days'
         AND b.status NOT IN ('completed','cancelled','declined')) AS booking_event_date,
      (SELECT min(i.balance_due_date)::text FROM invoices i
       WHERE i.organization_id=o.id AND i.balance_due_date IS NOT NULL
         AND i.paid_at IS NULL AND i.cancelled_at IS NULL) AS invoice_balance_due_date,
      (SELECT min((bo.next_action_due_at AT TIME ZONE 'America/Denver')::date)::text
       FROM booking_opportunities bo WHERE bo.organization_id=o.id
         AND bo.status NOT IN ('not_pursuing','declined','cancelled','booked')) AS opportunity_next_action_date,
      GREATEST(o.created_at::date, COALESCE((SELECT max(a.occurred_at)::date FROM activities a
        WHERE a.organization_id=o.id AND a.deleted_at IS NULL), o.created_at::date))::text AS last_activity_date,
      (SELECT bo.status FROM booking_opportunities bo WHERE bo.organization_id=o.id
       ORDER BY bo.event_year DESC, bo.updated_at DESC LIMIT 1) AS status
    FROM organizations o WHERE o.consolidated_into_id IS NULL
  `);
  return result.rows;
}

function collectDates(rows: Profile[], today: string): Deadline[] {
  const items: Deadline[] = [];
  for (const row of rows) {
    for (const kind of DEADLINE_KINDS) {
      const native = kind === "event" ? row.booking_event_date
        : kind === "balance" ? row.invoice_balance_due_date
        : kind === "next_action" ? row.opportunity_next_action_date : null;
      const dates = [...new Set([native, row[dateColumns[kind]]].filter((date): date is string => typeof date === "string"))];
      for (const date of dates) {
        items.push({ organizationId: row.id, profileName: row.name, kind, date,
          daysAway: daysBetween(today, date), offsets: offsets(row.reminder_offsets, kind) });
      }
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.profileName.localeCompare(b.profileName));
}

export async function listRules(): Promise<Rule[]> {
  const result = await pool.query<Rule>("SELECT id,name,enabled,trigger,actions FROM reminder_rules ORDER BY created_at,id");
  return result.rows;
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<boolean> {
  const result = await pool.query("UPDATE reminder_rules SET enabled=$2,updated_at=now() WHERE id=$1 RETURNING id", [id, enabled]);
  lastRun = 0;
  return result.rowCount > 0;
}

async function upsertNotification(key: string, ruleId: string, row: Profile, kind: string, date: string | null, title: string): Promise<void> {
  await pool.query(`INSERT INTO reminder_notifications (key,rule_id,organization_id,kind,due_date,title)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO UPDATE SET
    title=EXCLUDED.title,due_date=EXCLUDED.due_date,active=true,updated_at=now()`,
    [key, ruleId, row.id, kind, date, title]);
}

export type EmailReminderSender = (notification: { key: string; profileId: string; title: string }) => Promise<void>;
let emailSender: EmailReminderSender | null = null;
export function configureEmailReminderSender(sender: EmailReminderSender): void { emailSender = sender; }

async function performActions(rule: Rule, key: string, row: Profile, kind: string, date: string | null, title: string, today: string): Promise<void> {
  if (rule.actions.includes("notification") || rule.actions.includes("badge")) {
    await upsertNotification(key, rule.id, row, kind, date, title);
  }
  if (rule.actions.includes("next_action")) {
    await pool.query(`UPDATE organizations SET next_action_date=$2::date,updated_at=now()
      WHERE id=$1 AND (next_action_date IS NULL OR next_action_date > $2::date)`, [row.id, date && date >= today ? date : today]);
  }
  // An adapter can be registered later. The Render flag is deliberately off by default.
  if (rule.actions.includes("email") && process.env.REMINDER_EMAIL_ENABLED === "true" && emailSender) {
    await emailSender({ key, profileId: row.id, title });
  }
}

async function evaluate(now: Date): Promise<void> {
  const today = businessDate(now);
  const [rows, rules] = await Promise.all([profiles(), listRules()]);
  const activeRules = rules.filter((rule) => rule.enabled);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const dates = collectDates(rows, today);
  await pool.query("UPDATE reminder_notifications SET active=false WHERE kind <> 'status_changed' AND active=true");
  for (const rule of activeRules) {
    const trigger = rule.trigger;
    if (trigger.type === "deadline_days_away" || trigger.type === "deadline_passed") {
      for (const date of dates) {
        const row = byId.get(date.organizationId)!;
        if (trigger.type === "deadline_days_away") {
          const days = Array.isArray(trigger.days) ? trigger.days : [];
          if (!date.offsets.includes(date.daysAway) || (rule.id !== "deadline_approaching" && !days.includes(date.daysAway))) continue;
          await performActions(rule, `${rule.id}:${row.id}:${date.kind}:${date.date}:${date.daysAway}`,
            row, date.kind, date.date, `${labels[date.kind]} in ${date.daysAway} days`, today);
        } else if (date.daysAway < 0) {
          await performActions(rule, `${rule.id}:${row.id}:${date.kind}:${date.date}`,
            row, date.kind, date.date, `${labels[date.kind]} is overdue`, today);
        }
      }
    } else if (trigger.type === "no_activity") {
      for (const row of rows) {
        if (!row.status || ["not_pursuing", "declined", "cancelled", "booked"].includes(row.status)) continue;
        const days = daysBetween(row.last_activity_date, today);
        if (days < trigger.days) continue;
        await performActions(rule, `${rule.id}:${row.id}`, row, "inactive", null,
          `No activity on ${row.name} for ${days} days`, today);
      }
    } else if (trigger.type === "status_changed") {
      for (const row of rows) {
        if (!row.status) continue;
        const prior = await pool.query<{ status: string }>("SELECT status FROM reminder_profile_status WHERE organization_id=$1", [row.id]);
        if (prior.rows[0] && prior.rows[0].status !== row.status) {
          await pool.query("UPDATE reminder_notifications SET active=false WHERE rule_id=$1 AND organization_id=$2 AND kind='status_changed'", [rule.id, row.id]);
          await performActions(rule, `${rule.id}:${row.id}:${row.status}`, row, "status_changed", null,
            `${row.name} status changed to ${row.status.replaceAll("_", " ")}`, today);
        }
      }
    }
  }
  await pool.query(`INSERT INTO reminder_profile_status (organization_id,status)
    SELECT id,status FROM (SELECT o.id,(SELECT bo.status FROM booking_opportunities bo
    WHERE bo.organization_id=o.id ORDER BY bo.event_year DESC,bo.updated_at DESC LIMIT 1) AS status
    FROM organizations o WHERE o.consolidated_into_id IS NULL) statuses WHERE status IS NOT NULL
    ON CONFLICT (organization_id) DO UPDATE SET status=EXCLUDED.status,observed_at=now()`);
}

export async function evaluateReminders(now = new Date(), force = false): Promise<void> {
  if (running) return running;
  if (!force && Date.now() - lastRun < 15 * 60_000) return;
  running = evaluate(now).then(() => { lastRun = Date.now(); }).finally(() => { running = null; });
  return running;
}

export async function getReminderOverview(now = new Date()): Promise<{ notifications: ReminderNotification[]; upcoming: Deadline[]; overdueCount: number; upcomingCount: number }> {
  await evaluateReminders(now);
  const today = businessDate(now);
  const [rows, notifications] = await Promise.all([
    profiles(),
    pool.query<ReminderNotification>(`SELECT n.key,n.organization_id AS "organizationId",o.name AS "profileName",
      n.kind,n.due_date::text AS "dueDate",n.title,n.created_at::text AS "createdAt"
      FROM reminder_notifications n JOIN organizations o ON o.id=n.organization_id
      JOIN reminder_rules r ON r.id=n.rule_id
      WHERE n.active AND r.enabled ORDER BY n.due_date NULLS LAST,n.created_at DESC LIMIT 200`),
  ]);
  const upcoming = collectDates(rows, today).filter((item) => item.daysAway >= 0 && item.daysAway <= 30);
  const overdueCount = notifications.rows.filter((item) => item.dueDate && item.dueDate < today).length;
  return { notifications: notifications.rows, upcoming, overdueCount, upcomingCount: upcoming.length };
}

export async function getProfileDates(id: string): Promise<{ dates: Record<DeadlineKind, string | null>; offsets: Record<string, number[]> } | null> {
  const result = await pool.query<Profile>(`SELECT event_date::text,vendor_deadline::text,application_deadline::text,
    balance_due_date::text,next_action_date::text,reminder_offsets FROM organizations WHERE id=$1`, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return { dates: Object.fromEntries(DEADLINE_KINDS.map((kind) => [kind, row[dateColumns[kind]]])) as Record<DeadlineKind, string | null>,
    offsets: Object.fromEntries(DEADLINE_KINDS.map((kind) => [kind, offsets(row.reminder_offsets, kind)])) };
}

export async function updateProfileDates(id: string, dates: Record<DeadlineKind, string | null>, reminderOffsets: Record<string, number[]>): Promise<boolean> {
  const result = await pool.query(`UPDATE organizations SET event_date=$2,vendor_deadline=$3,application_deadline=$4,
    balance_due_date=$5,next_action_date=$6,reminder_offsets=$7::jsonb,updated_at=now() WHERE id=$1 RETURNING id`,
    [id, dates.event, dates.vendor, dates.application, dates.balance, dates.next_action, JSON.stringify(reminderOffsets)]);
  lastRun = 0;
  return result.rowCount > 0;
}
