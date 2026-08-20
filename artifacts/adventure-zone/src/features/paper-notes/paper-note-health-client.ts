import { apiGet } from "@/lib/auth-token";
import type { PaperNoteHealthView } from "@/components/paper-notes/paper-note-health-banner";

export function getPaperNoteHealth() {
  return apiGet<PaperNoteHealthView>("/paper-notes/health");
}
