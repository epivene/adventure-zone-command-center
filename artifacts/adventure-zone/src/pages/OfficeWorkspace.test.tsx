// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const today=readFileSync("src/pages/OfficeTodayPage.tsx","utf8");
const tasks=readFileSync("src/components/office/office-task-card.tsx","utf8");
const profile=readFileSync("src/pages/OfficeProfilePage.tsx","utf8");
const profiles=readFileSync("src/pages/OfficeProfilesPage.tsx","utf8");
const family=readFileSync("src/pages/OfficeFamilyPage.tsx","utf8");
const shell=readFileSync("src/components/office/office-shell.tsx","utf8");

describe("Office Coordinator daily workspace",()=>{
  it("uses the approved neutral work language",()=>{
    expect(today).toContain("Next up");
    expect(tasks).toContain("Needs Help");
    for(const text of ["To do","In progress","Waiting","Done"]){expect(tasks).toContain(text);}
    const combined=[today,tasks,profile,profiles,family,shell].join("\n");
    for(const forbidden of ["Support Portal","Limited Manager","Restricted Access","Supervised","Awaiting Desiree","Checked by Admin","Sales Priority"]){expect(combined).not.toContain(forbidden);}
  });
  it("gives profiles factual work actions without owner strategy controls",()=>{
    for(const action of ["Edit Profile","Edit contact","Edit location","Add Note","Draft Email"]){expect(profile.toLowerCase()).toContain(action.toLowerCase());}
    for(const forbidden of ["Last Resort","Probability","Travel Leg","Import","Merge profiles"]){expect(profile).not.toContain(forbidden);}
  });
  it("keeps grouped event families visible and opens their member profiles",()=>{
    expect(profiles).toContain("Event Families");
    expect(profiles).toContain("familyId=");
    expect(family).toContain("Locations & event profiles");
    expect(family).toContain("/office/profiles/${member.id}");
  });
});
