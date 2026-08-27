// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source=readFileSync("src/pages/OfficeCoordinatorAdminPage.tsx","utf8");
const menu=readFileSync("src/components/navigation/app-menu.tsx","utf8");

describe("owner Office Coordinator controls",()=>{
  it("provides the complete owner workflow",()=>{
    for(const label of ["Work Queue","Email Review","Mail & History","Messages","Account","Add to Queue","Send","Edit & Send","Return for Changes","Reset Password","Disable Account","Sign Out All"]){expect(source).toContain(label);}
  });
  it("lets owner link a task to a profile and a specific contact",()=>{
    expect(source).toContain("Specific contact");
    expect(source).toContain("contactId,");
    expect(source).toContain("/event-profiles/${profile.id}");
    expect(source).toContain("task.contactFirstName");
  });
  it("keeps Office Coordinator in the booking workspace",()=>{
    const bookingItems=menu.slice(menu.indexOf("const bookingItems"),menu.indexOf("const bookingGroups"));
    expect(bookingItems).toContain('{ href: "/office-coordinator", label: "Office Coordinator" }');
  });
});
