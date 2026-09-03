// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app=readFileSync("src/App.tsx","utf8");
const shell=readFileSync("src/components/office/office-shell.tsx","utf8");
const auth=readFileSync("src/lib/office-auth-context.tsx","utf8");

describe("Office Coordinator frontend routing",()=>{
  it("registers Office routes before the generic owner fallback",()=>{
    expect(app).toContain('path="/office/sign-in"');
    expect(app).toContain("OFFICE_PROTECTED_PATH");
    expect(app.indexOf('path="/office/sign-in"')).toBeLessThan(app.indexOf("<Route><Protected><AdminProtectedApp"));
    for(const route of ["/office/website-inquiries","/office/profiles/:profileId","/office/profiles","/office/mail","/office/emails","/office/tasks","/office/messages"]){expect(app).toContain(`path=\"${route}\"`);}
    expect(app).toContain('office.canReviewWebsiteInquiries');
    expect(app).toContain('path="/website-inquiries"');
  });
  it("uses a separate Office bearer token and shell",()=>{
    expect(auth).toContain('const STORAGE_KEY = "az_office_token"');
    expect(auth).not.toContain('az_owner_token');
    expect(auth).not.toContain('az_manager_token');
    expect(app).toContain("<OfficeShell>");
    expect(shell).toContain("Office Coordinator");
    expect(shell).toContain("Booking Workspace");
    for(const forbidden of ["Finances","Crew","Leg management","ACT recovery"]){expect(shell).not.toContain(forbidden);}
  });
});
