import { expect, it } from "vitest";
import { buildLeadEmailPreview } from "./lead-email-preview-service";
it("withholds copy for a snapshot from another review version or window", () => {
  const preview = buildLeadEmailPreview({ lead: { rowId:"r", reviewVersion: 3, profileName:"Fair", eventName:"Fair", eventCity:"Town", eventRegion:"UT", startDate:"2026-09-29", endDate:"2026-09-29", firstName:null, recipientEmail:"x@example.com", rowState:"verified", recipientConfirmed:true, introductionSuitable:true, relationshipOutcome:"new_introduction", territoryStatus:"open", fitStatus:"approved" }, blocks: [], availability: { ready:true, checkedAt:"2026-08-26T12:00:00.000Z", reviewVersion:2, proposedStartDate:"2026-09-29", proposedEndDate:"2026-09-29", packageAvailability:{status:"resolved", packages:[{packageKey:"adventure_zone",availableQuantity:1}],restrictedOptions:[]} }, now:new Date("2026-08-26T12:01:00.000Z") });
  expect(preview).toMatchObject({ subject:null, body:null, readiness:{ready:false,blockers:["availability_stale_for_lead_version"]} });
});
