import { RoleBusinessDocumentsPage } from "@/components/business-documents/role-business-documents-page";
import { officeBusinessDocumentsApi } from "@/lib/office-documents-api";

export default function OfficeDocumentsPage() {
  return <RoleBusinessDocumentsPage api={officeBusinessDocumentsApi} eyebrow="Office file system" />;
}
