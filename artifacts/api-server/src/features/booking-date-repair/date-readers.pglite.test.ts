import { beforeEach,
afterEach(async () => { await f.db.close(); });
it("keeps 18 sentinel imports in review and returns only two verified 2027 windows", async () => {
  await f.db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
  const second = randomUUID();
  await f.db.query("insert into bookings(id,name,status,starts_at,ends_at) values($1,'Second genuine show','new_lead','2027-04-03T12:00:00Z','2027-04-04T12:00:00Z')",[second]);
  for(let i=0;i<18;i++) await f.db.query("insert into bookings(name,status,starts_at,ends_at) values($1,'new_lead','2026-04-01T12:00:00Z','9999-12-31T00:00:00Z')",["Imported lead "+i]);
  await f.db.exec(`insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor)
    select id,'public_start','verified_event',booking_date_iso(starts_at),'instant',1,'saved_note','verified-start','1','owner' from bookings where name in ('Fair','Second genuine show')
    union all select id,'public_end','verified_event',booking_date_iso(ends_at),'instant',1,'saved_note','verified-end','1','owner' from bookings where name in ('Fair','Second genuine show');`);
  const overlap = await read("bookings",{eventYear:2027});
  expect(overlap.items.map((x:any)=>x.name).sort()).toEqual(["Fair","Second genuine show"]);
  const names:string[] = [];
  let cursor:string|null = null;
  do {
    const page = await read("bookings",{dateMode:"undated",limit:7,...(cursor?{cursor}:{})});
    names.push(...page.items.map((x:any)=>x.name));
    expect(page.items.every((x:any)=>x.dateProvenance.publicWindow===null)).toBe(true);
    cursor = page.nextCursor;
  } while(cursor);
  expect(names).toHaveLength(18);
  expect(new Set(names).size).toBe(18);
  expect((await f.db.query("select count(*)::int as count from bookings where status='new_lead' and extract(year from ends_at)=9999")).rows).toEqual([{count:18}]);
},30_000);
it("excludes a verified exclusive Google boundary from the following Denver day",async()=>{
  await f.db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
  await f.db.query("insert into booking_operational_windows(booking_id,starts_at,ends_at,source) values($1,'2027-03-13T00:00:00Z','2027-03-15T00:00:00Z','google_calendar')",[booking]);
  for(const [field,value,semantics] of [["reservation_start","2027-03-13","inclusive_date"],["reservation_end","2027-03-15","exclusive_date"]])
    await f.db.query("insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) values($1,$2,'verified_reservation',$3,$4,1,'google_calendar','event','etag','owner')",[booking,field,value,semantics]);
  expect((await read("bookings",{dateFrom:"2027-03-14",dateTo:"2027-03-14"})).items.map((x:any)=>x.name)).toEqual(["Fair"]);
  expect((await read("bookings",{dateFrom:"2027-03-15",dateTo:"2027-03-15"})).items).toEqual([]);
},30_000);
