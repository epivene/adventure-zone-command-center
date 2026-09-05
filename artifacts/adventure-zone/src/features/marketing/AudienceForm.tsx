/**
 * AudienceForm — create or edit a durable server audience.
 *
 * Key correctness requirements:
 * - When editing, load existing members from GET /marketing/audiences/:id before
 *   allowing Save. Save is blocked until load completes (or fails with a clear error).
 * - Org search reads from GET /organizations?hasEmail=yes&q=... which returns
 *   { total, records } — use `records`, not `organizations`.
 * - After selecting an org, fetch GET /organizations/:id to get its contacts.
 *   Show ALL email-bearing contacts and let the user choose the exact recipient.
 *   Multiple contacts from one org are allowed.
 * - Membership identity is the composite organizationId + contactId pair.
 *   Remove uses that composite key, not organizationId alone.
 */

import { useEffect, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";

import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";

import {
  memberKey,
  type AudienceMemberDetail,
  type NoticeDispatch,
  type OrgContact,
  type OrgRecord,
  type SelectedMember,
  type ServerAudience,
} from "./types";

// ─── Pending contact picker ───────────────────────────────────────────────────

/**
 * Shown after clicking an org in search results. Displays all email-bearing
 * contacts and lets the user pick exactly which ones to add.
 */
function ContactPicker({
  orgId,
  orgName,
  alreadySelectedKeys,
  onPick,
  onDismiss,
  setNotice,
}: {
  orgId: string;
  orgName: string;
  alreadySelectedKeys: Set<string>;
  onPick: (members: SelectedMember[]) => void;
  onDismiss: () => void;
  setNotice: NoticeDispatch;
}) {
  const [contacts, setContacts] = useState<OrgContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<{ organization: { id: string; name: string; contacts: OrgContact[] } }>(
      `/organizations/${orgId}`,
    )
      .then((data) => {
        if (cancelled) return;
        const withEmail = (data.organization.contacts ?? []).filter(
          (c) => c.email?.trim(),
        );
        setContacts(withEmail);
        setLoading(false);
        if (!withEmail.length) {
          setError(`"${orgName}" has no email-bearing contacts.`);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(`Could not load contacts for "${orgName}".`);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [orgId, orgName]);

  function toggleContact(contactId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function addSelected() {
    const members: SelectedMember[] = contacts
      .filter((c) => selected.has(c.id))
      .map((c) => ({
        organizationId: orgId,
        contactId: c.id,
        orgName,
        contactName: [c.firstName, c.lastName].filter(Boolean).join(" ").trim(),
        email: c.email!.trim(),
      }));
    onPick(members);
  }

  return (
    <div
      className="rounded-lg border border-border bg-muted/30 p-3"
      data-testid={`contact-picker-${orgId}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold">
          Choose contacts from <span className="text-foreground">{orgName}</span>
        </p>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      </div>

      {loading ? (
        <div className="grid gap-1">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No email-bearing contacts found.</p>
      ) : (
        <>
          <div className="grid max-h-40 gap-1 overflow-y-auto">
            {contacts.map((c) => {
              const key = memberKey(orgId, c.id);
              const alreadyAdded = alreadySelectedKeys.has(key);
              const checked = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                    alreadyAdded
                      ? "border-border opacity-50 cursor-not-allowed"
                      : checked
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                  data-testid={`contact-option-${c.id}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={alreadyAdded}
                    onChange={() => toggleContact(c.id)}
                    className="shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                    </span>
                    {c.role ? (
                      <span className="ml-1 text-muted-foreground">({c.role})</span>
                    ) : null}
                    {c.isPrimary ? (
                      <span className="ml-1 text-primary font-semibold">Primary</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground shrink-0">{c.email}</span>
                  {alreadyAdded && (
                    <span className="shrink-0 text-muted-foreground">Added</span>
                  )}
                </label>
              );
            })}
          </div>
          <button
            className="button-primary mt-2 w-full"
            disabled={selected.size === 0}
            onClick={addSelected}
            data-testid={`contact-picker-add-${orgId}`}
          >
            <Plus className="h-3 w-3" />
            Add {selected.size > 0 ? `${selected.size} contact${selected.size !== 1 ? "s" : ""}` : "selected"}
          </button>
        </>
      )}
    </div>
  );
}

// ─── AudienceForm ─────────────────────────────────────────────────────────────

export function AudienceForm({
  existing,
  onSaved,
  onCancel,
  setNotice,
}: {
  existing: ServerAudience | null;
  onSaved: (audience: ServerAudience, isNew: boolean) => void;
  onCancel: () => void;
  setNotice: NoticeDispatch;
}) {
  const isNew = !existing;

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");

  // members — populated from server when editing; starts empty for new
  const [members, setMembers] = useState<SelectedMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(!isNew);
  const [membersError, setMembersError] = useState<string | null>(null);

  // org search
  const [orgSearch, setOrgSearch] = useState("");
  const [orgResults, setOrgResults] = useState<OrgRecord[]>([]);
  const [searching, setSearching] = useState(false);

  // contact picker: which org the user clicked to expand contacts
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);
  const [pendingOrgName, setPendingOrgName] = useState<string>("");

  const [saving, setSaving] = useState(false);

  // Composite keys of already-selected members, for dupe-detection in the picker
  const selectedKeys = new Set(members.map((m) => memberKey(m.organizationId, m.contactId)));

  // ── Load existing members when editing ──────────────────────────────────────
  useEffect(() => {
    if (isNew || !existing) return;
    let cancelled = false;
    setMembersLoading(true);
    setMembersError(null);

    apiGet<{ audience: ServerAudience; members: AudienceMemberDetail[] }>(
      `/marketing/audiences/${existing.id}`,
    )
      .then((data) => {
        if (cancelled) return;
        const loaded: SelectedMember[] = (data.members ?? []).map((m) => ({
          organizationId: m.organizationId,
          contactId: m.contactId,
          orgName: m.organizationName,
          contactName: m.contactName,
          email: m.email,
        }));
        setMembers(loaded);
        setMembersLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setMembersError(
          "Could not load existing members. Resolve this before saving to avoid accidentally erasing membership.",
        );
        setMembersLoading(false);
      });

    return () => { cancelled = true; };
  }, [isNew, existing]);

  // ── Org search ──────────────────────────────────────────────────────────────
  async function searchOrgs() {
    if (!orgSearch.trim()) return;
    setSearching(true);
    setOrgResults([]);
    try {
      // GET /organizations returns { total, records } — use `records`
      const params = new URLSearchParams({ hasEmail: "yes", pageSize: "50" });
      params.set("q", orgSearch.trim());
      const data = await apiGet<{ total: number; records: OrgRecord[] }>(
        `/organizations?${params.toString()}`,
      );
      const records = data.records ?? [];
      setOrgResults(records);
    } catch {
      setNotice({ kind: "error", text: "Could not search profiles. Try again." });
      setOrgResults([]);
    } finally {
      setSearching(false);
    }
  }

  function openContactPicker(org: OrgRecord) {
    setPendingOrgId(org.id);
    setPendingOrgName(org.name);
  }

  function onContactsPicked(newMembers: SelectedMember[]) {
    setMembers((prev) => {
      const existing = new Set(prev.map((m) => memberKey(m.organizationId, m.contactId)));
      const toAdd = newMembers.filter((m) => !existing.has(memberKey(m.organizationId, m.contactId)));
      return [...prev, ...toAdd];
    });
    setPendingOrgId(null);
    setPendingOrgName("");
  }

  // Remove by composite key
  function removeMember(organizationId: string, contactId: string) {
    const key = memberKey(organizationId, contactId);
    setMembers((prev) => prev.filter((m) => memberKey(m.organizationId, m.contactId) !== key));
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!name.trim() || saving || membersLoading || membersError) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        members: members.map((m) => ({
          organizationId: m.organizationId,
          contactId: m.contactId,
        })),
      };
      let audience: ServerAudience;
      if (isNew) {
        const data = await apiPost<{ audience: ServerAudience }>(
          "/marketing/audiences",
          body,
        );
        audience = data.audience;
      } else {
        const data = await apiPatch<{ audience: ServerAudience }>(
          `/marketing/audiences/${existing!.id}`,
          body,
        );
        audience = data.audience;
      }
      onSaved(audience, isNew);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save audience.",
      });
    } finally {
      setSaving(false);
    }
  }

  const saveBlocked = membersLoading || !!membersError;

  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid="audience-form">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">
          {isNew ? "New Audience" : `Edit: ${existing!.name}`}
        </h2>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Search for organizations, then choose the exact contacts to add. Multiple contacts
        from one organization are supported. Each contact is a distinct audience member.
      </p>

      <div className="mt-4 grid gap-3">
        {/* ── Name & description ── */}
        <label className="grid gap-1 text-sm font-semibold">
          Audience name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="2027 county fair outreach"
            data-testid="audience-name-input"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Description (optional)
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Who this audience is for…"
          />
        </label>

        {/* ── Existing members loading state (edit mode) ── */}
        {membersLoading && (
          <div className="rounded-lg border border-border bg-muted/20 p-3" data-testid="members-loading">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Loading existing members…
            </div>
            <div className="mt-2 grid gap-1">
              <Skeleton className="h-7" />
              <Skeleton className="h-7" />
            </div>
          </div>
        )}
        {membersError && (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            data-testid="members-load-error"
          >
            {membersError}
          </div>
        )}

        {/* ── Org search ── */}
        <div className="grid gap-1">
          <span className="text-sm font-semibold">Find organizations</span>
          <div className="flex gap-2">
            <input
              value={orgSearch}
              onChange={(e) => setOrgSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void searchOrgs(); }}
              placeholder="Search by name or city…"
              data-testid="audience-org-search-input"
            />
            <button
              className="button-secondary inline-flex shrink-0 items-center gap-2"
              onClick={() => void searchOrgs()}
              disabled={searching || !orgSearch.trim()}
              data-testid="audience-org-search-btn"
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </button>
          </div>
        </div>

        {/* ── Org results ── */}
        {orgResults.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Organizations with email contacts — click to choose recipients
            </p>
            <div className="grid max-h-56 gap-1 overflow-y-auto">
              {orgResults.map((org) => (
                <button
                  key={org.id}
                  onClick={() => openContactPicker(org)}
                  className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-primary/5 ${
                    pendingOrgId === org.id ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                  data-testid={`org-result-${org.id}`}
                >
                  <span>
                    <span className="font-semibold">{org.name}</span>
                    {org.city || org.region ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[org.city, org.region].filter(Boolean).join(", ")}
                      </span>
                    ) : null}
                  </span>
                  <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Contact picker for selected org ── */}
        {pendingOrgId && (
          <ContactPicker
            orgId={pendingOrgId}
            orgName={pendingOrgName}
            alreadySelectedKeys={selectedKeys}
            onPick={onContactsPicked}
            onDismiss={() => { setPendingOrgId(null); setPendingOrgName(""); }}
            setNotice={setNotice}
          />
        )}

        {/* ── Selected members ── */}
        {members.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Members — {members.length}
            </p>
            <div className="grid max-h-56 gap-1 overflow-y-auto">
              {members.map((m) => (
                <div
                  key={memberKey(m.organizationId, m.contactId)}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs"
                  data-testid={`selected-member-${m.organizationId}-${m.contactId}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{m.orgName}</span>
                    <span className="ml-2 text-muted-foreground">{m.contactName}</span>
                    <span className="ml-2 text-muted-foreground">{m.email}</span>
                  </span>
                  <button
                    onClick={() => removeMember(m.organizationId, m.contactId)}
                    className="shrink-0 text-destructive hover:text-destructive/80"
                    aria-label={`Remove ${m.contactName} from ${m.orgName}`}
                    data-testid={`remove-member-${m.organizationId}-${m.contactId}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex gap-2">
          <button
            className="button-primary flex-1"
            disabled={!name.trim() || saving || saveBlocked}
            onClick={() => void handleSave()}
            data-testid="audience-save-btn"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {membersLoading
              ? "Loading members…"
              : membersError
              ? "Members failed to load"
              : isNew
              ? "Create Audience"
              : "Save Changes"}
          </button>
          <button className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
