import { useEffect, useMemo, useState } from "react";
import { FileSignature, Plus, RefreshCw } from "lucide-react";
import { Link } from "wouter";

import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { ProfileDesignStudioPicker } from "./ProfileDesignStudioPicker";
import {
  designStudioApi,
  type DesignProject,
} from "@/lib/design-studio-api";

export function ProfileDesignDocuments({
  organizationId,
  contactId,
  bookingId,
  documentYear,
}: {
  organizationId: string;
  contactId?: string | null;
  bookingId?: string | null;
  documentYear: number;
}) {
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reuseId, setReuseId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setProjects(await designStudioApi.listForProfile(organizationId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profile documents could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [organizationId]);

  const groups = useMemo(() => {
    const currentDrafts = projects.filter((project) =>
      project.status === "draft" || project.status === "ready",
    );
    const previousYears = projects.filter((project) =>
      Boolean(project.documentYear && project.documentYear < documentYear),
    );
    const final = projects.filter((project) =>
      (project.status === "used" || project.status === "sent") &&
      !previousYears.includes(project),
    );
    return { currentDrafts, final, previousYears };
  }, [documentYear, projects]);

  async function useForNewYear(project: DesignProject) {
    const targetYear = project.documentYear && project.documentYear >= documentYear
      ? project.documentYear + 1
      : documentYear;
    setReuseId(project.id);
    setError("");
    try {
      const draft = await designStudioApi.useForNewYear(project.id, targetYear);
      setProjects((items) => [draft, ...items]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The next-year draft could not be created.");
    } finally {
      setReuseId(null);
    }
  }

  function group(title: string, items: DesignProject[], historical = false) {
    if (!items.length) return null;
    return (
      <div>
        <h3 className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
        <div className="mt-2 grid gap-2">
          {items.map((project) => (
            <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between" key={project.id}>
              <div className="min-w-0">
                <p className="truncate font-bold text-foreground">{project.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="capitalize">{project.type}</Badge>
                  <span className="text-xs text-muted-foreground">{project.documentYear ?? "Year not set"}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/design-studio/${project.id}`}>
                    {historical || project.status === "used" || project.status === "sent" ? "View" : "Edit"}
                  </Link>
                </Button>
                {historical || project.status === "used" || project.status === "sent" ? (
                  <Button
                    disabled={reuseId === project.id}
                    onClick={() => void useForNewYear(project)}
                    size="sm"
                  >
                    {reuseId === project.id ? "Creating..." : "Use for new year"}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[#d8e2dd] bg-[#fbfcf8] p-5 shadow-[0_12px_32px_rgba(32,71,77,0.04)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#75908b]">Profile documents</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold text-[#173b48]">
            <FileSignature className="h-5 w-5 text-[#397064]" />
            Design Studio
          </h2>
          <p className="mt-1 text-sm text-[#71848a]">
            Emails, contracts, and proposals saved for this profile.
          </p>
        </div>
        <Button onClick={() => setPickerOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Choose template
        </Button>
      </div>

      {error ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          <span>{error}</span>
          <Button onClick={() => void load()} size="sm" variant="outline">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-5 text-sm text-muted-foreground">Loading profile documents...</p>
      ) : projects.length ? (
        <div className="mt-5 grid gap-5">
          {group("Current drafts", groups.currentDrafts)}
          {group("Final and sent", groups.final, true)}
          {group("Previous years", groups.previousYears, true)}
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          No Design Studio documents are saved to this profile yet.
        </p>
      )}

      <ProfileDesignStudioPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        organizationId={organizationId}
        contactId={contactId}
        bookingId={bookingId}
        documentYear={documentYear}
      />
    </section>
  );
}
