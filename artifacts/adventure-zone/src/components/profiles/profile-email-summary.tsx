import { useEffect, useState } from "react";
import { AlertCircle, Mail, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";

import { ProfileGoogleConversationCard } from "@/components/google-workspace/profile-google-email-panel";
import { useProfileGoogleEmail } from "@/components/google-workspace/use-profile-google-email";
import {
  createProfileEmailProject,
  safeProfileReturnTo,
  selectProfileEmailContact,
} from "@/features/design-studio/profile-email-studio";
import { apiGet } from "@/lib/auth-token";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  isPrimary: boolean;
  isActive?: boolean;
};

type Draft = {
  id: string;
  subject: string;
  recipientEmail: string;
  state: string;
};

const ACTIVE_DRAFT_STATES = new Set([
  "draft",
  "gmail_draft",
  "scheduled",
  "needs_changes",
  "failed",
]);
const EDITABLE_DRAFT_STATES = new Set(["draft", "needs_changes"]);

const STATE_LABELS: Record<string, string> = {
  draft: "Saved draft",
  gmail_draft: "Gmail draft",
  scheduled: "Scheduled",
  needs_changes: "Needs changes",
  failed: "Needs review",
};

export function ProfileEmailSummary({
  organizationId,
  organizationName,
  contacts,
}: {
  organizationId: string;
  organizationName: string;
  contacts: Contact[];
}) {
  const [location, navigate] = useLocation();
  const gmail = useProfileGoogleEmail(organizationId);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const recipient = selectProfileEmailContact(contacts);

  useEffect(() => {
    let active = true;
    setDraftsLoading(true);
    setDraftsError(null);
    void apiGet<{ drafts: Draft[] }>(
      `/office-admin/profile-email-drafts/${organizationId}`,
    )
      .then((result) => {
        if (active) {
          setDrafts(
            result.drafts.filter((draft) =>
              ACTIVE_DRAFT_STATES.has(draft.state),
            ),
          );
        }
      })
      .catch(() => {
        if (active) setDraftsError("Could not load saved email drafts.");
      })
      .finally(() => {
        if (active) setDraftsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  async function startDraft() {
    if (!recipient || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const project = await createProfileEmailProject({
        organizationId,
        organizationName,
        contactId: recipient.id,
      });
      const returnTo = safeProfileReturnTo(location);
      navigate(
        `/design-studio/${project.id}?returnTo=${encodeURIComponent(returnTo)}`,
      );
    } catch (caught) {
      setCreateError(
        caught instanceof Error
          ? caught.message
          : "Could not open a new email draft.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <section
      className="rounded-md border border-[#d8d1c4] bg-[#fffefa] p-4"
      data-testid="profile-email-summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#bc3e20]">
            Email
          </p>
          <p className="mt-1 break-all text-sm font-bold text-[#182225]">
            {recipient?.email ?? "No primary contact email"}
          </p>
          {!recipient ? (
            <p className="mt-1 text-xs text-[#a63f35]">
              Add a contact email first
            </p>
          ) : null}
        </div>
        <button
          className="button-primary inline-flex items-center gap-2 !bg-[#e85d35]"
          disabled={!recipient || creating}
          onClick={() => void startDraft()}
          type="button"
        >
          <Plus className="h-4 w-4" />
          {creating ? "Opening…" : "New Draft"}
        </button>
      </div>

      {createError ? (
        <p
          className="mt-3 flex items-center gap-2 text-sm text-[#a63f35]"
          role="alert"
        >
          <AlertCircle className="h-4 w-4" />
          {createError}
        </p>
      ) : null}

      <div className="mt-4 border-t border-[#d8d1c4] pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-[#182225]">
            Recent conversations
          </h3>
          <Link
            className="text-xs font-bold text-[#157d78] hover:underline"
            href={`/profiles/${organizationId}?section=emails`}
          >
            View all emails
          </Link>
        </div>
        {gmail.loading ? (
          <p className="mt-2 text-sm text-[#536064]">Loading email history…</p>
        ) : gmail.error ? (
          <p className="mt-2 text-sm text-[#a63f35]">{gmail.error}</p>
        ) : gmail.conversations.length ? (
          <div className="mt-2 grid gap-2">
            {gmail.conversations.slice(0, 3).map((conversation) => (
              <ProfileGoogleConversationCard
                compact
                conversation={conversation}
                key={conversation.threadId}
                onFilesCopied={() => undefined}
                organizationId={organizationId}
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#536064]">
            No matched email conversations yet.
          </p>
        )}
      </div>

      <div className="mt-4 border-t border-[#d8d1c4] pt-4">
        <h3 className="text-sm font-bold text-[#182225]">Drafts</h3>
        {draftsLoading ? (
          <p className="mt-2 text-sm text-[#536064]">Loading drafts…</p>
        ) : draftsError ? (
          <p className="mt-2 text-sm text-[#a63f35]">{draftsError}</p>
        ) : drafts.length ? (
          <ul className="mt-2 grid gap-2">
            {drafts.map((draft) => (
              <li
                className="flex items-center gap-2 rounded-md bg-[#f6f2e9] px-3 py-2"
                key={draft.id}
              >
                <Mail className="h-4 w-4 shrink-0 text-[#157d78]" />
                <div className="min-w-0 flex-1">
                  {EDITABLE_DRAFT_STATES.has(draft.state) ? (
                    <Link
                      className="block truncate text-sm font-semibold text-[#182225] hover:text-[#157d78] hover:underline"
                      data-testid={`link-open-email-draft-${draft.id}`}
                      href={`/profiles/${organizationId}?section=emails&draftId=${encodeURIComponent(draft.id)}`}
                    >
                      {draft.subject || "(No subject)"}
                      <span className="sr-only"> — Open draft to edit</span>
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-semibold text-[#182225]">
                      {draft.subject || "(No subject)"}
                    </span>
                  )}
                </div>
                <span
                  className="shrink-0 text-right text-xs font-bold text-[#536064]"
                  data-testid={`status-email-draft-${draft.id}`}
                >
                  {STATE_LABELS[draft.state] ?? draft.state}
                  {!EDITABLE_DRAFT_STATES.has(draft.state) ? (
                    <span className="block font-normal">Not editable here</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[#536064]">No active drafts.</p>
        )}
      </div>
    </section>
  );
}
