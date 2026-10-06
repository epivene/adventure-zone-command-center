import { GoogleValidationReview } from "@/components/google-workspace/google-validation-review";
import { EmailAttentionControls } from "@/components/google-workspace/email-attention-controls";
export function EmailReviewPane({selectedMessageId,profileId}: {selectedMessageId?:string;profileId?:string}) {
 return <div className="mt-4 min-w-0">{selectedMessageId && profileId ? <EmailAttentionControls messageId={selectedMessageId} profileId={profileId}/> : null}
 <GoogleValidationReview presentation="workspace" initialMessageId={selectedMessageId} showGmailActions showHistory /></div>;
}
