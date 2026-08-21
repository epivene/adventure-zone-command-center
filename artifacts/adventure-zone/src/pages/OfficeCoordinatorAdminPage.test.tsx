// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source=readFileSync("src/pages/OfficeCoordinatorAdminPage.tsx","utf8");
const menu=readFileSync("src/components/navigation/app-menu.tsx","utf8");

describe("owner Office Coordinator controls",()=>{
  it("provides the complete owner workflow",()=>{
    for(const label of ["Work Queue","Email Review","Mail & History","Messages","Account","Add to Queue","Send","Edit & Send","Return for Changes","Reset Password","Disable Account","Sign Out All"]){expect(source).toContain(label);}
  });
  it("keeps Office Coordinator navigation with bookings and follow-ups",()=>{
    const bookingGroup=menu.slice(menu.indexOf('label: "Bookings & Follow-ups"'),menu.indexOf('label: "Legs & Operations"'));
    expect(bookingGroup).toContain('{ href: "/office-coordinator", label: "Office Coordinator" }');
  });
});
