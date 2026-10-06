import { Redirect, useSearch } from "wouter";
import { legacyReviewUrl } from "@/features/emails/email-workspace-state";
export function EmailReviewPage() { return <Redirect to={legacyReviewUrl(useSearch())} replace />; }
export default EmailReviewPage;
