// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const today=readFileSync("src/pages/OfficeTodayPage.tsx","utf8");
const tasks=readFileSync("src/components/office/office-task-card.tsx","utf8");
const profile=readFileSync("src/pages/OfficeProfilePage.tsx","utf8");
const profiles=readFileSync("src/pages/OfficeProfilesPage.tsx","utf8");
const family=readFileSync("src/pages/OfficeFamilyPage.tsx","utf8");
const shell=readFileSync("src/components/office/office-shell.tsx","utf8");
const emails=readFileSync("src/pages/OfficeEmailDraftsPage.tsx","utf8");
const brochures=readFileSync("src/pages/OfficeMailPage.tsx","utf8");

describe("Office Coordinator daily workspace",()=>{
  it("uses confident, neutral work language",()=>{
    expect(today).toContain("Next up");
    expect(tasks).toContain("Needs Help");
    expect(shell).toContain('"Brochures"');
    expect(shell).toContain('"Emails"');
    expect(emails).toContain(">Emails<");
    expect(brochures).toContain(">Brochures<");
    for(const text of ["To do","In progress","Waiting","Done"]){expect(tasks).toContain(text);}
    const combined=[today,tasks,profile,profiles,family,shell,emails,brochures].join("\n");
    for(const forbidden of ["Support Portal","Limited Manager","Restricted Access","Supervised","Awaiting Desiree","Checked by Admin","Sales Priority","Email Drafts"]){expect(combined).not.toContain(forbidden);}
  });
  it("gives profiles admin-quality identity and factual work actions without owner strategy controls",()=>{
    for(const action of ["Edit Profile","Edit contact","Edit location","Add Note","Draft Email"]){expect(profile.toLowerCase()).toContain(action.toLowerCase());}
    expect(profile).not.toContain("profileImageDataUrl");
    expect(profile).toContain("StatCard");
    for(const section of ["Contacts","Events","Notes & History"]){expect(profile).toContain(section);}
    for(const forbidden of ["Last Resort","Probability","Travel Leg","Import","Merge profiles"]){expect(profile).not.toContain(forbidden);}
  });
  it("uses compact profile cards without photos",()=>{
    expect(profiles).not.toContain("profileImageDataUrl");
    expect(profiles).toContain("12 per page");
  });
  it("matches the main console with a collapsed Event Families dropdown",()=>{
    expect(profiles).toContain("<details");
    expect(profiles).toContain("<summary");
    expect(profiles).toContain("Event Families");
    expect(profiles).toContain("data.families.length");
    expect(profiles).toContain("familyId=");
    expect(family).toContain("Event Profiles");
    expect(family.toLowerCase()).toContain("brochures");
    expect(family).toContain("/office/profiles/${member.id}");
  });
});
