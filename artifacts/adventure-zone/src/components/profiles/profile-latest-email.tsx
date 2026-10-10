import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import type { ProfileGoogleEmailState } from "@/components/google-workspace/use-profile-google-email";
import { getGoogleProfileEmailThread, type GoogleThreadDetail, type GoogleThreadMessage } from "@/features/google-workspace/google-workspace-client";
import { emailTime, formatEmailDate, newestEmails } from "@/features/emails/email-presentation";
import { htmlToPlainText } from "./history-summary";

type ProfileEmailThreadReader = (organizationId: string, threadId: string) => Promise<Pick<GoogleThreadDetail, "messages">>;

export function ProfileLatestEmail({ profileId, gmail, compact = false, getThread, openEmailHref }: {
  profileId: string;
  gmail: ProfileGoogleEmailState;
  compact?: boolean;
  getThread?: ProfileEmailThreadReader;
  openEmailHref?: (threadId: string | null) => string;
}) {
  const latest = newestEmails(gmail.conversations)[0];
  const key = latest ? `${profileId}:${latest.threadId}:${emailTime(latest)}` : "";
  const [preview, setPreview] = useState<{ key: string; message: GoogleThreadMessage | null; error: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    if (latest) {
      void (getThread ?? getGoogleProfileEmailThread)(profileId, latest.threadId)
        .then(thread => {
          if (active) setPreview({ key, message: newestEmails(thread.messages)[0] ?? null, error: null });
        })
        .catch(() => {
          if (active) setPreview({ key, message: null, error: "The preview could not load. Open email to read the conversation." });
        });
    }
    return () => { active = false; };
  }, [profileId, key, getThread]);

  useEffect(() => {
    const refresh = () => { if (!document.hidden) void gmail.reload(); };
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(interval); };
  }, [gmail.reload]);

  const currentPreview = preview?.key === key ? preview : null;
  const message = currentPreview?.message;
  const body = message?.bodyText?.trim() || htmlToPlainText(message?.bodyHtml ?? "").trim();
  const params = new URLSearchParams({ profileId });
  if (latest) params.set("threadId", latest.threadId);
  const emailHref = openEmailHref?.(latest?.threadId ?? null) ?? `/emails?${params}`;
  const content = gmail.loading ? <p role="status" className="text-sm text-muted-foreground">Loading the latest profile email…</p>
    : gmail.error ? <div className="grid gap-2">
      <p role="alert" className="text-sm text-destructive">{gmail.error}</p>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => void gmail.reload()}>Retry emails</Button>
    </div>
    : !latest ? <p className="text-sm text-muted-foreground">No linked profile emails yet. Notes and emails remain available under Activity.</p>
    : <>
      <p className="break-words font-semibold">{message?.subject || latest.subject || "(No subject)"}</p>
      <div className="grid gap-1 break-all text-xs text-muted-foreground">
        <p>From: {message?.from || latest.from || "Unknown sender"}</p>
        <p>To: {message?.to || latest.to || "Unknown recipient"}</p>
      </div>
      {!currentPreview ? <p role="status" className="text-sm text-muted-foreground">Loading email preview…</p>
        : currentPreview.error ? <p role="alert" className="text-sm text-destructive">{currentPreview.error}</p>
        : <p className={`whitespace-pre-line break-words text-sm leading-7 ${compact ? "line-clamp-2" : "line-clamp-4"}`}>{body || "No text preview available. Open email to read the full conversation."}</p>}
      {latest.hasAttachments ? <p className="text-xs text-muted-foreground">Includes attachments</p> : null}
    </>;

  if (compact) {
    return <section className="grid gap-3" data-testid="profile-latest-email" aria-label="Latest profile email">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Latest email</p>
          {latest ? <p className="mt-1 text-xs text-muted-foreground">{formatEmailDate(message ?? latest)}</p> : null}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link data-testid="link-open-profile-email" href={emailHref}>{latest ? "Open email" : "Open Emails"}</Link>
        </Button>
      </div>
      {content}
    </section>;
  }

  return <Card className="min-w-0" data-testid="profile-latest-email">
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <CardTitle>Latest email</CardTitle>
        {latest ? <p className="mt-1 text-xs text-muted-foreground">{formatEmailDate(message ?? latest)}</p> : null}
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link data-testid="link-open-profile-email" href={emailHref}>{latest ? "Open email" : "Open Emails"}</Link>
      </Button>
    </CardHeader>
    <CardContent className="grid gap-3">{content}</CardContent>
  </Card>;
}
