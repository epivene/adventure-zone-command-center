import { describe, expect, it, vi } from "vitest";
vi.mock("@/features/outreach-planner/outreach-commitments", () => ({
  reconcileCapacityFacts: (db: unknown, _reason: string, work: (tx: unknown) => unknown) => work(db),
}));
vi.mock("./operational-calendar-matcher", () => ({ parseOperationalEventDateText: () => null }));
vi.mock("@/db/schema", () => {
  const table = (id: string) => ({ id, name: id + ".name", city: id + ".city", region: id + ".region", state: id + ".state", bookingId: id + ".bookingId", connectionId: id + ".connectionId", calendarId: id + ".calendarId", packageKey: id + ".packageKey" });
  return Object.fromEntries(["bookings", "organizations", "packageTemplates", "travelLegs", "bookingOperationalWindows", "bookingPackageSelections", "googleOperationalCalendarLinks", "googleOperationalCalendarReviews"].map(name => [name, table(name)]));
});
vi.mock("@/features/outreach-planner/outreach-allocation", () => ({ allocationEnabled: () => false }));
import { OperationalCalendarImportService } from "./operational-calendar-import-service";
import { OperationalCalendarSyncService } from "./operational-calendar-sync-service";
import { OperationalCalendarLinkRepository } from "./operational-calendar-link-repository";
import { bookings, organizations, googleOperationalCalendarLinks, googleOperationalCalendarReviews } from "@/db/schema";

function database(options: { conflict?: boolean; missing?: boolean; cancelled?: boolean; noPackage?: boolean } = {}) {
  const review = {
    id: "review", state: "pending", connectionId: "connection", calendarId: "calendar", googleEventId: "event",
    proposedChanges: {
      candidateBookingIds: ["different-booking"],
      parsed: { packageKey: options.noPackage ? null : "zone", calendarState: options.cancelled ? "cancelled" : "confirmed" },
      google: { summary: options.cancelled ? "CANCELLED Festival" : "Festival", startDate: "2026-09-10", endDateExclusive: "2026-09-14" },
    },
  };
  const writes: unknown[] = [];
  const tx: any = {
    select: () => {
      let rows: unknown[] = [];
      const chain: any = {
        from: (table: unknown) => {
          rows = table === googleOperationalCalendarReviews ? [review]
            : table === bookings ? options.missing ? [] : [{ id: "chosen-booking", organizationId: "profile", status: "cancelled", notes: "Keep me" }]
            : table === googleOperationalCalendarLinks && options.conflict ? [{ googleEventId: "other-event" }] : [];
          return chain;
        },
        where: () => chain, limit: () => chain, for: () => chain,
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return chain;
    },
    insert: (table: unknown) => { writes.push(table); return { values: () => ({ onConflictDoUpdate: async () => {} }) }; },
    update: (table: unknown) => { writes.push(table); return { set: () => ({ where: async () => {} }) }; },
    execute: vi.fn(),
  };
  return { tx, writes };
}
describe("manual calendar linking", () => {
  it("accepts an existing booking outside automatic candidates without rewriting CRM facts", async () => {
    const { tx, writes } = database({ cancelled: true });
    const result = await new OperationalCalendarLinkRepository(tx).resolveReview({ reviewId: "review", resolution: "link_existing", bookingId: "chosen-booking", reviewedBy: "owner" });
    expect(result.bookingId).toBe("chosen-booking");
    expect(result.created).toBe(false);
    expect(writes).toEqual([googleOperationalCalendarLinks, googleOperationalCalendarReviews]);
    expect(writes).not.toContain(bookings);
    expect(writes).not.toContain(organizations);
    expect(tx.execute).not.toHaveBeenCalled();
  });
  it("allows an explicit package for an unclassified calendar row", async () => {
    const { tx } = database({ noPackage: true });
    await expect(new OperationalCalendarLinkRepository(tx).resolveReview({ reviewId: "review", resolution: "link_existing", bookingId: "chosen-booking", packageKey: "zone", reviewedBy: "owner" })).resolves.toMatchObject({ created: false });
  });
  it.each([
    [{ missing: true }, "GOOGLE_OPERATIONAL_CALENDAR_BOOKING_NOT_FOUND"],
    [{ conflict: true }, "GOOGLE_OPERATIONAL_CALENDAR_BOOKING_ALREADY_LINKED"],
  ])("rejects invalid links before writing", async (options, error) => {
    const { tx, writes } = database(options);
    await expect(new OperationalCalendarLinkRepository(tx).resolveReview({ reviewId: "review", resolution: "link_existing", bookingId: "chosen-booking", reviewedBy: "owner" })).rejects.toThrow(error);
    expect(writes).toEqual([]);
  });
  it("does not create a confirmed profile from a canceled event", async () => {
    const { tx, writes } = database({ cancelled: true });
    await expect(new OperationalCalendarLinkRepository(tx).resolveReview({ reviewId: "review", resolution: "create_new", reviewedBy: "owner" })).rejects.toThrow("GOOGLE_OPERATIONAL_CALENDAR_CANCELLED_CREATE_BLOCKED");
    expect(writes).toEqual([]);
  });
});


it("refreshes empty saved candidates and exposes a profile with no booking without writes", async () => {
  const insert = vi.fn(), update = vi.fn();
  const db: any = {
    insert, update,
    select: () => {
      let rows: any[] = [];
      const chain: any = {
        from: (table: unknown) => {
          rows = table === googleOperationalCalendarReviews ? [
            { id: "review", proposedChanges: { parsed: { eventName: "Blanding City Fall Festival" }, google: {} } },
            { id: "no-booking", proposedChanges: { parsed: { eventName: "HAFFE Convention 2026" }, google: {} } },
          ] : table === organizations ? [
            { profileId: "blanding", profileName: "City of Blanding", city: "Blanding", region: "UT" },
            { profileId: "haffe", profileName: "HAFFE Convention", city: null, region: null },
          ] : table === bookings ? [
            { bookingId: "booking", profileId: "blanding", bookingName: "Fall 2026", profileName: "City of Blanding", city: "Blanding", region: "UT" },
          ] : [];
          return chain;
        },
        where: () => chain, leftJoin: () => chain, orderBy: () => chain,
        then: (resolve: (rows: any[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return chain;
    },
  };
  const reviews = await new OperationalCalendarLinkRepository(db).listPendingReviews();
  expect(reviews[0].proposedChanges.candidateBookings[0].bookingId).toBe("booking");
  expect(reviews[1].proposedChanges.candidateProfiles[0].profileId).toBe("haffe");
  expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
});

describe("profile provenance across import review resolution", () => {
  function fixture() {
    const original = {profilePreviewId:"preview",sourceFingerprint:"proof-v1",sources:[{id:"contract",revision:"v1"}],
      summary:"Fair",description:"EVENT DATES: September 12",startDate:"2026-09-10",endDateExclusive:"2026-09-14"};
    const link: any = {id:"link",connectionId:"connection",calendarId:"calendar",googleEventId:"event",
      bookingId:"booking",packageKey:"zone",etag:"v1",lastAppSnapshot:original,
      reservedStartsAt:new Date("2026-09-10"),reservedEndsAt:new Date("2026-09-14")};
    const external = {...original,id:"event",etag:"v2",updated:null,status:"confirmed",eventKind:"all_day" as const,
      startDate:"2026-09-09",description:"Owner changed calendar details"};
    let review: any;
    const writes: any[]=[];
    const db: any = {
      select: () => {
        let rows: any[]=[];
        const q: any={from:(table:unknown)=>{
          rows=table===googleOperationalCalendarLinks?[link]:table===googleOperationalCalendarReviews?(review?[review]:[]):
            table===bookings?[{id:"booking",name:"Fair"}]:[];return q;
        },where:()=>q,limit:()=>q,for:()=>q,then:(resolve:any)=>Promise.resolve(rows).then(resolve)};
        return q;
      },
      insert:(table:unknown)=>({values:(value:any)=>({
        onConflictDoNothing:async()=>{review={id:"review",...value};},
      })}),
      update:(table:unknown)=>({set:(value:any)=>({where:async()=>{
        writes.push(table);
        Object.assign(table===googleOperationalCalendarLinks?link:review,value);
      }})}),
      execute:vi.fn(),
    };
    const repo=new OperationalCalendarLinkRepository(db);
    const client:any={listEvents:vi.fn(async()=>({events:[external],nextPageToken:null})),
      getEvent:vi.fn(),createEvent:vi.fn(),updateEvent:vi.fn()};
    const connection=async()=>({connectionId:"connection",calendarId:"calendar",client});
    return {original,link,external,db,repo,client,connection,writes};
  }
  it("retains reviewed buffers and source provenance through external edit, review and legacy sync",async()=>{
    const f=fixture();
    const importer=new OperationalCalendarImportService(f.db,f.connection,f.repo);
    expect(await importer.importWindow({from:new Date("2026-09-01"),to:new Date("2026-10-01")})).toMatchObject({review:1});
    await f.repo.resolveReview({reviewId:"review",resolution:"link_existing",bookingId:"booking",reviewedBy:"owner"});
    expect(f.link.lastAppSnapshot).toMatchObject({
      profilePreviewId:"preview",sourceFingerprint:"proof-v1",sources:f.original.sources,
      startDate:"2026-09-09",profileReviewedSnapshot:f.original,
    });
    const service=new OperationalCalendarSyncService({createOperationalCalendarClient:f.connection},{
      loadConfirmedBooking:async()=>({bookingId:"booking",managerName:"Owner",eventName:"Fair",city:"Town",region:"CO",
        actualEventDateText:"September 12",reservedStart:new Date("2026-09-10"),reservedEnd:new Date("2026-09-14"),packages:["zone"]}),
      saveOperationalWindow:vi.fn(),
    },f.repo);
    expect(await service.syncConfirmedBooking("booking")).toMatchObject({state:"review_required",created:0,updated:0});
    expect(f.client.updateEvent).not.toHaveBeenCalled();expect(f.client.createEvent).not.toHaveBeenCalled();
    expect(f.writes).toEqual([googleOperationalCalendarLinks,googleOperationalCalendarReviews]);
    expect(f.db.execute).not.toHaveBeenCalled();
    // A second import sees the accepted external snapshot without losing the original buffer intent.
    expect(await importer.importWindow({from:new Date("2026-09-01"),to:new Date("2026-10-01")})).toMatchObject({review:0,matched:1});
  });
  it("rejects reassigning a reviewed event to another booking before writes",async()=>{
    const f=fixture();
    await new OperationalCalendarImportService(f.db,f.connection,f.repo)
      .importWindow({from:new Date("2026-09-01"),to:new Date("2026-10-01")});
    await expect(f.repo.resolveReview({reviewId:"review",resolution:"link_existing",bookingId:"other",reviewedBy:"owner"}))
      .rejects.toThrow("GOOGLE_OPERATIONAL_CALENDAR_REVIEWED_IDENTITY_CHANGE_BLOCKED");
    expect(f.writes).toEqual([]);
  });
});
