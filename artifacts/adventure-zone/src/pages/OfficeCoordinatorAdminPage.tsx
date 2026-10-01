import { WorkQueue } from "@/features/booking-work/WorkQueue";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/auth-token";
import { OutreachDraftReviewControl, useOutreachPlannerEnabled } from "@/components/today/outreach-planner";

type Tab = "tasks" | "emails" | "mail" | "messages" | "account" | "boss";
type Account = { id: string; loginName: string; displayName: string; role: string; enabled: boolean; sessionVersion: number; canReviewWebsiteInquiries: boolean };
type Task = {
  id: string;
  officeAccountId: string;
  taskType: string;
  title: string;
  instructions: string | null;
  organizationId: string | null;
  organizationName: string | null;
  contactId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  status: string;
  needsHelp: boolean;
  coordinatorNote: string | null;
  ownerSortOrder: number;
  dueAt: string | null;
  updatedAt: string;
};
type Email = { id: string; officeAccountId: string | null; organizationId: string; contactId: string; bookingId: string | null; eventYear: number | null; recipientEmail: string; subject: string; body: string; coordinatorNote: string | null; state: string; submittedAt: string | null; ownerReturnNote: string | null; lastSendError: string | null };
type Mail = { id: string; officeAccountId: string; organizationId: string; contactId: string | null; recipientName: string | null; address1Snapshot: string | null; address2Snapshot: string | null; citySnapshot: string | null; regionSnapshot: string | null; postalCodeSnapshot: string | null; preparedAt: string | null; mailedAt: string | null; note: string | null };
type Message = { id: string; actorKind: "office" | "owner"; body: string; createdAt: string };
type ProfileResult = { id: string; name: string; city: string | null; region: string | null };
type ProfileContact = { id: string; name: string; role?: string | null; email?: string | null };

const taskTypes = [
  ["contact_verification", "Contact verification"],
  ["mail_brochure", "Mail brochure"],
  ["follow_up_prep", "Follow-up prep"],
  ["research_update", "Research / update info"],
  ["draft_email", "Draft email"],
  ["other", "Other"],
] as const;

export default function OfficeCoordinatorAdminPage() {
  const search = useSearch();
  const initial = (new URLSearchParams(search).get("tab") as Tab | null) ?? "tasks";
  const [tab, setTab] = useState<Tab>(["tasks", "emails", "mail", "messages", "account", "boss"].includes(initial) ? initial : "tasks");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [mail, setMail] = useState<Mail[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const account = accounts.find((item) => item.id === accountId) ?? accounts[0] ?? null;

  const loadAccounts = useCallback(async () => {
    const data = await apiGet<{ accounts: Account[] }>("/office-admin/accounts");
    setAccounts(data.accounts);
    setAccountId((current) => current && data.accounts.some((a) => a.id === current) ? current : data.accounts[0]?.id ?? "");
  }, []);
  const load = useCallback(async () => {
    try { await loadAccounts(); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Office Coordinator controls."); }
  }, [loadAccounts]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!accountId) { setTasks([]); setMail([]); setMessages([]); return; }
    apiGet<{ tasks: Task[] }>(`/office-admin/tasks?accountId=${accountId}`).then((d) => setTasks(d.tasks)).catch(() => setTasks([]));
    apiGet<{ mail: Mail[] }>(`/office-admin/mail?accountId=${accountId}`).then((d) => setMail(d.mail)).catch(() => setMail([]));
    apiGet<{ messages: Message[] }>(`/office-admin/messages/${accountId}`)
      .then(async (d) => { setMessages(d.messages); await apiPost(`/office-admin/messages/${accountId}/read`, {}).catch(() => undefined); })
      .catch(() => setMessages([]));
  }, [accountId]);

  const loadEmails = useCallback(() => apiGet<{ drafts: Email[] }>("/office-admin/email-drafts?state=submitted").then((d) => setEmails(d.drafts)).catch(() => setEmails([])), []);
  useEffect(() => { void loadEmails(); }, [loadEmails]);

  const activeTasks = useMemo(() => tasks.filter((task) => !["done", "cancelled"].includes(task.status)), [tasks]);
  async function refreshTasks() {
    if (!accountId) return;
    const data = await apiGet<{ tasks: Task[] }>(`/office-admin/tasks?accountId=${accountId}`);
    setTasks(data.tasks);
  }
  async function reorder(task: Task, direction: -1 | 1) {
    const ordered = [...activeTasks].sort((a, b) => a.ownerSortOrder - b.ownerSortOrder);
    const index = ordered.findIndex((item) => item.id === task.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    await apiPost("/office-admin/tasks/reorder", { accountId: task.officeAccountId, taskIds: ordered.map((item) => item.id) });
    await refreshTasks();
  }

  return <div className="mx-auto grid max-w-6xl gap-5">
    <header>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Bookings & Follow-ups</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Office Coordinator</h1><p className="mt-1 text-slate-600">Office work queue, submitted email drafts, mail history, and account access.</p></div>
        {accounts.length > 1 ? <select aria-label="Office Coordinator account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}</select> : account ? <p className="font-semibold text-slate-700">{account.displayName}</p> : null}
      </div>
    </header>
    {error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{notice}</p> : null}
    <div className="flex flex-wrap gap-2" role="tablist">
      {([['tasks', 'Work Queue'], ['emails', 'Email Review'], ['mail', 'Mail & History'], ['messages', 'Messages'], ['account', 'Account'], ['boss', 'Boss Account']] as Array<[Tab, string]>).map(([key, label]) => <button key={key} className={tab === key ? "button-primary" : "button-secondary"} type="button" onClick={() => setTab(key)}>{label}{key === 'emails' && emails.length ? ` (${emails.length})` : key === 'tasks' && activeTasks.filter((task) => task.needsHelp).length ? ` (${activeTasks.filter((task) => task.needsHelp).length} help)` : ''}</button>)}
    </div>
    {!account && tab !== "account" ? <div className="rounded-xl border border-dashed bg-white p-8 text-center"><p className="font-semibold">No Office Coordinator account yet.</p><button className="button-primary mt-3" type="button" onClick={() => setTab("account")}>Create account</button></div> : null}
    {tab === "tasks" ? <WorkQueue /> : null}
    {tab === "tasks" && account ? <TaskManager account={account} tasks={tasks} onChanged={refreshTasks} onReorder={reorder} /> : null}
    {tab === "emails" ? <EmailReview emails={emails} onChanged={async () => { await loadEmails(); setNotice("Email review updated."); }} /> : null}
    {tab === "mail" && account ? <MailHistory mail={mail} /> : null}
    {tab === "messages" && account ? <OwnerMessages account={account} messages={messages} onChanged={async () => { const d = await apiGet<{ messages: Message[] }>(`/office-admin/messages/${account.id}`); setMessages(d.messages); }} /> : null}
    {tab === "account" ? <AccountPanel accounts={accounts} selected={account} onChanged={async (message) => { setNotice(message); await loadAccounts(); }} /> : null}
    {tab === "boss" ? <BossAccountPanel /> : null}
  </div>;
}

function TaskManager({ account, tasks, onChanged, onReorder }: { account: Account; tasks: Task[]; onChanged: () => Promise<void>; onReorder: (task: Task, direction: -1 | 1) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState("contact_verification");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [profileSearch, setProfileSearch] = useState("");
  const [profiles, setProfiles] = useState<ProfileResult[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileContacts, setProfileContacts] = useState<ProfileContact[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function searchProfiles() {
    if (!profileSearch.trim()) { setProfiles([]); return; }
    try {
      const d = await apiGet<{ organizations: { records: ProfileResult[] } }>(`/organizations?q=${encodeURIComponent(profileSearch.trim())}&pageSize=10`);
      setProfiles(d.organizations?.records ?? []);
    } catch { setProfiles([]); }
  }

  async function chooseProfile(profile: ProfileResult) {
    setProfileId(profile.id);
    setProfileSearch(profile.name);
    setProfiles([]);
    setContactId(null);
    setProfileContacts([]);
    try {
      const detail = await apiGet<{ contacts?: ProfileContact[] }>(`/event-profiles/${profile.id}`);
      setProfileContacts(detail.contacts ?? []);
    } catch {
      setProfileContacts([]);
    }
  }

  async function create() {
    setBusy(true); setError("");
    try {
      await apiPost("/office-admin/tasks", {
        officeAccountId: account.id,
        taskType,
        title,
        instructions: instructions || null,
        organizationId: profileId,
        contactId,
        dueAt: dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : null,
      });
      setTitle(""); setInstructions(""); setDueAt(""); setProfileId(null); setProfileSearch(""); setProfiles([]); setProfileContacts([]); setContactId(null);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create task.");
    } finally { setBusy(false); }
  }

  const active = tasks.filter((t) => !["done", "cancelled"].includes(t.status)).sort((a, b) => a.ownerSortOrder - b.ownerSortOrder);
  const completed = tasks.filter((t) => t.status === "done");
  return <div className="grid gap-5">
    <section className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-xl font-bold">Add work</h2>
      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Type<select value={taskType} onChange={(e) => setTaskType(e.target.value)}>{taskTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Due date <span className="font-normal text-slate-500">(optional)</span><input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Task<input placeholder="Verify the mailing address for…" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Instructions <span className="font-normal text-slate-500">(optional)</span><textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></label>
        <div className="sm:col-span-2">
          <label className="grid gap-1 text-sm font-semibold">Link profile <span className="font-normal text-slate-500">(optional)</span><div className="flex gap-2"><input className="flex-1" placeholder="Search profile name…" value={profileSearch} onChange={(e) => { setProfileSearch(e.target.value); setProfileId(null); setProfileContacts([]); setContactId(null); }} /><button className="button-secondary" type="button" onClick={() => void searchProfiles()}>Search</button></div></label>
          {profiles.length ? <div className="mt-2 grid gap-1">{profiles.slice(0, 6).map((p) => <button type="button" key={p.id} onClick={() => void chooseProfile(p)} className="rounded-lg border px-3 py-2 text-left text-sm hover:bg-orange-50"><strong>{p.name}</strong> <span className="text-slate-500">{[p.city, p.region].filter(Boolean).join(', ')}</span></button>)}</div> : null}
          {profileId && profileContacts.length ? <label className="mt-3 grid gap-1 text-sm font-semibold">Specific contact <span className="font-normal text-slate-500">(optional)</span><select value={contactId ?? ""} onChange={(e) => setContactId(e.target.value || null)}><option value="">No specific contact</option>{profileContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.role ? ` · ${contact.role}` : ""}</option>)}</select></label> : null}
        </div>
      </div>
      <button className="button-primary w-fit" disabled={busy || !title.trim()} type="button" onClick={() => void create()}>{busy ? "Adding…" : "Add to Queue"}</button>
    </section>

    <section>
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Current queue</h2><span className="text-sm text-slate-500">{active.length}</span></div>
      <div className="mt-3 grid gap-2">{active.length ? active.map((task, index) => {
        const contactName = [task.contactFirstName, task.contactLastName].filter(Boolean).join(" ");
        return <div key={task.id} className={`rounded-xl border bg-white p-4 shadow-sm ${task.needsHelp ? "border-amber-300" : "border-slate-200"}`}><div className="flex gap-3"><div className="flex flex-col gap-1"><button aria-label={`Move ${task.title} up`} disabled={index === 0} className="rounded border px-2 disabled:opacity-30" onClick={() => void onReorder(task, -1)} type="button">↑</button><button aria-label={`Move ${task.title} down`} disabled={index === active.length - 1} className="rounded border px-2 disabled:opacity-30" onClick={() => void onReorder(task, 1)} type="button">↓</button></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold">{task.title}</p><p className="text-sm text-slate-600">{taskTypes.find(([value]) => value === task.taskType)?.[1] ?? task.taskType}{task.organizationName ? ` · ${task.organizationName}` : ""}{contactName ? ` · ${contactName}` : ""}</p></div><div className="flex gap-2">{task.organizationId ? <Link className="button-secondary" href={`/profiles/${task.organizationId}`}>Profile</Link> : null}<button className="button-secondary text-rose-700" type="button" onClick={async () => { if (!window.confirm(`Remove “${task.title}” permanently?`)) return; await apiDelete(`/office-admin/tasks/${task.id}`); await onChanged(); }}>Remove</button></div></div>{task.instructions ? <p className="mt-2 text-sm">{task.instructions}</p> : null}{task.coordinatorNote ? <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm"><strong>Work note:</strong> {task.coordinatorNote}</p> : null}{task.needsHelp ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900">Needs Help</p> : null}<p className="mt-2 text-xs text-slate-500">{task.status.replaceAll('_', ' ')}{task.dueAt ? ` · Due ${new Date(task.dueAt).toLocaleDateString()}` : ""}</p></div></div></div>;
      }) : <p className="rounded-xl border border-dashed bg-white p-6 text-center text-slate-500">No active office work.</p>}</div>
    </section>
    {completed.length ? <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-bold">Completed work ({completed.length})</summary><div className="mt-3 grid gap-2">{completed.slice(0, 30).map((task) => <div key={task.id} className="rounded-lg bg-slate-50 p-3"><p className="font-semibold">{task.title}</p><p className="text-sm text-slate-500">{task.organizationName ?? ""}</p></div>)}</div></details> : null}
  </div>;
}

function EmailReview({ emails, onChanged }: { emails: Email[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, { recipientEmail: string; subject: string; body: string; note: string }>>({});
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const outreachReviewState = useOutreachPlannerEnabled();
  const outreachReviewEnabled = outreachReviewState.enabled === true;
  const outreachReviewChecking = outreachReviewState.enabled === null;
  function value(email: Email) { return values[email.id] ?? { recipientEmail: email.recipientEmail, subject: email.subject, body: email.body, note: "" }; }
  function set(email: Email, patch: Partial<ReturnType<typeof value>>) { setValues((current) => ({ ...current, [email.id]: { ...value(email), ...patch } })); }
  async function send(email: Email, edited: boolean) {
    if (outreachReviewState.enabled === null) { setError("Confirm the outreach review requirement before sending."); return; }
    if (outreachReviewEnabled && !approved[email.id]) { setError("Review and approve the exact final recipient, subject, body, and intent before sending."); return; }
    setBusy(email.id);
    setError("");
    try { const v = value(email); await apiPost(`/office-admin/email-drafts/${email.id}/send`, edited ? { recipientEmail: v.recipientEmail, subject: v.subject, body: v.body } : {}); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send email."); }
    finally { setBusy(null); }
  }
  return <div className="grid gap-3">{error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p> : null}{outreachReviewState.error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert"><p>Could not confirm whether exact outreach review is required: {outreachReviewState.error}</p><button className="button-secondary mt-2 min-h-11" type="button" onClick={outreachReviewState.retry}>Retry outreach review check</button></div> : null}{emails.length ? emails.map((email) => { const v = value(email); const edit = editing === email.id; const changed = v.recipientEmail !== email.recipientEmail || v.subject !== email.subject || v.body !== email.body; const earlyBirdReminder = email.subject === "Early Bird Promo reminder"; const sendLabel = busy === email.id ? "Sending…" : outreachReviewEnabled ? changed ? "Send reviewed edits" : "Send reviewed email" : edit || changed ? "Edit & Send" : "Send"; return <section key={email.id} className={`rounded-xl border bg-white p-4 shadow-sm ${earlyBirdReminder ? "border-orange-300" : ""}`}>{earlyBirdReminder ? <div className="mb-3 rounded-lg bg-orange-100 p-3 text-sm text-orange-950"><strong>Early Bird 15-day reminder</strong><span className="ml-2">Review before sending</span></div> : null}<div className="flex flex-wrap justify-between gap-2"><div><Link className="font-bold text-orange-700" href={`/profiles/${email.organizationId}`}>Open profile</Link><p className="mt-1 text-sm text-slate-600">Submitted {email.submittedAt ? new Date(email.submittedAt).toLocaleString() : ""}</p></div><span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-800">Submitted</span></div>{edit ? <div className="mt-3 grid gap-2"><label className="grid gap-1 text-sm font-semibold">Recipient<input value={v.recipientEmail} onChange={(e) => set(email, { recipientEmail: e.target.value })} /></label><label className="grid gap-1 text-sm font-semibold">Subject<input value={v.subject} onChange={(e) => set(email, { subject: e.target.value })} /></label><label className="grid gap-1 text-sm font-semibold">Email<textarea rows={10} value={v.body} onChange={(e) => set(email, { body: e.target.value })} /></label>{changed ? <p className="rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900">These retained edits are the exact recipient and content that must be reviewed before sending.</p> : null}</div> : <><p className="mt-3 break-words text-sm"><strong>To:</strong> {v.recipientEmail}</p><h3 className="mt-2 break-words text-lg font-bold">{v.subject}</h3>{outreachReviewEnabled ? <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Use the exact final-content review below to read the customer message.</p> : <div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm">{v.body}</div>}{changed ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-900">Edits are retained. Reopen the editor to change them or discard them below.</p> : null}</>}{email.coordinatorNote ? <p className="mt-2 rounded-lg bg-orange-50 p-3 text-sm"><strong>Draft note:</strong> {email.coordinatorNote}</p> : null}{outreachReviewEnabled ? <div className="mt-3"><OutreachDraftReviewControl content={{ to: v.recipientEmail, subject: v.subject, body: v.body }} draftId={email.id} kind="office_email" onApprovalChange={(current) => setApproved((values) => ({ ...values, [email.id]: current }))} /></div> : null}<div className="mt-3 flex flex-wrap gap-2"><button className="button-primary min-h-11" disabled={busy !== null || outreachReviewChecking || (outreachReviewEnabled && !approved[email.id])} title={outreachReviewEnabled && !approved[email.id] ? "Review and approve the exact final content first." : undefined} type="button" onClick={() => void send(email, changed)}>{sendLabel}</button><button className="button-secondary min-h-11" type="button" onClick={() => setEditing(edit ? null : email.id)}>{edit ? "Close editor (keep edits)" : "Edit"}</button>{changed ? <button className="button-secondary min-h-11" type="button" onClick={() => { setValues((current) => { const next = { ...current }; delete next[email.id]; return next; }); setApproved((current) => ({ ...current, [email.id]: false })); setEditing(null); }}>Discard edits</button> : null}<input aria-label={`Return note for ${email.subject}`} className="min-h-11 min-w-0 flex-1" placeholder="Note for changes…" value={v.note} onChange={(e) => set(email, { note: e.target.value })} /><button className="button-secondary min-h-11" disabled={!v.note.trim()} type="button" onClick={async () => { await apiPost(`/office-admin/email-drafts/${email.id}/return`, { note: v.note }); await onChanged(); }}>Return for Changes</button></div></section>; }) : <p className="rounded-xl border border-dashed bg-white p-8 text-center text-slate-500">No submitted emails are waiting.</p>}</div>;
}

function MailHistory({ mail }: { mail: Mail[] }) {
  return <div className="grid gap-3"><h2 className="text-xl font-bold">Brochure / mail history</h2>{mail.length ? mail.map((row) => <div key={row.id} className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-bold">{row.recipientName || "Mail item"}</p><p className="text-sm text-slate-600">{[row.address1Snapshot, row.address2Snapshot, row.citySnapshot, row.regionSnapshot, row.postalCodeSnapshot].filter(Boolean).join(', ')}</p></div><Link className="button-secondary" href={`/profiles/${row.organizationId}`}>Profile</Link></div><p className="mt-2 text-sm">{row.mailedAt ? `Mailed ${new Date(row.mailedAt).toLocaleString()}` : row.preparedAt ? `Prepared ${new Date(row.preparedAt).toLocaleString()}` : "Started"}</p>{row.note ? <p className="mt-1 text-sm text-slate-600">{row.note}</p> : null}</div>) : <p className="rounded-xl border border-dashed bg-white p-8 text-center text-slate-500">No mail history yet.</p>}</div>;
}

function OwnerMessages({ account, messages, onChanged }: { account: Account; messages: Message[]; onChanged: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return <section className="rounded-xl border bg-white p-4 shadow-sm"><h2 className="text-xl font-bold">Messages with {account.displayName}</h2><div className="mt-3 grid max-h-[50vh] gap-2 overflow-y-auto">{messages.length ? messages.map((message) => <div key={message.id} className={`max-w-[86%] rounded-xl px-4 py-3 ${message.actorKind === 'owner' ? "ml-auto bg-orange-600 text-white" : "mr-auto bg-slate-100"}`}><p className="whitespace-pre-wrap text-sm">{message.body}</p><p className={`mt-1 text-[11px] ${message.actorKind === 'owner' ? "text-orange-100" : "text-slate-500"}`}>{message.actorKind === 'owner' ? "You" : account.displayName} · {new Date(message.createdAt).toLocaleString()}</p></div>) : <p className="py-8 text-center text-sm text-slate-500">No messages yet.</p>}</div><div className="mt-4 grid gap-2 border-t pt-4"><textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message…" /><button className="button-primary w-fit" disabled={busy || !body.trim()} type="button" onClick={async () => { setBusy(true); try { await apiPost(`/office-admin/messages/${account.id}`, { body: body.trim() }); setBody(""); await onChanged(); } finally { setBusy(false); } }}>{busy ? "Sending…" : "Send Message"}</button></div></section>;
}

function AccountPanel({ accounts, selected, onChanged }: { accounts: Account[]; selected: Account | null; onChanged: (message: string) => Promise<void> }) {
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [error, setError] = useState("");
  const [permissionBusy, setPermissionBusy] = useState(false);
  async function create() {
    setError("");
    try { await apiPost("/office-admin/accounts", { loginName, displayName, password }); setLoginName(""); setDisplayName(""); setPassword(""); await onChanged("Office Coordinator account created."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create account."); }
  }
  return (
    <div className="grid gap-5">
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p> : null}
      {!accounts.length ? (
        <section className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-xl font-bold">Create Office Coordinator login</h2>
          <p className="text-sm text-slate-600">Create the username and temporary password you want to give the coordinator.</p>
          <label className="grid gap-1 text-sm font-semibold">Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">Username<input value={loginName} onChange={(e) => setLoginName(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">Temporary password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="button-primary w-fit" disabled={!displayName.trim() || !loginName.trim() || password.length < 8} type="button" onClick={() => void create()}>Create Account</button>
        </section>
      ) : null}
      {selected ? (
        <section className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm">
          <div><h2 className="text-xl font-bold">{selected.displayName}</h2><p className="text-sm text-slate-600">Username: {selected.loginName} · {selected.enabled ? "Enabled" : "Disabled"}</p></div>
          <div className="flex flex-wrap gap-2">
            <button className="button-secondary" type="button" onClick={async () => { await apiPatch(`/office-admin/accounts/${selected.id}`, { enabled: !selected.enabled }); await onChanged(selected.enabled ? "Account disabled." : "Account enabled."); }}>{selected.enabled ? "Disable Account" : "Enable Account"}</button>
            <button className="button-secondary" type="button" onClick={async () => { await apiPost(`/office-admin/accounts/${selected.id}/sign-out-all`, {}); await onChanged("All Office Coordinator sessions signed out."); }}>Sign Out All</button>
          </div>
          <div className="border-t pt-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="font-semibold" htmlFor={`website-inquiries-${selected.id}`}>Website inquiries</label>
                <p className="mt-1 max-w-xl text-sm text-slate-600" id={`website-inquiries-help-${selected.id}`}>Allows this account to see public contact details and convert reviewed inquiries into CRM leads.</p>
              </div>
              <input
                aria-describedby={`website-inquiries-help-${selected.id}`}
                aria-label="Website inquiries"
                checked={selected.canReviewWebsiteInquiries}
                disabled={permissionBusy}
                id={`website-inquiries-${selected.id}`}
                onChange={async (event) => {
                  setPermissionBusy(true);
                  setError("");
                  try {
                    await apiPatch(`/office-admin/accounts/${selected.id}`, { canReviewWebsiteInquiries: event.target.checked });
                    await onChanged(event.target.checked ? "Website inquiry access granted." : "Website inquiry access removed.");
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Could not update website inquiry access.");
                  } finally {
                    setPermissionBusy(false);
                  }
                }}
                role="switch"
                type="checkbox"
              />
            </div>
          </div>
          <div className="grid gap-2 border-t pt-3">
            <label className="grid gap-1 text-sm font-semibold">Reset password<input type="password" placeholder="New password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} /></label>
            <button className="button-primary w-fit" disabled={resetPassword.length < 8} type="button" onClick={async () => { await apiPut(`/office-admin/accounts/${selected.id}/password`, { password: resetPassword }); setResetPassword(""); await onChanged("Password reset. Existing sessions were signed out."); }}>Reset Password</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// Boss account management panel — owner-only, lives in admin surface only.
type BossAccount = { id: string; loginName: string; displayName: string; enabled: boolean; studioOfficeAccountId: string | null };
type BossOfficeTarget = { id: string; displayName: string };
type OwnerBossAssignment = { id: string; title: string; details: string | null; priority: string; status: string; dueAt: string | null; updatedAt: string };

export function BossAccountPanel() {
  const [accounts, setAccounts] = useState<BossAccount[]>([]);
  const [officeTargets, setOfficeTargets] = useState<BossOfficeTarget[]>([]);
  const [studioOfficeAccountId, setStudioOfficeAccountId] = useState("");
  const [ownerAssignments, setOwnerAssignments] = useState<OwnerBossAssignment[]>([]);
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetPasswordValues, setResetPasswordValues] = useState<Record<string, string>>({});
  const [accountEdits, setAccountEdits] = useState<Record<string, { displayName: string; loginName: string }>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadBossAccounts = useCallback(async () => {
    try {
      const [accountData, assignmentData, officeData] = await Promise.all([
        apiGet<{ accounts: BossAccount[] }>("/boss-admin/accounts"),
        apiGet<{ assignments: OwnerBossAssignment[] }>("/owner/boss-assignments"),
        apiGet<{ accounts: BossOfficeTarget[] }>("/office-admin/accounts"),
      ]);
      setAccounts(accountData.accounts ?? []);
      setOwnerAssignments(assignmentData.assignments ?? []);
      setOfficeTargets(officeData.accounts ?? []);
      setStudioOfficeAccountId((current) => current || officeData.accounts?.[0]?.id || "");
    } catch { setAccounts([]); setOwnerAssignments([]); }
  }, []);

  useEffect(() => { void loadBossAccounts(); }, [loadBossAccounts]);

  async function create() {
    setBusy(true); setError(""); setNotice("");
    try {
      await apiPost("/boss-admin/accounts", { loginName: loginName.trim(), displayName: displayName.trim(), password, studioOfficeAccountId: studioOfficeAccountId || null });
      setLoginName(""); setDisplayName(""); setPassword("");
      setNotice("Boss account created.");
      await loadBossAccounts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create Boss account.");
    } finally { setBusy(false); }
  }

  async function toggleEnabled(account: BossAccount) {
    setError(""); setNotice("");
    try {
      await apiPatch(`/boss-admin/accounts/${account.id}`, { enabled: !account.enabled });
      setNotice(account.enabled ? "Boss account disabled." : "Boss account enabled.");
      await loadBossAccounts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update Boss account.");
    }
  }

  async function signOutAll(account: BossAccount) {
    setError(""); setNotice("");
    try {
      await apiPost(`/boss-admin/accounts/${account.id}/sign-out-all`, {});
      setNotice("All Boss sessions signed out.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    }
  }

  async function resetPassword(account: BossAccount) {
    const newPwd = resetPasswordValues[account.id] ?? "";
    if (newPwd.length < 8) return;
    setError(""); setNotice("");
    try {
      await apiPut(`/boss-admin/accounts/${account.id}/password`, { password: newPwd });
      setResetPasswordValues((prev) => ({ ...prev, [account.id]: "" }));
      setNotice("Boss password reset. Existing sessions were signed out.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset password.");
    }
  }

  async function saveAccount(account: BossAccount) {
    const values = accountEdits[account.id] ?? { displayName: account.displayName, loginName: account.loginName };
    setError(""); setNotice("");
    try {
      await apiPatch(`/boss-admin/accounts/${account.id}`, {
        displayName: values.displayName.trim(),
        loginName: values.loginName.trim(),
      });
      setNotice("Boss login updated.");
      await loadBossAccounts();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update Boss login.");
    }
  }

  return (
    <div className="grid gap-5">
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{notice}</p> : null}

      <section className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-xl font-bold">Create Boss login</h2>
        <p className="text-sm text-slate-600">Provision a Boss workspace account for Dave.</p>
        <label className="grid gap-1 text-sm font-semibold">Name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Dave" /></label>
        <label className="grid gap-1 text-sm font-semibold">Username<input value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder="boss" /></label>
        <label className="grid gap-1 text-sm font-semibold">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 8 characters" /></label>
        <label className="grid gap-1 text-sm font-semibold">Documents workspace<select value={studioOfficeAccountId} onChange={(e) => setStudioOfficeAccountId(e.target.value)}><option value="">No workspace yet</option>{officeTargets.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label>
        <button className="button-primary w-fit" disabled={busy || !loginName.trim() || !displayName.trim() || password.length < 8} type="button" onClick={() => void create()}>
          {busy ? "Creating…" : "Create Boss Account"}
        </button>
      </section>

      {accounts.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-xl font-bold">Boss accounts</h2>
          {accounts.map((account) => (
            <div key={account.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{account.displayName}</p>
                  <p className="text-sm text-slate-600">Username: {account.loginName} · {account.enabled ? "Enabled" : "Disabled"}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button className="button-secondary" type="button" onClick={() => void toggleEnabled(account)}>
                    {account.enabled ? "Disable" : "Enable"}
                  </button>
                  <button className="button-secondary" type="button" onClick={() => void signOutAll(account)}>
                    Sign Out All
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 border-t pt-3">
                <label className="grid gap-1 text-sm font-semibold">
                  Name
                  <input
                    value={accountEdits[account.id]?.displayName ?? account.displayName}
                    onChange={(e) => setAccountEdits((current) => ({ ...current, [account.id]: { displayName: e.target.value, loginName: current[account.id]?.loginName ?? account.loginName } }))}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Username
                  <input
                    value={accountEdits[account.id]?.loginName ?? account.loginName}
                    onChange={(e) => setAccountEdits((current) => ({ ...current, [account.id]: { displayName: current[account.id]?.displayName ?? account.displayName, loginName: e.target.value } }))}
                  />
                </label>
                <button
                  className="button-secondary w-fit"
                  disabled={!(accountEdits[account.id]?.displayName ?? account.displayName).trim() || !(accountEdits[account.id]?.loginName ?? account.loginName).trim()}
                  type="button"
                  onClick={() => void saveAccount(account)}
                >
                  Save Login
                </button>
                <label className="grid gap-1 text-sm font-semibold">
                  Documents workspace
                  <select value={account.studioOfficeAccountId ?? ""} onChange={async (e) => { await apiPatch(`/boss-admin/accounts/${account.id}`, { studioOfficeAccountId: e.target.value || null }); await loadBossAccounts(); }}>
                    <option value="">No workspace linked</option>
                    {officeTargets.map((target) => <option key={target.id} value={target.id}>{target.displayName}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-semibold">
                  Reset password
                  <input
                    type="password"
                    placeholder="New password"
                    value={resetPasswordValues[account.id] ?? ""}
                    onChange={(e) => setResetPasswordValues((prev) => ({ ...prev, [account.id]: e.target.value }))}
                  />
                </label>
                <button
                  className="button-primary w-fit"
                  disabled={(resetPasswordValues[account.id] ?? "").length < 8}
                  type="button"
                  onClick={() => void resetPassword(account)}
                >
                  Reset Password
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}
      <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-foreground">Assignments for you</h2>
          <p className="text-sm text-muted-foreground">Work Dave assigned directly to the owner.</p>
        </div>
        {ownerAssignments.length ? ownerAssignments.map((assignment) => (
          <div key={assignment.id} className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground">{assignment.title}</p>
                {assignment.details ? <p className="mt-1 text-sm text-muted-foreground">{assignment.details}</p> : null}
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-primary">{assignment.priority} · {assignment.status.replace("_", " ")}</span>
            </div>
            {assignment.dueAt ? <p className="mt-2 text-xs text-muted-foreground">Due {new Date(assignment.dueAt).toLocaleDateString()}</p> : null}
          </div>
        )) : <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No assignments from Dave.</p>}
      </section>
    </div>
  );
}
