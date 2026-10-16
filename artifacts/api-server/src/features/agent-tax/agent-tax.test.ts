import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import type { Pool } from "pg";
import express from "express";
import request from "supertest";
import { AgentTaxService } from "./service";
import { AgentTaxPlanningService } from "./planning-service";
import { calculateTax, bracketTax } from "./tax-calculator";
import { createTaxEntry, csvCell, taxFileType, type TaxEntryInput } from "./model";
import { estimateSettings, type EstimateSettings } from "./planning-model";
import { createAgentTaxRouter } from "@/routes/agent-tax";
import { issueToken } from "@/lib/auth";
import type { PrivateObjectStorage } from "@/lib/private-object-storage";

class MemoryStorage implements PrivateObjectStorage {
  objects=new Map<string,Uint8Array>(); failDelete=false; failPut=false;
  async put(k:string,b:Uint8Array) {if(this.failPut)throw new Error("synthetic unavailable");this.objects.set(k,new Uint8Array(b));}
  async get(k:string) {const b=this.objects.get(k);if(!b)throw new Error("missing");return b;}
  openReadStream(k:string) {
    const bytes=this.objects.get(k);
    return Readable.from((async function*(){if(!bytes)throw new Error("missing");yield bytes;})());
  }
  async exists(k:string) {return this.objects.has(k);}
  async delete(k:string) {if(this.failDelete)throw new Error("synthetic unavailable");this.objects.delete(k);}
  async getSignedReadUrl():Promise<string> {throw new Error("Private files never use public URLs.");}
}
const base:TaxEntryInput={title:"Synthetic test",entryType:"income",amountCents:60000,recordDate:"2026-10-01",taxYear:2026,
  category:"commission",paymentMethod:"venmo",counterparty:null,notes:null,bookingId:null};
const settings:EstimateSettings={
  filingStatus:"single",fullYearNdResident:true,additionalIncomeCents:0,additionalExpensesCents:0,nonDeductibleExpensesCents:0,
  wagesCents:0,ownSocialSecurityWagesCents:0,medicareWagesCents:0,otherIncomeCents:0,otherAdjustmentsCents:0,
  deductionOverrideCents:null,qbiDeductionCents:0,ndAdjustmentCents:0,federalCreditsCents:0,ndCreditsCents:0,
  federalWithholdingCents:0,ndWithholdingCents:0,federalPaymentsCents:0,ndPaymentsCents:0,
};
const earned={title:"Weekly test",kind:"weekly" as const,earnedDate:"2026-09-28",dueDate:"2026-10-01",amountCents:60000,notes:null};
let pg:PGlite,service:AgentTaxService,planning:AgentTaxPlanningService,storage:MemoryStorage;
let pool:Pool;
beforeAll(async()=>{
  pg=new PGlite();
  await pg.exec("CREATE TABLE bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,starts_at timestamptz)");
  for(const name of ["20261016_agent_tax_records.sql","20261017_agent_pay_planning.sql"]) {
    const sql=await readFile(new URL(`../../../../../lib/db/migrations/${name}`,import.meta.url),"utf8");
    await pg.exec(sql); await pg.exec(sql); // Additive migrations must be repeat-safe.
  }
  const query=(sql:string,params?:unknown[])=>pg.query(sql,params);
  pool={query,connect:async()=>({query,release:()=>{}})} as unknown as Pool;
},30_000);
beforeEach(async()=>{
  await pg.exec("TRUNCATE agent_tax_records,agent_pay_items,agent_tax_file_deletions,agent_tax_estimate_settings");
  storage=new MemoryStorage();service=new AgentTaxService(pool,storage,true);planning=new AgentTaxPlanningService(pool);
});
afterAll(async()=>{vi.unstubAllEnvs();await pg?.close();});

describe("private records and receipts",()=>{
  it("persists cents, filters year/search, paginates and keeps totals independent of search",async()=>{
    await service.create(base);
    await service.create({...base,title:"Other",entryType:"expense",amountCents:1234});
    await service.create({...base,entryType:"document",amountCents:99999});
    await service.create({...base,taxYear:2025,recordDate:"2025-12-31"});
    const list=await service.list(2026,"Synthetic",1,1);
    expect(list.total).toBe(2);expect(list.records).toHaveLength(1);
    expect(list.summary).toMatchObject({incomeCents:60000,expenseCents:1234,netCents:58766,recordCount:3});
    expect(list.years).toContain(2025);
    expect(await service.list(2026,"%",1,25)).toMatchObject({total:0});
  });
  it("requires matching dates/year and rejects unknown fields, decimal cents and bad files",()=>{
    expect(createTaxEntry.safeParse({...base,amountCents:1.1}).success).toBe(false);
    expect(createTaxEntry.safeParse({...base,recordDate:"2025-12-31"}).success).toBe(false);
    expect(createTaxEntry.safeParse({...base,payItemId:randomUUID()}).success).toBe(false);
    expect(createTaxEntry.safeParse({...base,entryType:"document",amountCents:null,recordDate:null}).success).toBe(true);
    expect(()=>taxFileType(Buffer.from("<script>bad</script>"),"application/pdf")).toThrow();
    expect(taxFileType(Buffer.from("%PDF-1.7\nsynthetic"),"application/pdf")).toBe(".pdf");
    expect(()=>taxFileType(Buffer.from("%PDF-1.7"),"image/png")).toThrow();
  });
  it("does not overwrite a concurrent edit and returns missing records explicitly",async()=>{
    const r=await service.create(base);
    await service.update(r.id,{...base,title:"First update"},r.revision);
    await expect(service.update(r.id,{...base,title:"Stale"},r.revision)).rejects.toMatchObject({status:409});
    expect((await service.get(r.id)).title).toBe("First update");
    await expect(service.get(randomUUID())).rejects.toMatchObject({status:404});
  });
  it("stores private attachments, survives stale replacement, cleans detached files and retries failures",async()=>{
    let r=await service.create(base);
    const bytes=Buffer.from("%PDF-1.7\nsynthetic");
    r=await service.upload(r.id,r.revision,"receipt.pdf","application/pdf",bytes);
    expect(Buffer.from((await service.download(r.id)).bytes)).toEqual(bytes);
    expect(r).not.toHaveProperty("storageKey");
    await expect(service.upload(r.id,1,"stale.pdf","application/pdf",bytes)).rejects.toMatchObject({status:409});
    expect(storage.objects.size).toBe(1);
    storage.failDelete=true;
    r=await service.upload(r.id,r.revision,"new.pdf","application/pdf",bytes);
    expect(storage.objects.size).toBe(2);
    storage.failDelete=false;await service.cleanup();expect(storage.objects.size).toBe(1);
    r=await service.removeFile(r.id,r.revision);
    expect(r.fileName).toBeNull();expect(storage.objects.size).toBe(0);
    r=await service.upload(r.id,r.revision,"delete.pdf","application/pdf",bytes);
    await service.remove(r.id,r.revision);
    expect(storage.objects.size).toBe(0);await expect(service.get(r.id)).rejects.toMatchObject({status:404});
  });
  it("keeps the saved entry when file upload fails and leaves no untracked object",async()=>{
    const r=await service.create(base);storage.failPut=true;
    await expect(service.upload(r.id,r.revision,"fail.pdf","application/pdf",Buffer.from("%PDF-1.7"))).rejects.toThrow();
    expect((await service.get(r.id)).title).toBe(base.title);
    expect((await pg.query("SELECT * FROM agent_tax_file_deletions")).rows).toHaveLength(0);
  });
  it("exports all selected-year entries with safe cells and no private storage keys",async()=>{
    await service.create({...base,title:'=HYPERLINK("bad")',notes:'line1\n"line2"'});
    const csv=await service.csv(2026);
    expect(csv).toContain(`"'=HYPERLINK(""bad"")"`);
    expect(csv).toContain('"600.00"');expect(csv).toContain('line1\n""line2""');
    expect(csvCell(" \t@bad")).toBe(`"' \t@bad"`);
    expect(csv).not.toContain("agent-tax/");
  });
});

describe("earned pay and cash received",()=>{
  it("supports weekly/manual entries and rejects duplicate weekly earned date",async()=>{
    await planning.create(earned);
    await expect(planning.create(earned)).rejects.toMatchObject({status:409});
    await planning.create({...earned,kind:"manual",amountCents:12500});
    const list=await planning.list(1,25);
    expect(list.summary).toMatchObject({earnedCents:72500,paidCents:0,remainingCents:72500});
    expect((await service.list(2026,"",1,25)).summary.incomeCents).toBe(0);
  });
  it("records partial payment once across a lost-response retry and restores balance when deleted",async()=>{
    const item=await planning.create(earned);
    const payment={amountCents:20000,recordDate:"2026-10-01",paymentMethod:"venmo" as const,counterparty:null,notes:null,expectedRevision:item.revision,paymentRequestId:randomUUID()};
    const received=await planning.receive(item.id,payment);
    const retry=await planning.receive(item.id,payment);
    expect(retry.recordId).toBe(received.recordId);
    expect(received.item).toMatchObject({paidCents:20000,remainingCents:40000});
    expect((await service.list(2026,"",1,25)).summary.incomeCents).toBe(20000);
    await expect(planning.receive(item.id,{...payment,amountCents:10000})).rejects.toMatchObject({status:409});
    await expect(planning.receive(item.id,{...payment,amountCents:50000,expectedRevision:received.item.revision,paymentRequestId:randomUUID()})).rejects.toMatchObject({status:400});
    await expect(planning.update(item.id,{...earned,amountCents:10000},received.item.revision)).rejects.toMatchObject({status:400});
    await expect(planning.remove(item.id,received.item.revision)).rejects.toMatchObject({status:409});
    const record=await service.get(received.recordId);
    await expect(service.update(record.id,{...base,amountCents:1},record.revision)).rejects.toMatchObject({status:409});
    await service.remove(record.id,record.revision);
    const restored=await planning.item(item.id);
    expect(restored.remainingCents).toBe(60000);
    expect((await service.list(2026,"",1,25)).summary.incomeCents).toBe(0);
    await planning.remove(item.id,restored.revision);
    expect((await planning.list(1,25)).total).toBe(0);
  });
  it("counts received income in its payment year, not the earned year",async()=>{
    const item=await planning.create({...earned,earnedDate:"2025-12-29"});
    await planning.receive(item.id,{amountCents:60000,recordDate:"2026-01-02",paymentMethod:"bank",counterparty:null,notes:null,expectedRevision:item.revision,paymentRequestId:randomUUID()});
    expect((await service.list(2025,"",1,25)).summary.incomeCents).toBe(0);
    expect((await service.list(2026,"",1,25)).summary.incomeCents).toBe(60000);
  });
});

describe("annual tax planning",()=>{
  it("requires explicit residency/settings and preserves optimistic revisions",async()=>{
    expect(estimateSettings.safeParse({...settings,fullYearNdResident:false}).success).toBe(false);
    expect((await planning.estimate(2026)).estimate).toBeNull();
    await service.create(base);
    const saved=await planning.saveEstimate(2026,settings,0);
    expect(saved.settings).toEqual(settings);expect(saved.estimate?.projectedProfitCents).toBe(60000);
    await expect(planning.saveEstimate(2026,{...settings,otherIncomeCents:1000},0)).rejects.toMatchObject({status:409});
    expect((await planning.estimate(2026)).revision).toBe(1);
  });
  it("calculates the $31,200 annual pay example using SE and ordinary income tax without guessing QBI",()=>{
    const r=calculateTax(2026,settings,{incomeCents:3120000,expenseCents:0});
    expect(r.netSelfEmploymentEarningsCents).toBe(2881320);
    expect(r.selfEmploymentTaxCents).toBe(440842);
    expect(r.halfSelfEmploymentDeductionCents).toBe(220421);
    expect(r.federalTaxableIncomeCents).toBe(1289579);
    expect(r.federalIncomeTaxCents).toBe(129949);
    expect(r.ndIncomeTaxCents).toBe(0);
    expect(r.remainingToSetAsideCents).toBe(570791);
  });
  it("uses year/status-specific brackets, SE cap and $400 net-earnings threshold",()=>{
    expect(bracketTax(5_000_000,[12400,50400],[.1,.12,.22])).toBe(575200);
    expect(calculateTax(2026,settings,{incomeCents:40000,expenseCents:0}).selfEmploymentTaxCents).toBe(0);
    expect(calculateTax(2026,settings,{incomeCents:43400,expenseCents:0}).selfEmploymentTaxCents).toBeGreaterThan(0);
    const high=calculateTax(2026,{...settings,ownSocialSecurityWagesCents:18450000},{incomeCents:10000000,expenseCents:0});
    expect(high.selfEmploymentTaxCents).toBe(267815);
    const twentyFive=calculateTax(2025,settings,{incomeCents:3120000,expenseCents:0});
    expect(twentyFive.deductionCents).toBe(1575000);
    expect(calculateTax(2026,{...settings,filingStatus:"married_joint"},{incomeCents:3120000,expenseCents:0}).federalIncomeTaxCents).toBe(0);
    expect(()=>calculateTax(2027,settings,{incomeCents:0,expenseCents:0})).toThrow();
  });
  it("keeps SE tax when credits remove income tax and never pays IRS with ND overpayment",()=>{
    const r=calculateTax(2026,{...settings,federalCreditsCents:1000000,ndPaymentsCents:100000},{incomeCents:3120000,expenseCents:0});
    expect(r.federalIncomeTaxCents).toBe(0);
    expect(r.federalLiabilityCents).toBe(440842);
    expect(r.ndBalanceCents).toBe(-100000);
    expect(r.remainingToSetAsideCents).toBe(440842);
    const wages=calculateTax(2026,{...settings,medicareWagesCents:20000000},{incomeCents:1000000,expenseCents:0});
    expect(wages.additionalMedicareTaxCents).toBe(8312);
  });
  it("supports ND rates, deductions, projections, nondeductible addbacks and no tax on a loss",()=>{
    const r=calculateTax(2026,{...settings,deductionOverrideCents:0,otherIncomeCents:10000000},{incomeCents:0,expenseCents:0});
    expect(r.ndIncomeTaxCents).toBe(98329);
    expect(()=>calculateTax(2026,{...settings,nonDeductibleExpensesCents:100},{incomeCents:0,expenseCents:0})).toThrow();
    const loss=calculateTax(2026,settings,{incomeCents:0,expenseCents:10000});
    expect(loss.totalLiabilityCents).toBe(0);
    const projection=calculateTax(2026,{...settings,additionalIncomeCents:30000,additionalExpensesCents:1000,nonDeductibleExpensesCents:1000},{incomeCents:60000,expenseCents:2000});
    expect(projection.projectedProfitCents).toBe(88000);
  });
});

// Read standard central-directory entries independently of the ZIP writer.
function unzip(buffer:Buffer) {
  const entries=new Map<string,Buffer>();
  let position=buffer.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  while(position>=0 && buffer.readUInt32LE(position)===0x02014b50) {
    const compressed=buffer.readUInt32LE(position+20),nameLength=buffer.readUInt16LE(position+28);
    const name=buffer.subarray(position+46,position+46+nameLength).toString();
    const offset=buffer.readUInt32LE(position+42);
    const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28);
    const bytes=buffer.subarray(start,start+compressed);
    entries.set(name,buffer.readUInt16LE(position+10)===8 ? inflateRawSync(bytes) : bytes);
    position+=46+nameLength+buffer.readUInt16LE(position+30)+buffer.readUInt16LE(position+32);
  }
  expect(buffer.includes(Buffer.from([0x50,0x4b,0x05,0x06]))).toBe(true);
  return entries;
}

describe("accountant year-end package",()=>{
  function app() {
    return express().use(express.json()).use("/api",createAgentTaxRouter(service,undefined,planning));
  }
  const receiveZip=(res:request.Response,callback:(error:Error|null,body:Buffer)=>void)=>{
    const chunks:Buffer[]=[];
    res.on("data",(b:Buffer)=>chunks.push(b));
    res.on("end",()=>callback(null,Buffer.concat(chunks)));
    res.on("error",(error:Error)=>callback(error,Buffer.alloc(0)));
  };
  it("exports every selected-year record and safe private receipts with an exact manifest, excluding estimates and other years",async()=>{
    vi.stubEnv("SESSION_SECRET","synthetic-test-session-only");
    const income=await service.create({...base,title:"=HYPERLINK(\"https://example.test\")"});
    const expense=await service.create({...base,title:"Travel",entryType:"expense",category:"travel"});
    const doc=await service.create({...base,title:"Tax form",entryType:"document",amountCents:null,recordDate:null});
    const pdf=Buffer.from("%PDF-1.7 synthetic private receipt");
    await service.upload(income.id,1,"../../CON.pdf","application/pdf",pdf);
    await service.upload(expense.id,1,"../../CON.pdf","application/pdf",pdf);
    await service.upload(doc.id,1,"bad\\path.pdf","application/pdf",pdf);
    await service.create({...base,taxYear:2025,recordDate:"2025-01-01",title:"NOT_THIS_YEAR"});
    await planning.saveEstimate(2026,{...settings,wagesCents:1234567},0);
    const bufferedRead=vi.spyOn(storage,"get");
    const signed=vi.spyOn(storage,"getSignedReadUrl");
    const response=await request(app()).get("/api/admin/agent-tax/package?year=2026&q=no-match&page=99")
      .set("Authorization",`Bearer ${issueToken()!.token}`).buffer(true).parse(receiveZip);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["content-disposition"]).toContain("2026.zip");
    const files=unzip(response.body);
    expect(files.size).toBe(6);
    for(const id of [income.id,expense.id,doc.id]) expect(files.get(`receipts/${id}.pdf`)).toEqual(pdf);
    expect([...files.keys()].every(name=>!name.includes("..")&&!name.includes("\\")&&!name.startsWith("/"))).toBe(true);
    const manifest=JSON.parse(files.get("manifest.json")!.toString());
    expect(manifest.records).toHaveLength(3);
    for(const r of manifest.records) expect(files.has(r.receiptPath)).toBe(true);
    expect(manifest.records.find((r:{recordId:string})=>r.recordId===income.id).revision).toBe(2);
    const csv=files.get("income-expenses.csv")!.toString();
    expect(csv).toContain(income.id);expect(csv).toContain(expense.id);expect(csv).not.toContain(doc.id);
    expect(csv).toContain("'=HYPERLINK");
    const text=[...files.values()].map(b=>b.toString()).join("\n");
    expect(text).toContain("not proof of deductibility");
    for(const forbidden of ["storage_key","agent-tax/","NOT_THIS_YEAR","filingStatus","wagesCents","getSignedReadUrl"]) expect(text).not.toContain(forbidden);
    expect(bufferedRead).not.toHaveBeenCalled();expect(signed).not.toHaveBeenCalled();
  });
  it("exports a valid empty-year package and rejects invalid years",async()=>{
    vi.stubEnv("SESSION_SECRET","synthetic-test-session-only");
    const auth={Authorization:`Bearer ${issueToken()!.token}`};
    for(const year of ["","abc","1899","2201","2026.5","2026&year=2025"]) {
      expect((await request(app()).get(`/api/admin/agent-tax/package?year=${year}`).set(auth)).status).toBe(400);
    }
    const response=await request(app()).get("/api/admin/agent-tax/package?year=2026").set(auth).buffer(true).parse(receiveZip);
    const files=unzip(response.body);
    expect(files.size).toBe(3);expect(JSON.parse(files.get("manifest.json")!.toString()).records).toEqual([]);
  });
  it("rejects unavailable storage and shared/traversal file keys before streaming",async()=>{
    vi.stubEnv("SESSION_SECRET","synthetic-test-session-only");
    const r=await service.create(base);
    await service.upload(r.id,1,"test.pdf","application/pdf",Buffer.from("%PDF-synthetic"));
    const auth={Authorization:`Bearer ${issueToken()!.token}`};
    service=new AgentTaxService(pool,storage,false);
    expect((await request(app()).get("/api/admin/agent-tax/package?year=2026").set(auth)).status).toBe(503);
    service=new AgentTaxService(pool,storage,true);
    for(const key of ["company/shared.pdf",`agent-tax/${r.id}/../../shared.pdf`,`https://storage.test/file?signature=secret`]) {
      await pool.query("UPDATE agent_tax_records SET storage_key=$1 WHERE id=$2",[key,r.id]);
      expect((await request(app()).get("/api/admin/agent-tax/package?year=2026").set(auth)).status).toBe(503);
    }
  });
});

describe("owner boundary and route validation",()=>{
  it("rejects every private API without owner auth before consulting records/storage",async()=>{
    vi.stubEnv("SESSION_SECRET","synthetic-test-session-only");
    const noRead={list:vi.fn(),download:vi.fn(),accountantPackage:vi.fn()} as unknown as AgentTaxService;
    const app=express().use(express.json()).use("/api",createAgentTaxRouter(noRead,undefined,planning));
    for(const path of ["/records","/pay","/pay/export","/export?year=2026","/package?year=2026","/bookings","/estimate/2026",`/records/${randomUUID()}/file`]) {
      for(const token of ["","office.synthetic","boss.synthetic","manager.synthetic"]) {
        const req=request(app).get(`/api/admin/agent-tax${path}`);
        if(token)req.set("Authorization",`Bearer ${token}`);
        expect((await req).status).toBe(401);
      }
    }
    expect(noRead.list).not.toHaveBeenCalled();expect(noRead.download).not.toHaveBeenCalled();
    expect(noRead.accountantPackage).not.toHaveBeenCalled();
    const id=randomUUID();
    for(const [method,path] of [
      ["post","/records"],["patch",`/records/${id}`],["delete",`/records/${id}`],
      ["put",`/records/${id}/file`],["delete",`/records/${id}/file`],
      ["post","/pay"],["patch",`/pay/${id}`],["delete",`/pay/${id}`],
      ["post",`/pay/${id}/payments`],["put","/estimate/2026"],
    ] as const) {
      expect((await request(app)[method](`/api/admin/agent-tax${path}`).send({})).status).toBe(401);
    }
  });
  it("allows owner only, validates upload/id/amount/year, and marks responses no-store",async()=>{
    vi.stubEnv("SESSION_SECRET","synthetic-test-session-only");
    const app=express().use(express.json()).use("/api",createAgentTaxRouter(service,undefined,planning));
    const owner=issueToken()!.token;
    const auth={Authorization:`Bearer ${owner}`};
    const list=await request(app).get("/api/admin/agent-tax/records?year=2026").set(auth);
    expect(list.status).toBe(200);expect(list.headers["cache-control"]).toContain("no-store");
    expect((await request(app).post("/api/admin/agent-tax/records").set(auth).send({...base,amountCents:-1})).status).toBe(400);
    expect((await request(app).patch("/api/admin/agent-tax/records/not-id").set(auth).send({})).status).toBe(400);
    expect((await request(app).get("/api/admin/agent-tax/estimate/2027").set(auth)).status).toBe(400);
    const r=await service.create(base);
    expect((await request(app).put(`/api/admin/agent-tax/records/${r.id}/file`).set(auth).set("content-type","application/pdf").set("x-file-name","bad.pdf").set("x-record-revision","1").send(Buffer.from("not pdf"))).status).toBe(400);
    expect((await request(app).put(`/api/admin/agent-tax/records/${r.id}/file`).set(auth).set("content-type","application/pdf").set("x-file-name","big.pdf").set("x-record-revision","1").send(Buffer.alloc(16*1024*1024))).status).toBe(413);
  });
});
