import { expect,it } from "vitest";
import { savedSourceProvesDate } from "./saved-source-date-match";
const pikes="2026-D • NFR Open • July 14–18, Norris Penrose\n\n- Access July 12–19; onsite camping only.\n- Follow separate directions for 2027.";
const endpoint=(field:"public_start"|"public_end"|"reservation_start"|"reservation_end",value:string,semantics:"inclusive_date"|"exclusive_date"|"instant"="inclusive_date")=>({field,value,semantics});
it("recognizes Pikes Peak's named public range and explicit agreement year",()=>{
 expect(savedSourceProvesDate(pikes,endpoint("public_start","2026-07-14"))).toBe(true);
 expect(savedSourceProvesDate(pikes,endpoint("public_end","2026-07-18"))).toBe(true);
});
it("keeps access dates separate from public dates and preserves inclusive ends",()=>{
 expect(savedSourceProvesDate(pikes,endpoint("public_start","2026-07-12"))).toBe(false);
 expect(savedSourceProvesDate(pikes,endpoint("public_end","2026-07-19"))).toBe(false);
 expect(savedSourceProvesDate(pikes,endpoint("reservation_start","2026-07-12"))).toBe(true);
 expect(savedSourceProvesDate(pikes,endpoint("reservation_end","2026-07-19"))).toBe(true);
 expect(savedSourceProvesDate(pikes,endpoint("reservation_start","2026-07-14"))).toBe(false);
 expect(savedSourceProvesDate(pikes,endpoint("public_end","2026-07-18","exclusive_date"))).toBe(false);
 expect(savedSourceProvesDate(pikes,endpoint("public_end","2026-07-19","exclusive_date"))).toBe(false);
});
it.each(["July 14–18, 2026","July 14-18, 2026","Jul. 14th through 18th, 2026","July 14 to July 18, 2026"])("normalizes %s without changing the source",text=>{
 expect(savedSourceProvesDate(text,endpoint("public_start","2026-07-14"))).toBe(true);
 expect(savedSourceProvesDate(text,endpoint("public_end","2026-07-18"))).toBe(true);
});
it("supports a cross-month range with a single explicit year",()=>{
 expect(savedSourceProvesDate("Event July 31–August 2, 2026",endpoint("public_end","2026-08-02"))).toBe(true);
});
it("does not guess missing years or borrow years from other unrelated paragraphs",()=>{
 for(const text of ["July 14–18","Deposit received in 2026.\nJuly 14–18","July 14–18; paperwork for 2026"])
  expect(savedSourceProvesDate(text,endpoint("public_start","2026-07-14"))).toBe(false);
 expect(savedSourceProvesDate(pikes,endpoint("public_start","2027-07-14"))).toBe(false);
});
it("rejects invalid dates, ambiguous years and non-endpoint interior dates",()=>{
 for(const text of ["February 30–31, 2026","July 18–14, 2026","July 14–18, 2026 or 2027"])
  expect(savedSourceProvesDate(text,endpoint("public_start","2026-07-14"))).toBe(false);
 expect(savedSourceProvesDate("February 30, 2026",endpoint("public_start","2026-03-02"))).toBe(false);
 expect(savedSourceProvesDate(pikes,endpoint("public_end","2026-07-16"))).toBe(false);
});
it("retains exact saved ISO evidence without matching date prefixes or inventing a time",()=>{
 expect(savedSourceProvesDate("Confirmed 2026-07-14 through 2026-07-18",endpoint("public_start","2026-07-14"))).toBe(true);
 expect(savedSourceProvesDate("2026-07-140",endpoint("public_start","2026-07-14"))).toBe(false);
 expect(savedSourceProvesDate(pikes,endpoint("public_start","2026-07-14T12:00:00Z","instant"))).toBe(false);
 expect(savedSourceProvesDate("Confirmed arrival 2026-07-12T12:00:00Z",endpoint("reservation_start","2026-07-12T12:00:00Z","instant"))).toBe(true);
});

it("does not promote payment, reminder or insurance dates to public event dates",()=>{
 for(const text of ["Deposit paid July 14, 2026","COI issued July 14, 2026","Reminder for July 14, 2026"])
  expect(savedSourceProvesDate(text,endpoint("public_start","2026-07-14"))).toBe(false);
});

it("rejects human clauses mixing public and access ranges without separate labels",()=>{
 expect(savedSourceProvesDate("Event July 14–18, 2026 with access July 12–19",endpoint("reservation_start","2026-07-14"))).toBe(false);
});

it.each([
 ["Reviewed the full 2022 email thread before the September 1, 2026 reply. Known details: the 2026 event runs weekends August 29-October 18; the booking is Possible; proposed in 2022.","2026-08-29","2026-10-18"],
 ["The Gmail invitation says the 2026 showcase application deadline is Sept. 1. Current HAFFE information confirms the Nov. 19-21, 2026 Minot convention includes showcases and associate/vendor activity.","2026-11-19","2026-11-21"],
 ["Event dates 11/19/2026–11/21/2026","2026-11-19","2026-11-21"],
 ["Event 19–21 November 2026","2026-11-19","2026-11-21"],
])("recognizes local event evidence despite other sentences and formats: %s",(text,start,end)=>{
 expect(savedSourceProvesDate(text,endpoint("public_start",start))).toBe(true);
 expect(savedSourceProvesDate(text,endpoint("public_end",end))).toBe(true);
});
it("keeps normalized access, missing years, impossible dates and ambiguous years separate",()=>{
 expect(savedSourceProvesDate("Access 11/18/2026–11/22/2026",endpoint("reservation_start","2026-11-18"))).toBe(true);
 expect(savedSourceProvesDate("Access 11/18/2026–11/22/2026",endpoint("public_start","2026-11-18"))).toBe(false);
 for(const text of ["Event 11/19–11/21","Event 11/31/2026","Event 19–21 November","Event 19–21 November 2026 or 2027","Deposit paid 11/19/2026"])
  expect(savedSourceProvesDate(text,endpoint("public_start","2026-11-19"))).toBe(false);
});
