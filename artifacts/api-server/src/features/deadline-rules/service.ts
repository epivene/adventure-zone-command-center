import { randomUUID } from "node:crypto";
import { businessDay, daysBetween, deadlineMatch, ruleSchema, type Rule } from "./model";
import { readDeadlines, type Query } from "./sources";
export type Database = Query & { connect(): Promise<Query & { release(destroy?: boolean): void }> };
export type EmailReminder = { idempotencyKey: string; organizationId: string; title: string; dueOn: string | null };
export interface ReminderEmailProvider { send(reminder: EmailReminder): Promise<void> }
export class DeadlineRulesService {
  constructor(private readonly db: Database, private readonly emailEnabled = false, private readonly emailProvider?: ReminderEmailProvider) {}
  async evaluate(now = new Date()) {
    const tx = await this.db.connect();
    let discard = false;
    try {
      await tx.query("BEGIN");
      // Cancel on the server before pg's 30s client timeout can abandon a query.
      // LOCAL keeps these limits scoped to reminder work, including pooled clients.
      await tx.query("SET LOCAL statement_timeout = '20s'");
      await tx.query("SET LOCAL lock_timeout = '3s'");
      await tx.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
      const locked = await tx.query("SELECT pg_try_advisory_xact_lock(81734, 141026) AS locked");
      if (!locked.rows[0]?.locked) { await tx.query("ROLLBACK"); return { skipped:true }; }
      const state = await tx.query("SELECT last_evaluated_at FROM deadline_evaluation_state WHERE id=1 FOR UPDATE");
      if (state.rows[0]?.last_evaluated_at && now.getTime()-new Date(state.rows[0].last_evaluated_at).getTime()<60000) {
        await tx.query("COMMIT"); return { skipped:true };
      }
      const rules: Rule[] = (await tx.query("SELECT * FROM deadline_rules WHERE enabled ORDER BY id")).rows
        .map(row=>({ ...row,...ruleSchema.parse({name:row.name,enabled:row.enabled,trigger:row.trigger,actions:row.actions}) }));
      const today = businessDay(now);
      const deadlines = await readDeadlines(tx);
      // Historical receipts remain; only current matches contribute to badges.
      await tx.query("UPDATE deadline_notifications SET active=false WHERE active");
      for (const rule of rules) {
        for (const item of deadlines) {
          const match = deadlineMatch(rule,item,today);
          if (match !== null) await this.record(tx,rule,`${item.sourceKey}:${item.dueOn}:${match}`,
            item.organizationId,`${item.label} — ${match==='overdue'?'overdue':'due '+item.dueOn}`,item.dueOn,today);
        }
        if (rule.trigger.type === "inactive") {
          const profiles = await tx.query(`
            WITH activity_by_profile AS MATERIALIZED (
              SELECT coalesce(a.organization_id,b.organization_id,c.organization_id) organization_id,
                max(coalesce(a.occurred_at,a.created_at)) last_activity FROM activities a
                LEFT JOIN bookings b ON b.id=a.booking_id LEFT JOIN contacts c ON c.id=a.contact_id
                WHERE a.deleted_at IS NULL AND a.kind::text<>'calendar'
                  AND coalesce(a.occurred_at,a.created_at)<=$1
                GROUP BY coalesce(a.organization_id,b.organization_id,c.organization_id)
            ), calls_by_profile AS MATERIALIZED (
              SELECT organization_id,max(coalesce(ended_at,started_at)) last_activity
              FROM call_sessions WHERE started_at<=$1 GROUP BY organization_id
            )
            SELECT o.id,o.name,greatest(o.created_at,a.last_activity,c.last_activity) last_activity
            FROM organizations o
            LEFT JOIN activity_by_profile a ON a.organization_id=o.id
            LEFT JOIN calls_by_profile c ON c.organization_id=o.id
            WHERE o.consolidated_into_id IS NULL
              AND (NOT EXISTS(SELECT 1 FROM bookings b WHERE b.organization_id=o.id)
                OR EXISTS(SELECT 1 FROM bookings b WHERE b.organization_id=o.id AND b.status::text IN
                  ('new_lead','researching','contact_due','contacted','interested','possible','unlikely','quote_sent','pending_decision','pending_contract','renewal_due')))
              AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.organization_id=o.id
                AND (b.status::text IN ('confirmed','contract_received') OR (b.probability::text='definite' AND b.status::text NOT IN ('cancelled','declined','completed'))))
          `,[now]);
          for (const p of profiles.rows) {
            const last = new Date(p.last_activity);
            if (daysBetween(businessDay(last),today) >= rule.trigger.days)
              await this.record(tx,rule,`inactive:${p.id}:${last.toISOString()}:${rule.trigger.days}`,p.id,
                `No activity for ${rule.trigger.days} days`,null,today);
          }
        }
        if (rule.trigger.type === "status_changed") {
          const changes = await tx.query(`SELECT e.* FROM deadline_status_events e JOIN organizations o ON o.id=e.organization_id
            WHERE e.occurred_at >= $1 AND e.occurred_at <= $2 AND o.consolidated_into_id IS NULL
              AND ($3::text IS NULL OR e.new_status=$3)`,[(rule as Rule & {updated_at?:string}).updated_at??rule.created_at,now,rule.trigger.status??null]);
          for (const event of changes.rows) await this.record(tx,rule,`status:${event.id}`,event.organization_id,
            `Status changed: ${event.old_status} → ${event.new_status}`,null,today);
        }
      }
      // Retire only next actions owned by this engine when their condition is no longer active.
      await tx.query(`UPDATE follow_ups f SET completed_at=$1,outcome='Reminder condition no longer active',updated_at=$1
        FROM deadline_notifications n WHERE n.follow_up_id=f.id AND NOT n.active AND f.completed_at IS NULL`,[now]);
      await tx.query("UPDATE deadline_evaluation_state SET last_evaluated_at=$1 WHERE id=1",[now]);
      await tx.query("COMMIT");
      return { skipped:false };
    } catch(error) {
      // A client read timeout does not cancel the server query. A queued rollback
      // can time out too; closing the connection rolls back the transaction.
      discard = error instanceof Error && error.message === "Query read timeout";
      if (!discard) {
        try { await tx.query("ROLLBACK"); }
        catch { discard = true; }
      }
      throw error;
    }
    finally { tx.release(discard); }
  }
  private async record(tx: Query, rule: Rule, key: string, profile: string, title: string, due: string|null, today: string) {
    const result = await tx.query(`INSERT INTO deadline_notifications(rule_id,occurrence_key,organization_id,title,due_on,email_state)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(rule_id,occurrence_key) DO UPDATE SET active=true,title=excluded.title
      RETURNING *`,[rule.id,key,profile,title,due,rule.actions.includes("email")?(this.emailEnabled?(this.emailProvider?"pending":"provider_not_configured"):"disabled"):"not_requested"]);
    const receipt=result.rows[0];
    if (rule.actions.includes("next_action") && receipt.follow_up_id && !receipt.dismissed_at) {
      await tx.query("UPDATE follow_ups SET kind=$2,updated_at=now() WHERE id=$1 AND completed_at IS NULL AND kind IS DISTINCT FROM $2",[receipt.follow_up_id,title]);
    }
    if (rule.actions.includes("next_action") && !receipt.follow_up_id && !receipt.dismissed_at) {
      const id=randomUUID();
      await tx.query(`INSERT INTO follow_ups(id,organization_id,kind,due_at) VALUES($1,$2,$3,($4::date+time '09:00') AT TIME ZONE 'America/Denver')`,
        [id,profile,title,due && due<today?today:due??today]);
      await tx.query("UPDATE deadline_notifications SET follow_up_id=$2 WHERE id=$1",[receipt.id,id]);
    }
  }
  // Explicit future integration hook. No provider is constructed or configured here.
  // Provider implementations must honor idempotencyKey; never send to a prospect implicitly.
  async deliverEmail(reminder: EmailReminder) {
    if (!this.emailEnabled) return { state:"disabled" };
    if (!this.emailProvider) return { state:"provider_not_configured" };
    await this.emailProvider.send(reminder);
    return { state:"sent" };
  }
  async dispatchEmailHooks() {
    if (!this.emailEnabled || !this.emailProvider) return;
    const items=await this.db.query(`SELECT n.* FROM deadline_notifications n JOIN deadline_rules r ON r.id=n.rule_id
      WHERE n.active AND n.dismissed_at IS NULL AND r.enabled AND n.email_state='pending' ORDER BY n.created_at LIMIT 25`);
    for(const item of items.rows) {
      const claimed=await this.db.query("UPDATE deadline_notifications SET email_state='sending' WHERE id=$1 AND email_state='pending' RETURNING id",[item.id]);
      if(!claimed.rows.length)continue;
      try {
        await this.deliverEmail({idempotencyKey:item.id,organizationId:item.organization_id,title:item.title,dueOn:item.due_on});
        await this.db.query("UPDATE deadline_notifications SET email_state='sent' WHERE id=$1",[item.id]);
      }catch{
        // Do not blindly retry an uncertain delivery.
        await this.db.query("UPDATE deadline_notifications SET email_state='delivery_uncertain' WHERE id=$1",[item.id]);
      }
    }
  }
  async summary() {
    const today=businessDay(new Date());
    const items=(await readDeadlines(this.db)).filter(d=>!d.completed && d.dueOn && daysBetween(today,d.dueOn)>=0 && daysBetween(today,d.dueOn)<=30)
      .sort((a,b)=>a.dueOn!.localeCompare(b.dueOn!) || a.profileName.localeCompare(b.profileName));
    const notices=await this.db.query(`SELECT n.id,n.organization_id AS "organizationId",o.name AS "profileName",n.title,
      n.due_on::text AS "dueOn",r.actions,n.email_state AS "emailState"
      FROM deadline_notifications n JOIN organizations o ON o.id=n.organization_id JOIN deadline_rules r ON r.id=n.rule_id
      WHERE n.active AND n.dismissed_at IS NULL AND r.enabled AND o.consolidated_into_id IS NULL
      ORDER BY n.due_on NULLS LAST,n.created_at DESC`);
    const state=await this.db.query("SELECT last_evaluated_at FROM deadline_evaluation_state WHERE id=1");
    return { upcoming:items,notifications:notices.rows.filter(n=>n.actions.includes("notify")||n.actions.includes("badge")),
      count:notices.rows.filter(n=>n.actions.includes("badge")).length,lastEvaluatedAt:state.rows[0]?.last_evaluated_at??null };
  }
}
