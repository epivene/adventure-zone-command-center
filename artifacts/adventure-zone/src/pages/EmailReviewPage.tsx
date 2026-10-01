import { EmailAttentionControls } from "@/components/google-workspace/email-attention-controls";
import { useState } from "react";
import { MailQuestion } from "lucide-react";

import { GoogleValidationReview } from "@/components/google-workspace/google-validation-review";

export function EmailReviewPage() {
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const params = new URLSearchParams(window.location.search);
  const messageId = params.get("attentionMessage"), profileId = params.get("profileId");
  return (
    <div className="mx-auto grid max-w-5xl gap-6 pb-10">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700 dark:text-orange-300">
          Booking
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <MailQuestion className="h-7 w-7 text-orange-600" />
          <h1 className="text-3xl font-bold tracking-tight">Email Review</h1>
          {pendingCount !== null ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {pendingCount} waiting for you
            </span>
          ) : null}
        </div>
        <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-300">
          Review Gmail conversations that could not be matched safely. Attach each one to a profile, create a new profile, or ignore it.
        </p>
      </header>

      {messageId && profileId ? <EmailAttentionControls key={messageId + profileId} messageId={messageId} profileId={profileId} /> : null}
      <GoogleValidationReview
        onPendingCountChange={setPendingCount}
        showGmailActions
        showHistory
      />
    </div>
  );
}

export default EmailReviewPage;
