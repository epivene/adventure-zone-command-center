import { describe, expect, it } from "vitest";
import { classifyProfileLabelEvidence, profileLabelEvidenceIndex } from "./google-profile-label-evidence";

const profile = { id: "wfa", name: "ASSOC - WFA Western Fairs Association" };
const other = { id: "other", name: "Other Fair" };
const label = { id: "label", name: `Profiles/${profile.name}`, type: "user" as const };

describe("profile label ownership evidence", () => {
  it("normalizes case and whitespace but not event identity", () => {
    const index = profileLabelEvidenceIndex({
      labels:[{...label,name:"profiles/  ASSOC - WFA   WESTERN FAIRS ASSOCIATION  "}],
      approvedLabelIds:new Set([label.id]),profiles:[profile],
    });
    expect(classifyProfileLabelEvidence({labelIds:[label.id],index})?.candidates).toEqual([{...profile,kind:"profile"}]);
  });

  it.each(["SHOWS", "Personal/Profiles", "Profiles archive"])("does not infer ownership from the %s root", (root) => {
    const index = profileLabelEvidenceIndex({labels:[{...label,name:`${root}/${profile.name}`}],approvedLabelIds:new Set([label.id]),profiles:[profile]});
    expect(classifyProfileLabelEvidence({labelIds:[label.id],index})).toBeNull();
  });

  it("ignores deselected labels and labels without an exact profile counterpart", () => {
    const deselected = profileLabelEvidenceIndex({labels:[label],approvedLabelIds:new Set(),profiles:[profile]});
    expect(classifyProfileLabelEvidence({labelIds:[label.id],index:deselected})).toBeNull();
    const unknown = profileLabelEvidenceIndex({labels:[{...label,name:"Profiles/Other Fair - Different City UT"}],approvedLabelIds:new Set([label.id]),profiles:[other]});
    expect(classifyProfileLabelEvidence({labelIds:[label.id],index:unknown})).toBeNull();
  });

  it("does not choose between duplicate profile names", () => {
    const index = profileLabelEvidenceIndex({labels:[label],approvedLabelIds:new Set([label.id]),profiles:[profile,{...profile,id:"duplicate"}]});
    const result = classifyProfileLabelEvidence({labelIds:[label.id],index});
    expect(result?.status).toBe("review");
    expect(result?.candidates.map(p=>p.id)).toEqual(["wfa","duplicate"]);
  });

  it("keeps different profile labels and a known/unknown label mix for review", () => {
    for(const entries of [[[profile],[other]],[[profile],[]]]) {
      const result = classifyProfileLabelEvidence({labelIds:["a","b"],index:new Map([["a",entries[0]],["b",entries[1]]])});
      expect(result?.status).toBe("review");
      expect(result?.evidenceCodes).toContain("profile_label_conflict");
    }
  });

  it("deduplicates current and legacy labels for the same profile", () => {
    const result = classifyProfileLabelEvidence({labelIds:["a","b"],index:new Map([["a",[profile]],["b",[profile]]]),existingThreadTarget:profile});
    expect(result?.status).toBe("matched");
    expect(result?.candidates).toEqual([{...profile,kind:"profile"}]);
  });
});
