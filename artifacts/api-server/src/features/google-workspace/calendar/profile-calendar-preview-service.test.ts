import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../outreach-planner/outreach-commitments",()=>({reconcileCapacityFacts:vi.fn(async(db,_source,work)=>work(db))}));
vi.mock("../../audit/audit-service",()=>({recordAuditEntry:vi.fn()}));
vi.mock("./operational-calendar-link-repository",()=>({OperationalCalendarLinkRepository:class {
  findByBookingPackage=vi.fn(async()=>null);
  saveSuccessfulSync=vi.fn(async()=>({}));
}}));
vi.mock("../../booking-date-repair/date-repair-repository",()=>({
  BookingDateRepairRepository: class {},
  query: vi.fn(),
  hash: (value: unknown) => JSON.stringify(value),
  fail: (status: number, code: string): never => { throw Object.assign(new Error(code), {status,code}); },
}));
import { query } from "../../booking-date-repair/date-repair-repository";
import { recordAuditEntry } from "../../audit/audit-service";
import { ProfileCalendarPreviewService } from "./profile-calendar-preview-service";
import { eventIdentity } from "./calendar-preview-model";

beforeEach(()=>vi.clearAllMocks());
function fixture() {
 const desired={summary:"Fair (Zone)",description:"EVENT DATES: 2027-07-21",startDate:"2027-07-19",endDateExclusive:"2027-07-23"};
 const eventId=eventIdentity("booking","zone");
 const facts={fingerprint:"revision",name:"Fair",venue:"Fairgrounds",manager:"Owner",startsOn:"2027-07-21",endsOn:"2027-07-21",setupOn:null,teardownOn:null,packages:[{key:"zone",name:"Zone"}],sources:[],problems:[]};
 const preview={id:"preview",fingerprint:"revision",profileId:"profile",bookingId:"booking",expiresAt:"2030-01-01",
  calendarId:"calendar",facts,setupOn:"2027-07-19",teardownOn:"2027-07-22",problems:[],
  events:[{packageKey:"zone",input:desired,eventId,existing:null,mode:"create"}]};
 const record={actor:"owner",fingerprint:"revision",expires_at:"2030-01-01",receipt:null,
  payload:{preview,proposal:{profileId:"profile",bookingId:"booking"},connectionId:"connection"}};
 const remote=new Map<string,any>();
 const client={
  getEvent:vi.fn(async(_calendar,id)=>remote.get(id)??null),
  listEvents:vi.fn(async()=>({events:[...remote.values()],nextPageToken:null})),
  createEvent:vi.fn(async(_calendar,input)=>{const event={...input,id:input.id,etag:"v1",updated:null,status:"confirmed",eventKind:"all_day" as const};remote.set(input.id,event);return event;}),
  updateEvent:vi.fn(),
 };
 const db={execute:vi.fn(async()=>({rows:[]}))};
 const service=new ProfileCalendarPreviewService(db as any,{createOperationalCalendarClient:async()=>({connectionId:"connection",calendarId:"calendar",client})},()=>new Date("2026-10-16"));
 vi.spyOn(service,"facts").mockResolvedValue(facts as any);
 vi.mocked(query).mockImplementation(async(_tx,q)=> {
   // The preview row read is the only query with its unique table name; other queried sets are empty.
   const chunks=JSON.stringify(q);
   return (chunks.includes("profile_calendar_previews")?[record]:[]) as any;
 });
 return {service,client,record,remote,desired,eventId,db};
}
describe("profile preview apply (database boundaries mocked)",()=>{
 it("rejects a stale source revision before any provider write",async()=>{
  const f=fixture();vi.mocked(f.service.facts).mockResolvedValue({...f.record.payload.preview.facts,fingerprint:"changed"} as any);
  await expect(f.service.apply({previewId:"preview",fingerprint:"revision"},"owner")).rejects.toMatchObject({code:"PREVIEW_STALE"});
  expect(f.client.createEvent).not.toHaveBeenCalled();
 });
 it("reads back before recording success and never saves a booking window",async()=>{
  const f=fixture();
  const receipt=await f.service.apply({previewId:"preview",fingerprint:"revision"},"owner");
  expect(receipt.state).toBe("saved");expect(f.client.createEvent).toHaveBeenCalledTimes(1);
  expect(f.client.createEvent).toHaveBeenCalledWith("calendar",{...f.desired,id:f.eventId});
  expect(f.client.getEvent).toHaveBeenCalledWith("calendar",f.eventId);
  expect(recordAuditEntry).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.db.execute.mock.calls)).not.toContain("booking_operational_windows");
 });
 it("reconciles provider success after a lost response without creating again",async()=>{
  const f=fixture();
  f.remote.set(f.eventId,{...f.desired,id:f.eventId,etag:"v1",updated:null,status:"confirmed",eventKind:"all_day" as const});
  await expect(f.service.apply({previewId:"preview",fingerprint:"revision"},"owner")).resolves.toMatchObject({state:"saved"});
  expect(f.client.createEvent).not.toHaveBeenCalled();expect(f.client.updateEvent).not.toHaveBeenCalled();
 });
 it("does not report success when provider readback differs",async()=>{
  const f=fixture();f.client.createEvent.mockImplementation(async(_calendar,input)=>{
    const bad={...input,id:input.id,description:"changed remotely",etag:"v1",updated:null,status:"confirmed",eventKind:"all_day" as const};f.remote.set(input.id,bad);return bad;
  });
  await expect(f.service.apply({previewId:"preview",fingerprint:"revision"},"owner")).rejects.toMatchObject({code:"CALENDAR_SAVE_NOT_VERIFIED"});
  expect(recordAuditEntry).not.toHaveBeenCalled();
 });
 it("blocks a newly discovered duplicate before writing",async()=>{
  const f=fixture();f.remote.set("manual",{...f.desired,id:"manual",etag:"v1",status:"confirmed",eventKind:"all_day" as const});
  await expect(f.service.apply({previewId:"preview",fingerprint:"revision"},"owner")).rejects.toMatchObject({code:"POSSIBLE_DUPLICATE_REQUIRES_REVIEW"});
  expect(f.client.createEvent).not.toHaveBeenCalled();
 });
 it("returns a committed receipt without another provider write",async()=>{
  const f=fixture();(f.record as any).receipt={state:"saved",previewId:"preview",events:[],savedAt:"earlier"};
  await expect(f.service.apply({previewId:"preview",fingerprint:"revision"},"owner")).resolves.toMatchObject({savedAt:"earlier"});
  expect(f.client.getEvent).not.toHaveBeenCalled();
 });
 it("rejects a preview belonging to another owner",async()=>{
  const f=fixture();
  await expect(f.service.apply({previewId:"preview",fingerprint:"revision"},"different")).rejects.toMatchObject({code:"PREVIEW_ACTOR_MISMATCH"});
  expect(f.client.createEvent).not.toHaveBeenCalled();
 });
});

it("rejects timed provider readback even when projected dates match", async () => {
 const f=fixture();
 f.client.createEvent.mockImplementation(async(_calendar,input)=>{
   const timed={...input,id:input.id,etag:"v1",updated:null,status:"confirmed",eventKind:"timed"};
   f.remote.set(input.id,timed); return timed;
 });
 await expect(f.service.apply({previewId:"preview",fingerprint:"revision"},"owner"))
   .rejects.toMatchObject({code:"CALENDAR_SAVE_NOT_VERIFIED"});
 expect(recordAuditEntry).not.toHaveBeenCalled();
});
