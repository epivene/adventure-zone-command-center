import { day, type Deadline } from "./model";
export type Query = { query(text: string, values?: any[]): Promise<{ rows: any[] }> };
const dateKey = (value: unknown) => {
  const text = value instanceof Date ? value.toISOString().slice(0,10) : String(value ?? "").slice(0,10);
  return day.safeParse(text).success ? text : null;
};
export async function readDeadlines(db: Query, profileId?: string): Promise<Deadline[]> {
  const result = await db.query(`
    SELECT 'custom:'||d.id source_key,d.organization_id,d.kind,d.label,d.due_on::text,true editable
    FROM profile_deadlines d
    UNION ALL SELECT 'application:'||o.id,o.id,'application','Application deadline',o.application_deadline::text,true
    FROM organizations o
    UNION ALL SELECT 'booking:'||b.id,b.organization_id,'event',b.name||' — event',
      ((booking_date_endpoint(b.id,'public_start',b.starts_at)->>'value')::timestamptz AT TIME ZONE 'America/Denver')::date::text,false
    FROM bookings b WHERE b.organization_id IS NOT NULL AND b.status::text NOT IN ('cancelled','declined','completed')
    UNION ALL SELECT 'fact:'||f.id,f.organization_id,'event','Event date ('||f.status||')',f.starts_on::text,false
    FROM event_date_facts f WHERE f.active AND f.status IN ('confirmed','expected')
      AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.organization_id=f.organization_id AND b.status::text NOT IN ('cancelled','declined','completed')
        AND ((booking_date_endpoint(b.id,'public_start',b.starts_at)->>'value')::timestamptz AT TIME ZONE 'America/Denver')::date=f.starts_on)
    UNION ALL SELECT 'invoice:'||i.id,i.organization_id,'balance_due','Invoice '||i.invoice_number||' — balance due',i.balance_due_date::text,false
    FROM invoices i WHERE i.status NOT IN ('draft','paid','cancelled') AND i.cancelled_at IS NULL
    UNION ALL SELECT 'followup:'||f.id,coalesce(f.organization_id,b.organization_id,c.organization_id),'next_action',f.kind,
      (f.due_at AT TIME ZONE 'America/Denver')::date::text,false
    FROM follow_ups f LEFT JOIN bookings b ON b.id=f.booking_id LEFT JOIN contacts c ON c.id=f.contact_id
    WHERE f.completed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM deadline_notifications n WHERE n.follow_up_id=f.id)
  `);
  const profiles = await db.query("SELECT id,name FROM organizations WHERE consolidated_into_id IS NULL");
  const names = new Map(profiles.rows.map(p=>[p.id,p.name]));
  const preferences = await db.query("SELECT source_key,reminder_offsets,completed_for_date::text FROM deadline_preferences");
  const prefs = new Map(preferences.rows.map(p=>[p.source_key,p]));
  const rows = [...result.rows];
  const editions = await db.query("SELECT id,organization_id,year,details FROM festival_editions");
  for (const edition of editions.rows) {
    for (const [field,kind,label] of [
      ["startsOn","event","Event date"],["applicationDeadline","application","Application deadline"],
      ["foodDeadline","vendor","Food vendor deadline"],["performanceDeadline","application","Performer application deadline"],
    ]) {
      const value = dateKey(edition.details?.[field]);
      if (!value || rows.some(row=>row.organization_id===edition.organization_id && row.kind===kind && dateKey(row.due_on)===value)) continue;
      rows.push({ source_key:`edition:${edition.id}:${field}`,organization_id:edition.organization_id,kind,label:`${edition.year} — ${label}`,due_on:value,editable:false });
    }
  }
  return rows.filter(row=>names.has(row.organization_id) && (!profileId || row.organization_id===profileId)).map(row=>{
    const pref = prefs.get(row.source_key);
    const dueOn = dateKey(row.due_on);
    return { sourceKey:row.source_key,organizationId:row.organization_id,profileName:names.get(row.organization_id),
      kind:row.kind,label:row.label,dueOn,editable:row.editable,
      offsets:pref?.reminder_offsets ?? null,completed:Boolean(dueOn && pref?.completed_for_date===dueOn) };
  });
}
