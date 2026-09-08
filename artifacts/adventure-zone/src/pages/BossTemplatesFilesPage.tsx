import { RoleBusinessDocumentsPage } from "@/components/business-documents/role-business-documents-page";
import { bossBusinessDocumentsApi } from "@/lib/boss-documents-api";

export default function BossTemplatesFilesPage() {
  return <RoleBusinessDocumentsPage api={bossBusinessDocumentsApi} eyebrow="Boss file system" />;
}
