import { useEffect, useState } from "react";
import { useLocation } from "wouter";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/avz-crm/components/ui/dialog";
import { TemplateCatalog } from "@/components/design-studio/TemplateCatalog";
import {
  designStudioApi,
  type DesignTemplate,
} from "@/lib/design-studio-api";

export function ProfileDesignStudioPicker({
  open,
  onOpenChange,
  organizationId,
  contactId,
  bookingId,
  documentYear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  contactId?: string | null;
  bookingId?: string | null;
  documentYear: number;
}) {
  const [, setLocation] = useLocation();
  const [templates, setTemplates] = useState<DesignTemplate[]>([]);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void designStudioApi.listTemplates()
      .then((items) => { if (active) setTemplates(items); })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Templates could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  async function useTemplate(template: DesignTemplate) {
    setCreatingId(template.id);
    setError("");
    try {
      const project = await designStudioApi.instantiateTemplate(template.id, {
        linkedOrganizationId: organizationId,
        linkedContactId: contactId ?? null,
        linkedBookingId: bookingId ?? null,
        documentYear,
      });
      onOpenChange(false);
      setLocation(`/design-studio/${project.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The profile draft could not be created.");
    } finally {
      setCreatingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose a Design Studio template</DialogTitle>
          <DialogDescription>
            This creates an editable {documentYear} draft that stays with this profile.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            {error}
          </div>
        ) : null}
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading current templates...</p>
        ) : (
          <TemplateCatalog
            compact
            templates={templates}
            creatingId={creatingId}
            onUse={(template) => void useTemplate(template)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
