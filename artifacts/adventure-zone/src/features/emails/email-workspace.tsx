import { EmailList } from "./email-list";
import { EmailReader } from "./email-reader";
import { EmailReviewPane } from "./email-review-pane";
import { EmailAttentionControls } from "@/components/google-workspace/email-attention-controls";
import { readEmailWorkspaceState, readMailboxContext, writeMailboxContext, mailboxRestoreTarget, attentionContextKey, isCurrentMailboxResponse, type EmailWorkspaceView } from "./email-workspace-state";
import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { apiGet, apiPost } from "@/lib/auth-token";
import { ProfileCallBrief } from "@/components/profiles/profile-call-brief";
import type { CallBriefProfile } from "@/components/profiles/profile-call-brief-model";
import { mailboxRequest, mailboxError, downloadMailboxAttachment, type MailboxMessage, type MailboxPage, type MailboxThread, type MailboxDraft } from "@/features/google-workspace/mailbox-client";

type Folder = "inbox" | "sent" | "drafts" | "search";
type Composer = { to: string; subject: string; body: string; bodyFormat?: "plain_text" | "html"; threadId?: string };
export function EmailWorkspace() {
  const search = useSearch();
  const initialProfile = new URLSearchParams(search).get("profileId") || "";
  const initialView = useRef(readEmailWorkspaceState(search));
  const [view, setView] = useState<EmailWorkspaceView>(initialView.current.view);
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
  const [showList, setShowList] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const listScroll = useRef(0);
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const actionBusy = useRef(false);
  const pendingDraft = useRef<string | null>(null);
  const restoredThread = useRef(false);
  const hydratedAccount = useRef<string | null>(null);
  const accountId = page?.connectionId;
  const currentAccount = useRef(accountId); currentAccount.current = accountId;
  const attentionView = view === "needs_reply" || view === "waiting";
  function changeView(next: EmailWorkspaceView) { if (busy) return; setView(next); setFolder(next === "sent" || next === "drafts" ? next : "inbox"); setQuery(""); setSearchText(""); }
  useEffect(() => { const next=readEmailWorkspaceState(search); setView(next.view); setFolder(next.folder); setQuery(next.query); setSearchText(next.query); }, [search]);

  async function loadPage(token?: string, resetAccount = false) {
    const version = ++listVersion.current;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ folder, query: folder === "search" ? query : "" });
      if (token) params.set("pageToken", token);
      if (accountId && !resetAccount) params.set("connectionId", accountId);
      let result: MailboxPage;
      if (attentionView) {
        const bootstrap = page && !resetAccount ? page : await mailboxRequest<MailboxPage>("?folder=inbox");
        const filter = view === "needs_reply" ? "needs_your_reply" : "waiting_for_their_reply";
        const attentionParams = new URLSearchParams({gmailConnectionId:bootstrap.connectionId,state:filter});
        if (token) attentionParams.set("cursor",token);
        const attention = await apiGet<{items:Array<{messageId:string;threadId:string;profileId:string;profileName:string;subject:string;reason:string;updatedAt:string}>;nextCursor:string|null}>("/email-thread-attention/list?"+attentionParams);
        result = {...bootstrap,nextPageToken:attention.nextCursor,messages:attention.items.map(item=>({id:item.messageId,threadId:item.threadId,draftId:null,snippet:item.reason || "",labelIds:[],internalDateMs:Date.parse(item.updatedAt),hasAttachments:false,headers:{from:item.profileName,to:"",subject:item.subject,date:item.updatedAt},profiles:[{id:item.profileId,name:item.profileName}]}))};
      } else { result = await mailboxRequest<MailboxPage>(`?${params}`); }
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
  }, [folder, query, view]);
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
    const params = new URLSearchParams(window.location.search);
    params.set("view",view); params.set("folder",folder);
    if(query) params.set("q",query); else params.delete("q");
    if(selected?.threadId) params.set("threadId",selected.threadId); else if(restoredThread.current) params.delete("threadId");
    if(draft?.draftId || selected?.draftId) params.set("draftId",draft?.draftId || selected!.draftId!); else if(restoredThread.current) params.delete("draftId");
    if(accountId) params.set("accountId",accountId);
    window.history.replaceState(window.history.state,"",window.location.pathname+"?"+params);
    if(accountId && hydratedAccount.current === accountId) try { writeMailboxContext(sessionStorage,{accountId,threadId:thread?.id || selected?.threadId,draftId:draft?.draftId || selected?.draftId || undefined,scrollY:listScroll.current,showProfile,showList,profileId:profileId || undefined}); } catch {}
  },[view,folder,query,selected?.threadId,selected?.draftId,draft?.draftId,accountId,showProfile,showList,profileId]);
  useEffect(() => {
    if(restoredThread.current || !accountId || loading || view==="review") return;
    let saved: ReturnType<typeof readMailboxContext> = null;
    try { saved=readMailboxContext(sessionStorage,accountId); } catch {}
    hydratedAccount.current=accountId;
    restoredThread.current=true;
    const fromUrl=initialView.current;
    const context = fromUrl.threadId || fromUrl.draftId ? fromUrl : saved;
    if(saved?.scrollY && Number.isFinite(saved.scrollY)) listScroll.current=saved.scrollY;
    if(saved?.showProfile) setShowProfile(true);
    const row=context ? mailboxRestoreTarget(context,messages,accountId) : null;
    if(row) void openMessage(row,true,saved?.showList ?? false);
    else if(saved?.scrollY) requestAnimationFrame(()=>window.scrollTo(0,saved!.scrollY!));
  },[accountId,messages,loading,view]);

  async function openMessage(row: MailboxMessage, restoring = false, restoreList = false) {
    if (!accountId || actionBusy.current) return;
    const version = ++detailVersion.current;
    restoredThread.current = true;
    hydratedAccount.current=accountId;
    setShowList(restoring ? restoreList : false);
    if (restoring && restoreList) requestAnimationFrame(()=>window.scrollTo(0,listScroll.current));
    if (!restoring) listScroll.current = window.scrollY;
    setSelected(row); setThread(null); setDraft(null); setComposer(null); setConfirmSend(false); setError(""); setNotice("");
    setProfileId(row.profiles.length === 1 ? row.profiles[0].id : initialProfile);
    setConfirmChange(false);
    try {
      if (row.draftId) {
        const result = await mailboxRequest<MailboxDraft>(`/drafts/${encodeURIComponent(row.draftId)}?connectionId=${accountId}`);
        if (isCurrentMailboxResponse(version,detailVersion.current,accountId,currentAccount.current || "")) setDraft(result);
      } else {
        const result = await mailboxRequest<MailboxThread>(`/threads/${encodeURIComponent(row.threadId)}?connectionId=${accountId}`);
        if (isCurrentMailboxResponse(version,detailVersion.current,accountId,currentAccount.current || "")) {
          setThread(result);
          const latest=result.messages.at(-1);
          setSelected(current=>current && current.threadId===row.threadId?{...current,id:latest?.id || current.id,profiles:result.profiles,headers:{...current.headers,subject:result.subject,from:latest?.from || current.headers.from,to:latest?.to || current.headers.to}}:current);
          if(result.profiles.length===1) setProfileId(result.profiles[0].id);
        }
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
      setDraft(review); setShowList(false); setComposer(null); setThread(null); setConfirmSend(false); setNotice("Draft saved. Review before sending.");
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
  return <main className="mx-auto min-w-0 max-w-[1600px]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Emails</h1><p className="text-sm text-muted-foreground">{page?.email || "Your connected Google account"}</p></div>
      <div className="flex flex-wrap gap-2"><a className="button-secondary" href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(page?.email || "")}`} target="_blank" rel="noopener noreferrer">Open Gmail</a><Link className="button-secondary" href="/settings/google-workspace">Email connection</Link><button className="button-primary" disabled={!accountId || busy} onClick={() => { detailVersion.current++; setShowList(false); if(view==="review") {setView("inbox");setFolder("inbox");} setThread(null); setDraft(null); setSelected(null); pendingDraft.current = null; setComposer({ to: "", subject: "", body: "" }); setConfirmSend(false); }} type="button">Compose</button></div>
    </div>
    <nav aria-label="Email views" className="mt-4 flex gap-1 overflow-x-auto border-b pb-2">
      {([{id:"inbox",label:"Inbox"},{id:"sent",label:"Sent"},{id:"drafts",label:"Drafts"},{id:"review",label:"Needs review"},{id:"needs_reply",label:"Needs your reply"},{id:"waiting",label:"Waiting"}] as const).map(item=><button key={item.id} type="button" aria-current={view===item.id?"page":undefined} disabled={busy} onClick={()=>changeView(item.id)} className={`min-h-11 shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${view===item.id?"bg-secondary text-secondary-foreground":"text-muted-foreground hover:bg-muted"}`}>{item.label}</button>)}
    </nav>
    {view !== "review" ? <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); if (busy) return; setView("inbox"); setFolder("search"); setQuery(searchText); }}>
      <input aria-label="Search emails" className="min-w-0 flex-1 rounded border bg-background p-2" placeholder="Search email (Gmail search supported)" value={searchText} onChange={event => setSearchText(event.target.value)} />
      <button className="button-secondary" disabled={busy} type="submit">Search</button>
      <button className="button-secondary" type="button" disabled={busy || loading} onClick={() => { setPage(null); setSelected(null); setThread(null); setDraft(null); setComposer(null); setShowProfile(false); setMessages([]); detailVersion.current++; restoredThread.current=true; void loadPage(undefined,true); }}>Refresh</button>
    </form> : null}
    {error ? <p role="alert" className="my-3 rounded border border-red-300 p-3 text-sm">{error}</p> : null}
    {notice ? <p role="status" className="my-3 rounded border p-3 text-sm">{notice}</p> : null}
    {view === "review" ? <EmailReviewPane accountId={accountId} selectedMessageId={readEmailWorkspaceState(search).reviewMessageId || readEmailWorkspaceState(search).attentionMessage} attentionMessageId={readEmailWorkspaceState(search).attentionMessage} profileId={initialProfile || undefined}/> : <div className={`mt-4 grid min-w-0 items-start gap-4 md:grid-cols-[minmax(220px,0.75fr)_minmax(0,2fr)] ${showProfile ? "xl:grid-cols-[minmax(240px,0.8fr)_minmax(0,2fr)_minmax(260px,0.9fr)]" : ""}`}>
      <section aria-label="Email list" className={`min-w-0 rounded-xl border bg-card ${showProfile ? "hidden md:block" : !showList && (selected || composer || draft) ? "hidden md:block" : ""}`}>
        {loading ? <p role="status" className="p-3 text-sm">Loading email…</p> : null}
        {!loading && !messages.length ? <p className="p-3 text-sm text-muted-foreground">{error ? "Unable to load email." : "No email in this view."}</p> : null}
        <EmailList items={messages} selectedId={selected?.id} busy={busy} onSelect={row => void openMessage(row)}/>
        {page?.unavailableCount ? <p className="p-3 text-xs">Some deleted messages were skipped.</p> : null}
        {page?.nextPageToken ? <button className="button-secondary m-3" disabled={loading || busy} onClick={() => void loadPage(page.nextPageToken!)} type="button">Load more</button> : null}
      </section>
      <div className={showProfile ? "hidden md:block" : ""}><EmailReader hiddenOnPhone={showList || (!selected && !composer && !draft)}>
        <div className="mb-3 flex flex-wrap gap-2"><button className="button-secondary" disabled={busy} type="button" onClick={() => { restoredThread.current=true; setShowList(true); setComposer(null); setShowProfile(false); requestAnimationFrame(() => window.scrollTo(0, listScroll.current)); }}>Back to emails</button><button className="button-secondary" type="button" onClick={() => setShowProfile(value => !value)}>Profile context</button></div>
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
            {!draft && selected && profileId ? <details className="my-3 rounded border p-3"><summary className="cursor-pointer text-sm font-semibold">Reply and follow-up status</summary><EmailAttentionControls key={attentionContextKey(accountId || "",selected.id,profileId)} messageId={selected.id} profileId={profileId} onSaved={() => void loadPage()}/><p className="mt-2 text-xs text-muted-foreground">Saving an attention decision files and archives this conversation.</p></details> : null}
            <div className="grid gap-4">{detail.messages.map(message => <article key={message.id} className="min-w-0 rounded border p-3">
              <p className="break-all text-xs font-semibold">From {message.from} · To {message.to}</p><p className="text-xs text-muted-foreground">{message.date}</p>
              <MessageBody body={message.bodyText} />
              {message.attachments.map(file => <button className="button-secondary mt-2 max-w-full break-all" disabled={busy} type="button" key={file.attachmentId} onClick={() => void action(async () => { await downloadMailboxAttachment({ connectionId: accountId!, threadId: detail.id, messageId: message.id, attachmentId: file.attachmentId, filename: file.filename }); })}>{file.filename || "Download attachment"}</button>)}
            </article>)}</div>
          </> : <p role="status" className="text-sm text-muted-foreground">{selected ? "Opening conversation…" : "Select an email to read it, link it to a profile, or reply."}</p>}
        </>}
      </EmailReader></div>
      <aside aria-label="Profile context" className={`min-w-0 rounded-xl border bg-card p-4 ${showProfile ? "md:fixed md:inset-y-20 md:right-4 md:z-40 md:w-80 md:overflow-y-auto md:shadow-xl xl:static xl:w-auto xl:shadow-none" : "hidden"}`}>
        <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Profile details</h2><button type="button" className="button-secondary" onClick={() => setShowProfile(false)}>Back to email</button></div>
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
    </div>}
  </main>;
}

function MessageBody({ body }: { body: string }) {
  const split = body.search(/(?:^|\n)(?:On .{5,300}wrote:|>)/);
  const text = split < 0 ? body : body.slice(0, split);
  const quoted = split < 0 ? "" : body.slice(split);
  return <><p className="mt-3 whitespace-pre-wrap break-words text-sm">{text || "(No plain text body)"}</p>{quoted ? <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Quoted conversation</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{quoted}</p></details> : null}</>;
}

