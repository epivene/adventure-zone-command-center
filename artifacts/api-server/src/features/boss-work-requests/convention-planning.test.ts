import { describe, expect, it } from "vitest";
import { conventionDraftSchema, conventionSubmissionSchema, createWorkRequestSchema } from "./boss-work-request-types";

describe("convention planning questionnaire", () => {
  it("accepts the questionnaire as a form request without an email template", () => {
    expect(createWorkRequestSchema.safeParse({type:"convention_planning_questionnaire",assignedBossAccountId:"11111111-1111-4111-8111-111111111111",title:"Convention Planning Decisions"}).success).toBe(true);
  });
  it("preserves all saved answers in draft and submitted payloads", () => {
    const payload={eventName:"Convention Planning Decisions",planningAnswers:{rmafAttendees:"Dave",rmafAdvertising:"No advertising",wyomingAttendance:"Attend only the confirmed showcase day",heartlandRooms:"2",westernBooth:"Reserve a trade-show booth",budget:"5000",additionalNotes:"Call me before booking"}};
    const draft=conventionDraftSchema.safeParse({clientRevision:4,payload});
    expect(draft.success).toBe(true);
    if(draft.success)expect(draft.data.payload.planningAnswers).toEqual(payload.planningAnswers);
    const submitted=conventionSubmissionSchema.safeParse({clientMutationId:"22222222-2222-4222-8222-222222222222",payload});
    expect(submitted.success).toBe(true);
    if(submitted.success)expect(submitted.data.payload.planningAnswers).toEqual(payload.planningAnswers);
  });
  it("still accepts existing rapid convention notes", () => {
    expect(conventionSubmissionSchema.safeParse({clientMutationId:"22222222-2222-4222-8222-222222222222",payload:{eventName:"County Fair",notes:"Follow up"}}).success).toBe(true);
  });
});
