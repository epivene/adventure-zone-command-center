import { GoogleValidationReview } from "@/components/google-workspace/google-validation-review";
import { EmailAttentionControls } from "@/components/google-workspace/email-attention-controls";
import { attentionContextKey } from "./email-workspace-state";
export function EmailReviewPane({selectedMessageId,attentionMessageId,profileId,accountId,onReadingChange}: {selectedMessageId?:string;attentionMessageId?:string;profileId?:string;accountId?:string;onReadingChange?:(reading:boolean)=>void}) {
 return <div className="mt-4 min-w-0">{attentionMessageId && profileId ? <EmailAttentionControls key={attentionContextKey(accountId || "",attentionMessageId,profileId)} messageId={attentionMessageId} profileId={profileId}/> : null}
 <GoogleValidationReview key={accountId || "connecting"} presentation="workspace" initialMessageId={selectedMessageId} contextAccountId={accountId} onReadingChange={onReadingChange} showGmailActions showHistory /></div>;
}
