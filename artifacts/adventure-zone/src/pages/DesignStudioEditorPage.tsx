import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clipboard,
  ExternalLink,
  Link as LinkIcon,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import { Link, useParams } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { designStudioApi, type DesignProject } from "@/lib/design-studio-api";
import { CANVA_STARTERS } from "@/lib/design-studio/canva-starters";

const CANVA_CREATE_URL = "https://www.canva.com/create/";
const CANVA_URL_PREFIX = "CANVA_URL=";
const STARTER_PREFIX = "CANVA_STARTER_ID=";

function noteValue(notes: string | null | undefined, prefix: string) {
  return (notes ?? "")
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

function buildNotes(existing: string | null | undefined, starterId: string, canvaUrl: string) {
  const other = (existing ?? "")
    .split("\n")
    .filter((line) => line && !line.startsWith(STARTER_PREFIX) && !line.startsWith(CANVA_URL_PREFIX));
  const lines = [starterId ? `${STARTER_PREFIX}${starterId}` : "", canvaUrl.trim() ? `${CANVA_URL_PREFIX}${canvaUrl.trim()}` : "", ...other].filter(Boolean);
  return lines.join("\n");
}

export default function DesignStudioEditorPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<DesignProject | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [canvaUrl, setCanvaUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    setLoading(true);
    designStudioApi.get(params.id)
      .then((value) => {
        setProject(value);
        setName(value.name);
        setContent(value.content ?? "");
        setCanvaUrl(noteValue(value.notes, CANVA_URL_PREFIX));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Project could not be loaded."))
      .finally(() => setLoading(false));
  }, [params.id]);

  const starterId = useMemo(() => noteValue(project?.notes, STARTER_PREFIX), [project?.notes]);
  const starter = useMemo(() => CANVA_STARTERS.find((item) => item.id === starterId), [starterId]);

  async function save() {
    if (!params.id || !project || !name.trim()) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const value = await designStudioApi.update(params.id, {
        name: name.trim(),
        type: project.type,
        content,
        notes: buildNotes(project.notes, starterId, canvaUrl),
        syncState: "synced",
      });
      setProject(value);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy automatically. You can still select the text below and copy it manually.");
    }
  }

  function openCanva() {
    const target = canvaUrl.trim() || CANVA_CREATE_URL;
    window.open(target, "_blank", "noopener,noreferrer");
  }

  if (loading) {
    return (
      <div className="mx-auto grid max-w-6xl gap-5 p-4">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center" role="alert">
        <p className="text-lg font-bold">This design is unavailable.</p>
        <p className="mt-2 text-sm text-muted-foreground">{error ?? "It may have been removed or archived."}</p>
        <Link className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-muted" href="/design-studio">
          <ArrowLeft className="h-4 w-4" />
          Return to Design Studio
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Link className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-muted" href="/design-studio" aria-label="Back to Design Studio">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Canva project</p>
            <h1 className="truncate text-xl font-black text-foreground">{project.name}</h1>
          </div>
          <Badge variant="outline" className="hidden capitalize sm:inline-flex">{project.type}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {saved ? <span className="hidden items-center gap-1 text-xs font-semibold text-primary sm:flex"><Check className="h-3.5 w-3.5" />Saved</span> : null}
          <Button className="gap-2" disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}

      <section className="relative overflow-hidden rounded-2xl bg-sidebar p-6 text-sidebar-foreground shadow-lg md:p-8">
        <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sidebar-border bg-sidebar-accent/40 px-3 py-1 text-xs font-black uppercase tracking-[0.16em]">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              Free Canva workflow
            </div>
            <h2 className="mt-4 text-3xl font-black tracking-tight">Edit the visual in Canva. Keep the project organized here.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-sidebar-foreground/70">
              Copy the prepared Adventure Zone text, open Canva, build or duplicate the design there, then paste the Canva design link back into this project. No Brand Kit, Autofill, or Canva Pro feature is required.
            </p>
          </div>
          <Button className="gap-2 bg-primary text-primary-foreground" size="lg" onClick={openCanva}>
            <ExternalLink className="h-4 w-4" />
            {canvaUrl.trim() ? "Open saved Canva design" : "Open Canva Free"}
          </Button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Prepared content</p>
              <h2 className="mt-1 text-xl font-black">Copy into Canva</h2>
              {starter ? <p className="mt-1 text-sm text-muted-foreground">Starter: {starter.name} • {starter.canvasSize}</p> : null}
            </div>
            <Button className="gap-2" onClick={() => void copyContent()} variant="outline">
              {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
              {copied ? "Copied" : "Copy all text"}
            </Button>
          </div>
          <Textarea
            className="mt-5 min-h-[28rem] resize-y font-mono text-sm leading-relaxed"
            onChange={(event) => { setContent(event.target.value); setSaved(false); }}
            value={content}
          />
        </section>

        <aside className="grid content-start gap-5">
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <Label htmlFor="design-name">Project name</Label>
            <Input id="design-name" className="mt-2" value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} />
          </section>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-primary" />
              <h2 className="font-black">Canva design link</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">After you make or duplicate the design in Canva, paste its normal share/edit URL here so you can jump straight back to it later.</p>
            <Input className="mt-4" placeholder="https://www.canva.com/design/..." value={canvaUrl} onChange={(event) => { setCanvaUrl(event.target.value); setSaved(false); }} />
            <Button className="mt-3 w-full gap-2" onClick={openCanva} variant="outline">
              <ExternalLink className="h-4 w-4" />
              {canvaUrl.trim() ? "Open design" : "Create in Canva"}
            </Button>
          </section>

          <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-5">
            <p className="font-black text-foreground">What happened to the old editor?</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">It is intentionally retired from this workflow. Canva now handles visual editing; Command Center handles the business context, prepared copy, and saved design links.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
