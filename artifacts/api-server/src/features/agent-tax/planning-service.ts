import type { Pool, PoolClient } from "pg";
import { TaxError, csvCell } from "./model";
import type { EstimateSettings, PayItemInput, PayPaymentInput } from "./planning-model";
import { calculateTax, taxSources, taxWarnings } from "./tax-calculator";

const itemSelect = `SELECT p.*,p.earned_date::text AS earned_text,p.due_date::text AS due_text,
  COALESCE((SELECT sum(amount_cents) FROM agent_tax_records WHERE pay_item_id=p.id),0)::bigint AS paid_cents
  FROM agent_pay_items p`;
type Row = Record<string,any>;
function presentItem(row:Row,payments:Row[]) {
  return {id:row.id,title:row.title,kind:row.kind,earnedDate:row.earned_text,dueDate:row.due_text,
    amountCents:Number(row.amount_cents),paidCents:Number(row.paid_cents),
    remainingCents:Number(row.amount_cents)-Number(row.paid_cents),notes:row.notes,revision:row.revision,
    createdAt:row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    payments:payments.map(p=>({id:p.id,title:p.title,amountCents:Number(p.amount_cents),recordDate:p.date_text,paymentMethod:p.payment_method}))};
}
export class AgentTaxPlanningService {
  constructor(private readonly pool:Pool) {}
  private async transaction<T>(action:(client:PoolClient)=>Promise<T>) {
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result=await action(client);
      await client.query("COMMIT");
      return result;
    } catch(error) {
      await client.query("ROLLBACK").catch(()=>undefined);
      if ((error as {code?:string}).code==="23505") throw new TaxError(409,"A weekly pay entry already exists for that date, or this payment was already recorded. Reload before retrying.");
      throw error;
    } finally {client.release();}
  }
  private async lock(client:PoolClient,id:string,revision:number|undefined) {
    const result=await client.query("SELECT * FROM agent_pay_items WHERE id=$1 FOR UPDATE",[id]);
    if (!result.rows[0]) throw new TaxError(404,"Pay entry not found.");
    if (revision!==undefined && result.rows[0].revision!==revision) throw new TaxError(409,"This pay entry changed. Reload it before saving again.");
    return result.rows[0];
  }
  async item(id:string) {
    const result=await this.pool.query(`${itemSelect} WHERE p.id=$1`,[id]);
    if (!result.rows[0]) throw new TaxError(404,"Pay entry not found.");
    const payments=await this.pool.query("SELECT id,title,amount_cents,record_date::text AS date_text,payment_method FROM agent_tax_records WHERE pay_item_id=$1 ORDER BY record_date,id",[id]);
    return presentItem(result.rows[0],payments.rows);
  }
  async list(page:number,limit:number) {
    const [rows,count,totals]=await Promise.all([
      this.pool.query(`${itemSelect} ORDER BY p.earned_date DESC,p.created_at DESC,p.id LIMIT $1 OFFSET $2`,[limit,(page-1)*limit]),
      this.pool.query("SELECT count(*)::int AS total FROM agent_pay_items"),
      this.pool.query(`SELECT COALESCE(sum(amount_cents),0)::bigint AS earned,
        COALESCE(sum(paid_cents),0)::bigint AS paid,
        COALESCE(sum(CASE WHEN due_date<CURRENT_DATE THEN amount_cents-paid_cents ELSE 0 END),0)::bigint AS overdue
        FROM (${itemSelect}) AS owed`),
    ]);
    const ids=rows.rows.map(r=>r.id);
    const payments=ids.length ? await this.pool.query("SELECT id,title,amount_cents,record_date::text AS date_text,payment_method,pay_item_id FROM agent_tax_records WHERE pay_item_id=ANY($1::uuid[]) ORDER BY record_date,id",[ids]) : {rows:[]};
    const total=totals.rows[0];
    return {items:rows.rows.map(r=>presentItem(r,payments.rows.filter(p=>p.pay_item_id===r.id))),total:count.rows[0].total,
      summary:{earnedCents:Number(total.earned),paidCents:Number(total.paid),remainingCents:Number(total.earned)-Number(total.paid),overdueCents:Number(total.overdue)}};
  }
  async create(input:PayItemInput) {
    const id=await this.transaction(async client=>{
      const result=await client.query(`INSERT INTO agent_pay_items(title,kind,earned_date,due_date,amount_cents,notes)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.title,input.kind,input.earnedDate,input.dueDate,input.amountCents,input.notes]);
      return result.rows[0].id as string;
    });
    return this.item(id);
  }
  async update(id:string,input:PayItemInput,revision:number) {
    await this.transaction(async client=>{
      await this.lock(client,id,revision);
      const paid=await client.query("SELECT COALESCE(sum(amount_cents),0)::bigint AS paid FROM agent_tax_records WHERE pay_item_id=$1",[id]);
      if (input.amountCents<Number(paid.rows[0].paid)) throw new TaxError(400,"Earned pay cannot be less than payments already received. Correct payment entries first.");
      await client.query(`UPDATE agent_pay_items SET title=$1,kind=$2,earned_date=$3,due_date=$4,amount_cents=$5,notes=$6,
        revision=revision+1,updated_at=now() WHERE id=$7`,[input.title,input.kind,input.earnedDate,input.dueDate,input.amountCents,input.notes,id]);
    });
    return this.item(id);
  }
  async remove(id:string,revision:number) {
    await this.transaction(async client=>{
      await this.lock(client,id,revision);
      const result=await client.query("SELECT 1 FROM agent_tax_records WHERE pay_item_id=$1 LIMIT 1",[id]);
      if (result.rows.length) throw new TaxError(409,"This pay entry has received payments. Remove its payment income entries in Records before deleting the earned pay.");
      await client.query("DELETE FROM agent_pay_items WHERE id=$1",[id]);
    });
    return {ok:true};
  }
  async receive(id:string,input:PayPaymentInput) {
    const recordId=await this.transaction(async client=>{
      // The key is stable across a lost response. Check before revision validation.
      const duplicate=await client.query("SELECT id,pay_item_id,amount_cents,record_date::text AS date_text,payment_method,counterparty,notes FROM agent_tax_records WHERE payment_request_id=$1",[input.paymentRequestId]);
      if (duplicate.rows[0]) {
        const d=duplicate.rows[0];
        if (d.pay_item_id!==id || Number(d.amount_cents)!==input.amountCents || d.date_text!==input.recordDate || d.payment_method!==input.paymentMethod ||
          (d.counterparty||null)!==(input.counterparty||null) || (d.notes||null)!==(input.notes||null)) {
          throw new TaxError(409,"This payment retry ID belongs to different payment details. Reload before recording a different payment.");
        }
        return d.id as string;
      }
      const pay=await this.lock(client,id,undefined);
      // A concurrent retry can have committed while this request waited for the lock.
      const retry=await client.query("SELECT id,amount_cents,record_date::text AS date_text,payment_method,counterparty,notes FROM agent_tax_records WHERE payment_request_id=$1 AND pay_item_id=$2",[input.paymentRequestId,id]);
      if(retry.rows[0]) {
        const d=retry.rows[0];
        if(Number(d.amount_cents)!==input.amountCents || d.date_text!==input.recordDate || d.payment_method!==input.paymentMethod ||
          (d.counterparty||null)!==(input.counterparty||null) || (d.notes||null)!==(input.notes||null)) {
          throw new TaxError(409,"This payment retry ID belongs to different payment details. Reload before recording a different payment.");
        }
        return d.id as string;
      }
      if(pay.revision!==input.expectedRevision) throw new TaxError(409,"This pay entry changed. Reload it before saving again.");
      const paid=await client.query("SELECT COALESCE(sum(amount_cents),0)::bigint AS paid FROM agent_tax_records WHERE pay_item_id=$1",[id]);
      if(input.amountCents>Number(pay.amount_cents)-Number(paid.rows[0].paid)) throw new TaxError(400,"Payment exceeds the remaining amount owed on this entry.");
      const year=Number(input.recordDate.slice(0,4));
      if(year<1900 || year>2200) throw new TaxError(400,"Payment date must be in a supported record year (1900–2200).");
      const record=await client.query(`INSERT INTO agent_tax_records
        (title,entry_type,amount_cents,record_date,tax_year,category,payment_method,counterparty,notes,pay_item_id,payment_request_id)
        VALUES($1,'income',$2,$3,$4,'commission',$5,$6,$7,$8,$9) RETURNING id`,
        [`Payment: ${pay.title}`.slice(0,200),input.amountCents,input.recordDate,year,input.paymentMethod,input.counterparty||null,input.notes||null,id,input.paymentRequestId]);
      await client.query("UPDATE agent_pay_items SET revision=revision+1,updated_at=now() WHERE id=$1",[id]);
      return record.rows[0].id as string;
    });
    return {item:await this.item(id),recordId};
  }
  async csv() {
    const result=await this.pool.query(`${itemSelect} ORDER BY p.earned_date,p.id`);
    const rows=[["Earned date","Due date","Title","Kind","Earned (USD)","Received (USD)","Still owed (USD)","Notes"],
      ...result.rows.map(r=>[r.earned_text,r.due_text,r.title,r.kind,(Number(r.amount_cents)/100).toFixed(2),
        (Number(r.paid_cents)/100).toFixed(2),((Number(r.amount_cents)-Number(r.paid_cents))/100).toFixed(2),r.notes])];
    return "\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n")+"\r\n";
  }
  async recorded(year:number) {
    const result=await this.pool.query(`SELECT
      COALESCE(sum(amount_cents) FILTER(WHERE entry_type='income'),0)::bigint AS income,
      COALESCE(sum(amount_cents) FILTER(WHERE entry_type='expense'),0)::bigint AS expenses
      FROM agent_tax_records WHERE tax_year=$1`,[year]);
    const incomeCents=Number(result.rows[0].income),expenseCents=Number(result.rows[0].expenses);
    return {incomeCents,expenseCents,profitCents:incomeCents-expenseCents};
  }
  async estimate(year:number) {
    const [row,recorded]=await Promise.all([
      this.pool.query("SELECT settings,revision FROM agent_tax_estimate_settings WHERE tax_year=$1",[year]),this.recorded(year),
    ]);
    const settings=(row.rows[0]?.settings as EstimateSettings|undefined)??null;
    const warnings=[...taxWarnings];
    let estimate:ReturnType<typeof calculateTax>|null=null;
    if(settings) {
      try {estimate=calculateTax(year,settings,recorded);}
      catch(error) {
        if(!(error instanceof TaxError)) throw error;
        warnings.unshift(`Update saved assumptions: ${error.message}`);
      }
    }
    return {settings,revision:row.rows[0]?.revision??0,recorded,estimate,supportedYears:[2025,2026],sources:taxSources,warnings};
  }
  async saveEstimate(year:number,settings:EstimateSettings,revision:number) {
    calculateTax(year,settings,await this.recorded(year));
    const result=revision===0
      ? await this.pool.query(`INSERT INTO agent_tax_estimate_settings(tax_year,settings) VALUES($1,$2::jsonb)
          ON CONFLICT DO NOTHING RETURNING revision`,[year,JSON.stringify(settings)])
      : await this.pool.query(`UPDATE agent_tax_estimate_settings SET settings=$1::jsonb,revision=revision+1,updated_at=now()
          WHERE tax_year=$2 AND revision=$3 RETURNING revision`,[JSON.stringify(settings),year,revision]);
    if(!result.rows[0]) throw new TaxError(409,"These tax assumptions changed in another session. Reload before saving.");
    return this.estimate(year);
  }
}
