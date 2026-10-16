import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { PrivateObjectStorage } from "@/lib/private-object-storage";
import { csvCell, TaxError, type TaxEntryInput } from "./model";

const selectSql = `SELECT r.*, r.record_date::text AS date_text, b.name AS booking_label
  FROM agent_tax_records r LEFT JOIN bookings b ON b.id=r.booking_id`;
type Row = Record<string, any>;
export function presentTaxRecord(row: Row) {
  return {
    id: row.id, title: row.title, entryType: row.entry_type,
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    recordDate: row.date_text ?? null, taxYear: Number(row.tax_year), category: row.category,
    paymentMethod: row.payment_method, counterparty: row.counterparty, notes: row.notes,
    bookingId: row.booking_id, bookingLabel: row.booking_label ?? null, payItemId: row.pay_item_id ?? null,
    fileName: row.file_name, fileMime: row.file_mime, fileSize: row.file_size === null ? null : Number(row.file_size),
    revision: Number(row.revision), createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class AgentTaxService {
  constructor(private readonly pool: Pool, private readonly storage: PrivateObjectStorage, readonly storageAvailable: boolean) {}

  async list(year: number, q: string, page: number, limit: number) {
    const filter = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const where = `r.tax_year=$1 AND (r.title ILIKE $2 OR COALESCE(r.counterparty,'') ILIKE $2 OR COALESCE(r.notes,'') ILIKE $2 OR COALESCE(r.file_name,'') ILIKE $2)`;
    const [rows, count, summary, years] = await Promise.all([
      this.pool.query(`${selectSql} WHERE ${where} ORDER BY r.record_date DESC NULLS LAST,r.created_at DESC,r.id LIMIT $3 OFFSET $4`, [year, filter, limit, (page - 1) * limit]),
      this.pool.query(`SELECT count(*)::int AS total FROM agent_tax_records r WHERE ${where}`, [year, filter]),
      this.pool.query(`SELECT COALESCE(sum(amount_cents) FILTER(WHERE entry_type='income'),0)::text AS income,
        COALESCE(sum(amount_cents) FILTER(WHERE entry_type='expense'),0)::text AS expenses,count(*)::int AS count
        FROM agent_tax_records WHERE tax_year=$1`, [year]),
      this.pool.query("SELECT DISTINCT tax_year FROM agent_tax_records ORDER BY tax_year DESC"),
    ]);
    const incomeCents = Number(summary.rows[0].income);
    const expenseCents = Number(summary.rows[0].expenses);
    return { records: rows.rows.map(presentTaxRecord), total: count.rows[0].total,
      years: [...new Set([year, new Date().getFullYear(), ...years.rows.map(r => Number(r.tax_year))])].sort((a,b)=>b-a),
      summary: { incomeCents, expenseCents, netCents: incomeCents-expenseCents, recordCount: summary.rows[0].count },
      storageAvailable: this.storageAvailable };
  }

  async get(id: string) {
    const result = await this.pool.query(`${selectSql} WHERE r.id=$1`, [id]);
    if (!result.rows[0]) throw new TaxError(404, "Tax record not found.");
    return presentTaxRecord(result.rows[0]);
  }

  private values(input: TaxEntryInput) {
    return [input.title,input.entryType,input.amountCents,input.recordDate,input.taxYear,input.category,input.paymentMethod,
      input.counterparty || null,input.notes || null,input.bookingId];
  }

  async create(input: TaxEntryInput) {
    const result = await this.pool.query(`INSERT INTO agent_tax_records
      (title,entry_type,amount_cents,record_date,tax_year,category,payment_method,counterparty,notes,booking_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, this.values(input));
    return this.get(result.rows[0].id);
  }

  async update(id: string, input: TaxEntryInput, revision: number) {
    const current=await this.get(id);
    if(current.payItemId && (input.entryType!==current.entryType || input.amountCents!==current.amountCents ||
      input.recordDate!==current.recordDate || input.taxYear!==current.taxYear || input.paymentMethod!==current.paymentMethod)) {
      throw new TaxError(409,"This is linked to received pay. To correct its amount/date, delete this income entry and record the payment again under Pay owed to me.");
    }
    const result = await this.pool.query(`UPDATE agent_tax_records SET title=$1,entry_type=$2,amount_cents=$3,
      record_date=$4,tax_year=$5,category=$6,payment_method=$7,counterparty=$8,notes=$9,booking_id=$10,
      revision=revision+1,updated_at=now() WHERE id=$11 AND revision=$12 RETURNING id`,
    [...this.values(input),id,revision]);
    if (!result.rows[0]) { await this.get(id); throw new TaxError(409, "This record changed. Reload it before saving again."); }
    return this.get(id);
  }

  /** Lock only this record, check the exact version, and queue old-file disposal atomically. */
  private async fileMutation(id: string, revision: number, mutation: (client: PoolClient, row: Row) => Promise<void>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM agent_tax_records WHERE id=$1 FOR UPDATE", [id]);
      const row = result.rows[0];
      if (!row) throw new TaxError(404, "Tax record not found.");
      if (row.revision !== revision) throw new TaxError(409, "This record changed. Reload it before saving again.");
      await mutation(client, row);
      if (row.storage_key) await client.query("INSERT INTO agent_tax_file_deletions(storage_key) VALUES($1) ON CONFLICT DO NOTHING", [row.storage_key]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    await this.cleanup();
  }

  async upload(id: string, revision: number, name: string, mime: string, bytes: Uint8Array) {
    if (!this.storageAvailable) throw new TaxError(503, "Private receipt storage is not configured. Your entry can still be saved without an attachment.");
    const key = `agent-tax/${id}/${randomUUID()}`;
    // Reserve disposal before writing bytes. A process/DB failure after upload
    // cannot orphan an untracked object. Delay gives in-flight uploads time.
    await this.pool.query("INSERT INTO agent_tax_file_deletions(storage_key,queued_at) VALUES($1,now()+interval '1 hour')",[key]);
    try {
      await this.storage.put(key, bytes, mime);
      await this.fileMutation(id,revision,async(client) => {
        await client.query(`UPDATE agent_tax_records SET storage_key=$1,file_name=$2,file_mime=$3,file_size=$4,
          revision=revision+1,updated_at=now() WHERE id=$5`, [key,name,mime,bytes.length,id]);
        await client.query("DELETE FROM agent_tax_file_deletions WHERE storage_key=$1",[key]);
      });
    } catch (error) {
      await this.pool.query("UPDATE agent_tax_file_deletions SET queued_at=now() WHERE storage_key=$1",[key]).catch(()=>undefined);
      await this.cleanup();
      throw error;
    }
    return this.get(id);
  }

  async removeFile(id: string, revision: number) {
    await this.fileMutation(id,revision,async client => {
      await client.query(`UPDATE agent_tax_records SET storage_key=NULL,file_name=NULL,file_mime=NULL,file_size=NULL,
        revision=revision+1,updated_at=now() WHERE id=$1`, [id]);
    });
    return this.get(id);
  }

  async remove(id: string, revision: number) {
    await this.fileMutation(id,revision,async (client,row) => {
      await client.query("DELETE FROM agent_tax_records WHERE id=$1", [id]);
      if(row.pay_item_id) await client.query("UPDATE agent_pay_items SET revision=revision+1,updated_at=now() WHERE id=$1",[row.pay_item_id]);
    });
    return { ok: true };
  }

  async download(id: string) {
    const result = await this.pool.query("SELECT storage_key,file_name,file_mime FROM agent_tax_records WHERE id=$1", [id]);
    const row = result.rows[0];
    if (!row?.storage_key) throw new TaxError(404, "Attachment not found.");
    const bytes = await this.storage.get(row.storage_key);
    return { bytes, name: row.file_name as string, mime: row.file_mime as string };
  }

  async cleanup() {
    if (!this.storageAvailable) return;
    // Errors leave durable queue entries for the next attempt; never undo a saved record.
    try {
      const pending = await this.pool.query("SELECT storage_key FROM agent_tax_file_deletions WHERE queued_at<=now() ORDER BY queued_at LIMIT 20");
      for (const row of pending.rows) {
        try {
          await this.storage.delete(row.storage_key);
          await this.pool.query("DELETE FROM agent_tax_file_deletions WHERE storage_key=$1", [row.storage_key]);
        } catch { /* retry later, without logging financial names or payloads */ }
      }
    } catch { /* database might be in startup maintenance */ }
  }

  async bookings(q: string) {
    const result = await this.pool.query(`SELECT id,name,starts_at::date::text AS date FROM bookings
      WHERE name ILIKE $1 ORDER BY starts_at DESC NULLS LAST,id LIMIT 30`, [`%${q.replace(/[\\%_]/g,"\\$&")}%`]);
    return { bookings: result.rows.map(r => ({id:r.id,label:`${r.name}${r.date ? " — " + r.date : ""}`})) };
  }

  async csv(year: number) {
    const result = await this.pool.query(`${selectSql} WHERE r.tax_year=$1 ORDER BY r.record_date NULLS LAST,r.created_at,r.id`, [year]);
    const header = ["Tax year","Date","Type","Title","Category","Amount (USD)","Payment method","Paid by / paid to","Booking","Notes","Attachment filename"];
    const rows = result.rows.map(row => [row.tax_year,row.date_text,row.entry_type,row.title,row.category,
      row.amount_cents === null ? "" : (Number(row.amount_cents)/100).toFixed(2),row.payment_method,row.counterparty,
      row.booking_label,row.notes,row.file_name]);
    return "\uFEFF" + [header,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
}
