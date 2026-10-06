import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { apiGet, apiPost } from "@/lib/auth-token";
import { ProfileCallBrief } from "@/components/profiles/profile-call-brief";
import type { CallBriefProfile } from "@/components/profiles/profile-call-brief-model";
import { mailboxRequest, mailboxError, downloadMailboxAttachment, type MailboxMessage, type MailboxPage, type MailboxThread, type MailboxDraft } from "@/features/google-workspace/mailbox-client";

type Folder = "inbox" | "sent" | "drafts" | "search";
type Composer = { to: string; subject: string; body: string; bodyFormat?: "plain_text" | "html"; threadId?: string };
export default function EmailsPage() {
  const search = useSearch();
  const initialProfile = new URLSearchParams(search).get("profileId") || "";
  const initialView = useRef(readMailboxView(search));
  const [folder, setFolder] = useState<Folder>(initialView.current.folder);
  const [query, setQuery] = useState(initialView.current.query);
  const [searchText, setSearchText] = useState(initialView.current.query);
  const [page, setPage] = useState<MailboxPage | null>(null);
  const [messages, setMessages] = useState<MailboxMessage[]>([]);
  const [selected, setSelected] = useState<MailboxMessage | null>(null);
  const [thread, setThread] = useState<MailboxThread | null>(null);
  const [draft, setDraft] = useState<MailboxDraft | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [profileQuery, setProfileQuery] = useState("");
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const [profileId, setProfileId] = useState(initialProfile);
  const [profile, setProfile] = useState<CallBriefProfile | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; state: string; channel: string; requiredPlaceholders: string[] }>>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [confirmChange, setConfirmChange] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const listScroll = useRef(0);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const actionBusy = useRef(false);
  const pendingDraft = useRef<string | null>(null);
  const restoredThread = useRef(false);
  const accountId = page?.connectionId;

  async function loadPage(token?: string, resetAccount = false) {
    const version = ++listVersion.current;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ folder, query: folder === "search" ? query : "" });
      if (token) params.set("pageToken", token);
      if (accountId && !resetAccount) params.set("connectionId", accountId);
      const result = await mailboxRequest<MailboxPage>(`?${params}`);
      if (version !== listVersion.current) return;
      setPage(result);
      setMessages(current => token ? [...new Map([...current, ...result.messages].map(row => [row.id, row])).values()] : result.messages);
    } catch (caught) {
      if (version === listVersion.current) { setError(mailboxError(caught)); if (!token) setMessages([]); }
    } finally { if (version === listVersion.current) setLoading(false); }
  }
  useEffect(() => {
    setSelected(null); setThread(null); setDraft(null); setConfirmSend(false); setMessages([]);
    detailVersion.current++;
    void loadPage();
    return () => { listVersion.current++; };
  }, [folder, query]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      mailboxRequest<{ profiles: Array<{ id: string; name: string }> }>(`/profiles?query=${encodeURIComponent(profileQuery)}`)
        .then(result => { if (active) setProfiles(result.profiles); })
        .catch(() => { if (active) setProfiles([]); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [profileQuery]);
  useEffect(() => {
    let active = true; setProfile(null);
    if (profileId) apiGet<CallBriefProfile>(`/event-profiles/${encodeURIComponent(profileId)}`)
      .then(result => { if (active) setProfile(result); }).catch(() => { if (active) setProfile(null); });
    return () => { active = false; };
  }, [profileId]);
  useEffect(() => {
    let active = true;
    apiGet<{ templates: Array<{ id: string; name: string; state: string; channel: string; requiredPlaceholders: string[] }> }>("/communication-templates")
      .then(result => { if (active) setTemplates(result.templates.filter(item => item.state === "active" && item.channel === "email")); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => () => { detailVersion.current++; }, []);
  useEffect(() => {
    const params = new URLSearchParams({ folder });
    if (query) params.set("q", query);
    if (initialProfile) params.set("profileId", initialProfile);
    if (selected?.threadId) params.set("threadId", selected.threadId);
    if (selected?.draftId) params.set("draftId", selected.draftId);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`);
    try { sessionStorage.setItem("az-mailbox-view", JSON.stringify({ folder, query, threadId: selected?.threadId, draftId: selected?.draftId })); } catch {}
  }, [folder, query, selected?.threadId, selected?.draftId]);
  useEffect(() => {
    if (restoredThread.current || !accountId || !messages.length) return;
    const row = messages.find(item => initialView.current.draftId ? item.draftId === initialView.current.draftId : item.threadId === initialView.current.threadId);
    if (row) { restoredThread.current = true; void openMessage(row); }
  }, [accountId, messages]);

  async function openMessage(row: MailboxMessage) {
    if (!accountId || actionBusy.current) return;
    const version = ++detailVersion.current;
    restoredThread.current = true;
    listScroll.current = window.scrollY;
    setSelected(row); setThread(null); setDraft(null); setComposer(null); setConfirmSend(false); setError(""); setNotice("");
    setProfileId(row.profiles.length === 1 ? row.profiles[0].id : initialProfile);
    setConfirmChange(false);
    try {
      if (row.draftId) {
        const result = await mailboxRequest<MailboxDraft>(`/drafts/${encodeURIComponent(row.draftId)}?connectionId=${accountId}`);
        if (version === detailVersion.current) setDraft(result);
      } else {
        const result = await mailboxRequest<MailboxThread>(`/threads/${encodeURIComponent(row.threadId)}?connectionId=${accountId}`);
        if (version === detailVersion.current) setThread(result);
      }
    } catch (caught) { if (version === detailVersion.current) setError(mailboxError(caught)); }
  }
  async function action(run: () => Promise<void>) {
    if (actionBusy.current) return;
    actionBusy.current = true; setBusy(true); setError(""); setNotice("");
    try { await run(); } catch (caught) { setError(mailboxError(caught)); }
    finally { actionBusy.current = false; setBusy(false); }
  }
  async function linkProfile() {
    if (!accountId || !selected || !profileId) return;
    await action(async () => {
      const result = await mailboxRequest<{ linked: boolean; mutationId: string; gmailSync: { state: string; errorCode?: string | null } }>(`/threads/${selected.threadId}/link`, { connectionId: accountId, messageId: selected.id, organizationId: profileId, ...(confirmChange && selected.profiles.length === 1 && selected.profiles[0].id !== profileId ? { expectedOrganizationId: selected.profiles[0].id } : {}) });
      setNotice(result.gmailSync.state === "completed" ? "Linked to profile. Profile label applied; Inbox preserved." : "Linked to profile. Gmail label needs attention; the profile link is saved.");
      const linkedName = profile?.id === profileId ? (profile as any).place?.name : profiles.find(item => item.id === profileId)?.name;
      setSelected(current => current ? { ...current, profiles: [{ id: profileId, name: linkedName || "Linked profile" }] } : current);
      await loadPage();
    });
  }
  async function applyTemplate() {
    if (!composer || !templateId) return;
    await action(async () => {
      const result = await apiPost<{ preview: { subject: string; body: string; bodyFormat: "plain_text" | "html"; missingRequiredFields: string[] } }>(`/communication-templates/${templateId}/preview`, { values: templateValues });
      if (result.preview.missingRequiredFields.length) {
        setError("Complete all required template details before applying."); return;
      }
      pendingDraft.current = null;
      setComposer({ ...composer, subject: result.preview.subject, body: result.preview.body, bodyFormat: result.preview.bodyFormat });
      setNotice("Approved template applied. Review all wording before saving.");
    });
  }
  async function saveDraft() {
    if (!accountId || !composer) return;
    await action(async () => {
      if (!pendingDraft.current) {
        const saved = await mailboxRequest<{ draftId: string }>(`/drafts`, { connectionId: accountId, ...composer });
        pendingDraft.current = saved.draftId;
      }
      const review = await mailboxRequest<MailboxDraft>(`/drafts/${pendingDraft.current}?connectionId=${accountId}`);
      pendingDraft.current = null;
      setDraft(review); setComposer(null); setThread(null); setConfirmSend(false); setNotice("Draft saved. Review before sending.");
    });
  }
  async function send() {
    if (!accountId || !draft || !confirmSend) return;
    await action(async () => {
      await mailboxRequest(`/drafts/${draft.draftId}/send`, { connectionId: accountId, revision: draft.revision, confirm: true });
      setDraft(null); setSelected(null); setConfirmSend(false); setNotice("Email sent."); await loadPage();
    });
  }
  const detail = thread ?? draft?.detail;
  const draftMessage = draft?.detail?.messages.find(message => message.id === draft.messageId);
  const replyMessage = thread?.messages.at(-1);
  const recipient = replyMessage ? (replyMessage.direction === "outgoing" ? replyMessage.to : replyMessage.from) : "";
  const emailAddress = recipient.match(/<([^<>]+)>/)?.[1] || recipient;
  return <main className="mx-auto max-w-[1600px] p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Emails</h1><p className="text-sm text-muted-foreground">{page?.email || "Your connected Google account"}</p></div>
      <div className="flex flex-wrap gap-2"><a className="button-secondary" href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(page?.email || "")}`} target="_blank" rel="noopener noreferrer">Open Gmail</a><Link className="button-secondary" href="/settings/google-workspace">Email connection</Link><button className="button-primary" disabled={!accountId || busy} onClick={() => { detailVersion.current++; setThread(null); setDraft(null); setSelected(null); pendingDraft.current = null; setComposer({ to: "", subject: "", body: "" }); setConfirmSend(false); }} type="button">Compose</button></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">{(["inbox", "sent", "drafts", "search"] as Folder[]).map(item => <button className={folder === item ? "button-primary" : "button-secondary"} aria-current={folder === item ? "page" : undefined} disabled={busy} key={item} onClick={() => setFolder(item)} type="button">{item[0].toUpperCase() + item.slice(1)}</button>)}
      <button className="button-secondary" disabled={loading || busy} onClick={() => { setPage(null); setSelected(null); setThread(null); setDraft(null); setComposer(null); setMessages([]); detailVersion.current++; void loadPage(undefined, true); }} type="button">Refresh</button><Link className="button-secondary" href="/email-review">Email Review</Link></div>
    <p className="mt-2 text-xs text-muted-foreground">Email Review checks uncertain profile matches and files conversations with a follow-up status. Filing there archives the conversation. Linking here saves the same profile association and keeps Inbox; Archive is a separate action.</p>
    <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); if (busy) return; setFolder("search"); setQuery(searchText); }}>
      <input aria-label="Search emails" className="min-w-0 flex-1 rounded border bg-background p-2" placeholder="Search email (Gmail search supported)" value={searchText} onChange={event => setSearchText(event.target.value)} />
      <button className="button-secondary" disabled={busy} type="submit">Search</button>
    </form>
    {error ? <p role="alert" className="my-3 rounded border border-red-300 p-3 text-sm">{error}</p> : null}
    {notice ? <p role="status" className="my-3 rounded border p-3 text-sm">{notice}</p> : null}
    <div className="mt-4 grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
      <section aria-label="Email list" className={`min-w-0 rounded-xl border bg-card ${selected || composer || draft ? "hidden xl:block" : ""}`}>
        {loading ? <p role="status" className="p-3 text-sm">Loading email…</p> : null}
        {!loading && !messages.length ? <p className="p-3 text-sm text-muted-foreground">{error ? "Unable to load email." : "No email in this view."}</p> : null}
        {messages.map(row => <button type="button" key={row.id} disabled={busy} aria-pressed={selected?.id === row.id} onClick={() => void openMessage(row)} className={`block w-full border-b p-3 text-left hover:bg-muted ${selected?.id === row.id ? "bg-muted" : ""}`}>
          <p className="truncate text-xs">{row.headers.from || row.headers.to}</p><p className="mt-1 text-xs text-muted-foreground">{row.labelIds.includes("UNREAD") ? "Unread" : "Read"}{row.labelIds.includes("INBOX") ? " · Inbox" : ""}{row.draftId ? " · Draft" : row.labelIds.includes("SENT") ? " · Sent" : ""}</p><p className="mt-1 truncate text-sm font-semibold">{row.headers.subject || "(No subject)"}{row.hasAttachments ? " · Attachments" : ""}</p>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.snippet}</p><p className="mt-1 text-xs">{row.profiles.map(item => item.name).join(", ")}</p>
        </button>)}
        {page?.unavailableCount ? <p className="p-3 text-xs">Some deleted messages were skipped.</p> : null}
        {page?.nextPageToken ? <button className="button-secondary m-3" disabled={loading || busy} onClick={() => void loadPage(page.nextPageToken!)} type="button">Load more</button> : null}
      </section>
      <section aria-label="Email conversation" className={`min-w-0 rounded-xl border bg-card p-4 ${!selected && !composer && !draft ? "hidden xl:block" : ""}`}>
        <div className="mb-3 flex flex-wrap gap-2 xl:hidden"><button className="button-secondary" disabled={busy} type="button" onClick={() => { detailVersion.current++; setSelected(null); setThread(null); setDraft(null); setComposer(null); setShowProfile(false); requestAnimationFrame(() => window.scrollTo(0, listScroll.current)); }}>Back to emails</button><button className="button-secondary" type="button" onClick={() => setShowProfile(value => !value)}>Profile context</button></div>
        {composer ? <form onSubmit={event => { event.preventDefault(); void saveDraft(); }} className="grid gap-3">
          <h2 className="text-lg font-bold">{composer.threadId ? "Reply" : "New email"}</h2>
          {templates.length ? <details className="rounded border p-3"><summary className="cursor-pointer text-sm font-semibold">Use approved email template</summary>
            <label className="mt-3 grid gap-1 text-sm">Template<select value={templateId} onChange={event => { setTemplateId(event.target.value); setTemplateValues({}); }} className="rounded border bg-background p-2"><option value="">Choose template</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {(templates.find(item => item.id === templateId)?.requiredPlaceholders || []).map(field => <label key={field} className="mt-2 grid gap-1 text-sm">{field.replace(/([a-z])([A-Z])/g, "$1 $2")}<input className="rounded border bg-background p-2" value={templateValues[field] || ""} onChange={event => setTemplateValues({ ...templateValues, [field]: event.target.value })} /></label>)}
            <button className="button-secondary mt-3" disabled={!templateId || busy} type="button" onClick={() => void applyTemplate()}>Apply template</button>
          </details> : null}
          <label className="grid gap-1 text-sm">To<input type="email" required className="rounded border bg-background p-2" value={composer.to} onChange={event => setComposer({ ...composer, to: event.target.value })} /></label>
          <label className="grid gap-1 text-sm">Subject<input required className="rounded border bg-background p-2" value={composer.subject} onChange={event => setComposer({ ...composer, subject: event.target.value })} /></label>
          {composer.bodyFormat === "html" ? <div><p className="mb-2 text-sm font-semibold">Template preview</p><iframe className="h-[460px] w-full rounded border bg-white" sandbox="" title="Approved email template preview" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${composer.body}`} /><p className="mt-2 text-xs text-muted-foreground">Template formatting is preserved in the saved draft.</p></div> : <label className="grid gap-1 text-sm">Message<textarea required rows={12} className="rounded border bg-background p-2" value={composer.body} onChange={event => setComposer({ ...composer, body: event.target.value })} /></label>}
          <p className="text-xs text-muted-foreground">Saves a Gmail draft for review. Attachments can be added in Gmail before opening the saved draft here.</p>
          <div className="flex gap-2"><button className="button-primary" disabled={busy} type="submit">Save draft</button><button className="button-secondary" disabled={busy} onClick={() => setComposer(null)} type="button">Cancel</button></div>
        </form> : <>
          {detail ? <>{thread?.savedCopy ? <p role="status" className="mb-3 rounded border p-3 text-sm">Saved copy · Last synchronized {thread.lastSyncedAt || "at an unknown time"}. Live Gmail is unavailable.</p> : null}<h2 className="break-words text-lg font-bold">{detail.subject || "(No subject)"}</h2>
            <a className="mt-2 inline-block text-sm text-primary underline" target="_blank" rel="noopener noreferrer" href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(page?.email || "")}#${draft ? "drafts" : `all/${encodeURIComponent(detail.id)}`}`}>Open in Gmail</a>
            {draft ? <div className="my-3 rounded border p-3">
              <p className="text-sm font-semibold">Saved draft{` to ${draft.recipients.to}`}</p>
              {draft.recipients.cc ? <p className="break-all text-sm">Cc: {draft.recipients.cc}</p> : null}
              {draft.recipients.bcc ? <p className="break-all text-sm">Bcc: {draft.recipients.bcc}</p> : null}
              <p className="text-xs text-muted-foreground">Sending preserves this saved draft, including its formatting and attachments.</p>
              {draft.sendState ? <p role="alert" className="mt-2 text-sm">{draft.sendState === "sent" ? "Already sent." : "A send was attempted. Check Sent in Gmail; this draft cannot be resent here."}</p> : <>
                <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmSend} onChange={event => setConfirmSend(event.target.checked)} />I reviewed this draft and its recipient.</label>
                <button className="button-primary mt-3" disabled={!confirmSend || busy || !draftMessage} onClick={() => void send()} type="button">Send email</button>
              </>}
            </div> : <div className="my-3 flex flex-wrap gap-2">
              <button className="button-secondary" disabled={busy || !emailAddress || !!thread?.savedCopy} onClick={() => setComposer({ to: emailAddress.trim(), subject: /^re:/i.test(detail.subject) ? detail.subject : `Re: ${detail.subject}`, body: "", threadId: detail.id })} type="button">Reply</button>
              <button className="button-secondary" disabled={busy} onClick={() => void action(async () => { await mailboxRequest(`/threads/${detail.id}/read`, { connectionId: accountId, read: !!selected?.labelIds.includes("UNREAD") }); setSelected(current => current ? { ...current, labelIds: current.labelIds.includes("UNREAD") ? current.labelIds.filter(item => item !== "UNREAD") : [...current.labelIds, "UNREAD"] } : current); await loadPage(); })} type="button">{selected?.labelIds.includes("UNREAD") ? "Mark read" : "Mark unread"}</button>
              <button className="button-secondary" disabled={busy} onClick={() => void action(async () => { await mailboxRequest(`/threads/${detail.id}/archive`, { connectionId: accountId }); setNotice("Archived in Gmail."); await loadPage(); })} type="button">Archive</button>
            </div>}
            <div className="grid gap-4">{detail.messages.map(message => <article key={message.id} className="min-w-0 rounded border p-3">
              <p className="break-all text-xs font-semibold">From {message.from} · To {message.to}</p><p className="text-xs text-muted-foreground">{message.date}</p>
              <MessageBody body={message.bodyText} />
              {message.attachments.map(file => <button className="button-secondary mt-2 max-w-full break-all" disabled={busy} type="button" key={file.attachmentId} onClick={() => void action(async () => { await downloadMailboxAttachment({ connectionId: accountId!, threadId: detail.id, messageId: message.id, attachmentId: file.attachmentId, filename: file.filename }); })}>{file.filename || "Download attachment"}</button>)}
            </article>)}</div>
          </> : <p role="status" className="text-sm text-muted-foreground">{selected ? "Opening conversation…" : "Select an email to read it, link it to a profile, or reply."}</p>}
        </>}
      </section>
      <aside aria-label="Profile context" className={`min-w-0 rounded-xl border bg-card p-3 ${showProfile ? "" : "hidden xl:block"}`}>
        <h2 className="font-bold">Profile</h2>
        {selected?.profiles.length ? <p className="mt-2 text-xs">Linked: {selected.profiles.map(item => item.name).join(", ")}</p> : null}
        <input className="mt-3 w-full rounded border bg-background p-2 text-sm" aria-label="Find profile" placeholder="Find a profile…" value={profileQuery} onChange={event => setProfileQuery(event.target.value)} />
        <label className="mt-2 grid gap-1 text-xs">Select profile<select className="w-full rounded border bg-background p-2" value={profileId} onChange={event => { setProfileId(event.target.value); setConfirmChange(false); }}>
          <option value="">Choose profile</option>{profileId && !profiles.some(item => item.id === profileId) ? <option value={profileId}>{(profile as any)?.place?.name || "Selected profile"}</option> : null}
          {profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {selected?.profiles.length === 1 && selected.profiles[0].id !== profileId && profileId ? <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmChange} onChange={event => setConfirmChange(event.target.checked)} />Change the link from {selected.profiles[0].name} to the selected profile.</label> : null}
        <button className="button-primary mt-3" disabled={!profileId || !selected || !!selected.draftId || busy || !thread || (selected.profiles.length > 0 && selected.profiles[0].id !== profileId && !confirmChange)} onClick={() => void linkProfile()} type="button">{selected?.profiles.length && selected.profiles[0].id !== profileId ? "Change profile" : "Link to profile"}</button>
        <p className="mt-2 text-xs text-muted-foreground">Applies the existing profile label. Keeps the email in Inbox.</p>
        {profile ? <div className="mt-4"><Link className="text-sm font-semibold text-primary underline" href={`/profiles/${profile.id}`}>Open {(profile as any).place?.name || "profile"}</Link><div className="mt-3"><ProfileCallBrief profile={profile} onEmails={() => window.location.assign(`/profiles/${profile.id}?section=emails`)} /></div></div> : null}
      </aside>
    </div>
  </main>;
}

function MessageBody({ body }: { body: string }) {
  const split = body.search(/(?:^|\n)(?:On .{5,300}wrote:|>)/);
  const text = split < 0 ? body : body.slice(0, split);
  const quoted = split < 0 ? "" : body.slice(split);
  return <><p className="mt-3 whitespace-pre-wrap break-words text-sm">{text || "(No plain text body)"}</p>{quoted ? <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Quoted conversation</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{quoted}</p></details> : null}</>;
}

function readMailboxView(search: string): { folder: Folder; query: string; threadId?: string; draftId?: string } {
  const params = new URLSearchParams(search);
  let saved: { folder?: string; query?: string; threadId?: string; draftId?: string } = {};
  try { saved = JSON.parse(sessionStorage.getItem("az-mailbox-view") || "{}"); } catch {}
  const candidate = params.get("folder") || saved.folder || "inbox";
  return {
    folder: (["inbox", "sent", "drafts", "search"].includes(candidate) ? candidate : "inbox") as Folder,
    query: params.get("q") ?? saved.query ?? "",
    threadId: params.get("threadId") || saved.threadId,
    draftId: params.get("draftId") || saved.draftId,
  };
}
