import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, X } from "lucide-react";
import { Link } from "wouter";

import { apiGet, apiPost } from "@/lib/auth-token";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";

import {
  unresolvedTokens,
  type NoticeDispatch,
  type ServerAudience,
  type Template,
} from "./types";

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <p className="font-semibold text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function EmailCampaignsTab({ setNotice }: { setNotice: NoticeDispatch }) {
  const [audiences, setAudiences] = useState<ServerAudience[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // form state
  const [name, setName] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [audiencesData, templatesData] = await Promise.all([
        apiGet<{ audiences: ServerAudience[] }>("/marketing/audiences"),
        apiGet<{ templates: Template[] }>("/marketing/templates"),
      ]);
      setAudiences(audiencesData.audiences);
      setTemplates(templatesData.templates);
    } catch {
      setError("Could not load audiences or templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  function pickTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (tpl) {
      setSubjectTemplate(tpl.subjectTemplate ?? "");
      setBodyTemplate(tpl.bodyTemplate ?? "");
    }
  }

  const subjectTokenWarnings = subjectTemplate ? unresolvedTokens(subjectTemplate) : [];
  const bodyTokenWarnings = bodyTemplate ? unresolvedTokens(bodyTemplate) : [];

  async function handleCreate() {
    if (!name.trim() || !audienceId || !templateId || !senderName.trim() || saving) return;
    setSaving(true);
    try {
      await apiPost("/marketing/campaigns", {
        name: name.trim(),
        audienceId,
        templateId,
        senderName: senderName.trim(),
        senderEmail: senderEmail.trim() || null,
        subjectTemplate: subjectTemplate.trim() || null,
        bodyTemplate: bodyTemplate.trim() || null,
      });
      setNotice({
        kind: "ok",
        text: `Campaign "${name.trim()}" created as a draft. Open Campaign History to review and send.`,
      });
      setCreating(false);
      setName("");
      setAudienceId("");
      setTemplateId("");
      setSenderName("");
      setSenderEmail("");
      setSubjectTemplate("");
      setBodyTemplate("");
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not create campaign.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-8 w-48" />
        {[0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
    );
  }

  if (error) return <ErrorState message={error} onRetry={fetchData} />;

  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Campaigns are built from a saved template and a durable audience. Subject and body
          copy are editable per campaign and the template source is preserved.
        </p>
        <Button
          size="sm"
          onClick={() => setCreating((v) => !v)}
          data-testid="campaign-create-btn"
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </Button>
      </div>

      {creating ? (
        <div className="rounded-xl border border-border bg-card p-4" data-testid="campaign-form">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">New Campaign</h2>
            <button
              onClick={() => setCreating(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {audiences.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              No audiences exist yet. Create an audience first from the Audiences tab.
            </div>
          ) : null}
          {templates.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              No active email templates found. An administrator must create an active
              owner-scoped email template in Settings.
            </div>
          ) : null}

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              Campaign name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="2027 county fair outreach"
                data-testid="campaign-name-input"
              />
            </label>

            <label className="grid gap-1 text-sm font-semibold">
              Audience
              <select
                value={audienceId}
                onChange={(e) => setAudienceId(e.target.value)}
                data-testid="campaign-audience-select"
              >
                <option value="">Choose an audience…</option>
                {audiences.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.memberCount} members)
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm font-semibold">
              Template
              <select
                value={templateId}
                onChange={(e) => pickTemplate(e.target.value)}
                data-testid="campaign-template-select"
              >
                <option value="">Choose a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedTemplate?.requiredPlaceholders?.length ? (
              <p className="text-xs text-muted-foreground">
                Required placeholders:{" "}
                {selectedTemplate.requiredPlaceholders.join(", ")}
              </p>
            ) : null}

            <label className="grid gap-1 text-sm font-semibold">
              Sender name
              <input
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="The Adventure Zone"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Sender email (optional)
              <input
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="hello@adventurezone.com"
              />
            </label>

            <div className="grid gap-1">
              <label className="text-sm font-semibold">
                Subject
                <input
                  className="mt-1"
                  value={subjectTemplate}
                  onChange={(e) => setSubjectTemplate(e.target.value)}
                  placeholder="Subject line…"
                  data-testid="campaign-subject-input"
                />
              </label>
              {subjectTokenWarnings.length > 0 ? (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  Unresolved tokens: {subjectTokenWarnings.join(", ")}
                </p>
              ) : null}
            </div>

            <div className="grid gap-1">
              <label className="text-sm font-semibold">
                Email body
                <textarea
                  className="mt-1"
                  rows={10}
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  placeholder="Campaign email body…"
                  data-testid="campaign-body-input"
                />
              </label>
              {bodyTokenWarnings.length > 0 ? (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  Unresolved tokens: {bodyTokenWarnings.join(", ")}
                </p>
              ) : null}
            </div>

            {subjectTemplate ? (
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1">
                  Representative preview
                </p>
                <p className="text-sm font-semibold">{subjectTemplate}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {bodyTemplate}
                </p>
              </div>
            ) : null}

            <div className="flex gap-2">
              <button
                className="button-primary flex-1"
                disabled={
                  !name.trim() || !audienceId || !templateId || !senderName.trim() || saving
                }
                onClick={() => void handleCreate()}
                data-testid="campaign-save-btn"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create Campaign Draft
              </button>
              <button className="button-secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        After creating a campaign draft, go to Campaign History to request review, approve,
        test-send, schedule, or send.
        <Link
          href="/marketing?area=history"
          className="ml-2 font-semibold text-primary hover:underline"
        >
          View history
        </Link>
      </div>
    </section>
  );
}
