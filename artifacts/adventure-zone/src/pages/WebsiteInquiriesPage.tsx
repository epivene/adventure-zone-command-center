import { WebsiteInquiryInbox } from "@/features/website-inquiries/website-inquiry-inbox";
import { createWebsiteInquiryApi } from "@/features/website-inquiries/website-inquiry-api";
import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";

const api = createWebsiteInquiryApi({ get: apiGet, patch: apiPatch, post: apiPost });

export default function WebsiteInquiriesPage() {
  return <WebsiteInquiryInbox api={api} />;
}
