import { expect, it } from "vitest";
import { observePilotThread } from "./google-pilot-sync";
const sent = { id: "sent", labelIds: ["SENT"], internalDateMs: 1, from: "office@example.com", to: "customer@example.com", subject: "2027", bodyText: "Proposal", attachments: [] };
const draft = { ...sent, id: "draft-v2", labelIds: ["DRAFT"], internalDateMs: 3, bodyText: "Owner's revised proposal" };
const incoming = { ...sent, id: "reply", labelIds: [], internalDateMs: 4, from: "customer@example.com", bodyText: "Can we discuss?" };
it("keeps edited drafts distinct from sent mail and preserves current content", () => {
  const value = observePilotThread([sent, draft], "office@example.com", "owner_decision", "sent");
  expect(value.state).toBe("draft_to_review");
  expect(value.drafts[0]).toMatchObject({id:"draft-v2",bodyText:"Owner's revised proposal"});
  expect(value.latestSentMessageId).toBe("sent");
});
it("never infers sending from a missing draft", () => {
  expect(observePilotThread([sent], "office@example.com", "draft_to_review", "sent", true).state).toBe("draft_missing");
});
it("requires a new SENT message before reporting waiting", () => {
  expect(observePilotThread([sent, {...sent,id:"actually-sent",internalDateMs:5}], "office@example.com", "draft_to_review", "sent", true).state).toBe("waiting_for_reply");
});
it("shows new customer replies even with an older draft", () => {
  expect(observePilotThread([sent,draft,incoming], "office@example.com", "waiting_for_reply", "sent").state).toBe("reply_to_review");
});
it("does not hide an unread reply behind an older draft on the next sync", () => {
  expect(observePilotThread([sent,draft,incoming], "office@example.com", "reply_to_review", "reply").state).toBe("reply_to_review");
});
it("keeps bounce handling ahead of a draft", () => {
  const bounce={...incoming,from:"Mail Delivery Subsystem <mailer-daemon@googlemail.com>",bodyText:"550 5.1.1 Address not found"};
  expect(observePilotThread([sent,draft,bounce], "office@example.com", "waiting_for_reply", "sent").state).toBe("contact_blocked");
});
it("preserves the reviewed owner decision when no new sent or received message exists", () => {
  expect(observePilotThread([incoming], "office@example.com", "owner_decision", "reply").state).toBe("owner_decision");
});
