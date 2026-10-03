export const bookingDateSchemaCheck = `SELECT
 to_regclass(current_schema()||'.booking_date_evidence') IS NOT NULL
 AND to_regclass(current_schema()||'.booking_date_repair_previews') IS NOT NULL
 AND to_regclass(current_schema()||'.booking_date_repair_receipts') IS NOT NULL
 AND to_regprocedure('booking_resolved_dates(uuid,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)') IS NOT NULL
 AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='booking_date_receipt_immutable' AND tgrelid=to_regclass(current_schema()||'.booking_date_repair_receipts')) AS ready`;
export async function ensureBookingDateSchemaBeforeListen(options?: {
 pool?: {query(text:string):Promise<{rows:Array<{ready?:boolean}>}>};
 applyMigration?:()=>Promise<void>;
}) {
 const pool=options?.pool ?? (await import("@workspace/db")).pool;
 let result=await pool.query(bookingDateSchemaCheck);
 if(result.rows[0]?.ready!==true) {
  if(options?.applyMigration) await options.applyMigration();
  else if(!options?.pool) {
   const {loadActReviewMigrations,runActReviewMigrations}=await import("@workspace/db/migrations");
   const migrations=(await loadActReviewMigrations()).filter(m=>m.name==="20261002_booking_date_provenance.sql");
   await runActReviewMigrations({migrations});
  }
  result=await pool.query(bookingDateSchemaCheck);
 }
 if(result.rows[0]?.ready!==true) throw new Error("BOOKING_DATE_SCHEMA_REQUIRED");
}
