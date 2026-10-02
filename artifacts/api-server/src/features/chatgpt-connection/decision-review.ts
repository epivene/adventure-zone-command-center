import { classifyBusinessDueDate } from "../../lib/business-date";
import type { MasterWorkItem } from "../today/master-work-queue";

/** Saved queue evidence only. Recommendations never assert that source review occurred. */
export function decisionReview(item: MasterWorkItem, now: Date) {
  if (item.completedAt) return null;
  const due = item.dueAt ? classifyBusinessDueDate(item.dueAt, now) : null;
  const followup = {
    category: "follow_up",
    recommendedNextStep:
      "Read the latest conversation and existing drafts; if still unanswered, prepare a follow-up for review.",
    ownerDecision: "Review the proposed follow-up before sending.",
  };
  let advice;
  if (item.attentionState === "waiting_for_their_reply") {
    if (!due || due === "future") return null;
    advice = followup;
  } else if (
    item.attentionState === "needs_your_reply" ||
    item.kind === "reply"
  ) {
    advice = {
      category: "reply",
      recommendedNextStep:
        "Read the latest thread and profile history, identify unanswered questions, and prepare a reply for review.",
      ownerDecision:
        "Review the proposed reply and any questions requiring your decision.",
    };
  } else if (item.kind === "draft") {
    advice = {
      category: "draft_review",
      recommendedNextStep:
        "List and read the actual app drafts; verify recipient, event year, latest conversation, attachments and duplicate outreach before presenting a draft.",
      ownerDecision: "Review the verified draft and decide whether to send it.",
    };
  } else if (item.kind === "follow_up" || item.kind === "callback") {
    if (!due || due === "future") return null;
    advice =
      item.kind === "callback"
        ? {
            category: "callback",
            recommendedNextStep:
              "Read the latest contact history and confirm the callback is still needed; prepare talking points.",
            ownerDecision:
              "Decide whether to make the call after reviewing the context.",
          }
        : followup;
  } else {
    advice = {
      category: "investigate",
      recommendedNextStep:
        "Read the linked profile and source record; identify the specific missing information or approval and propose a next step.",
      ownerDecision:
        "Decide only after the actual blocker and supporting evidence are identified.",
    };
  }
  return {
    ...advice,
    whatHappened: item.reason,
    dueClassification: due,
    sourceReviewRequired: true,
    sendApprovalRequired: true,
  };
}
