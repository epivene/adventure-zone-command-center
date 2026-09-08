import { WebsiteInquiryInbox } from "@/features/website-inquiries/website-inquiry-inbox";
import { createWebsiteInquiryApi } from "@/features/website-inquiries/website-inquiry-api";
import { officeGet, officePatch, officePost } from "@/lib/office-auth-context";

const api = createWebsiteInquiryApi({ get: officeGet, patch: officePatch, post: officePost });

export default function OfficeWebsiteInquiriesPage() {
  return <WebsiteInquiryInbox api={api} />;
}
