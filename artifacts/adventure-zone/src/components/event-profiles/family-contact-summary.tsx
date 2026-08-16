import { Link } from "wouter";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";

export type FamilySharedContact = {
  familyId: string;
  familyName: string;
  website: string | null;
  primaryContact: {
    contactId: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

export function FamilyContactSummary({ shared }: { shared: FamilySharedContact | null }) {
  if (!shared) return null;
  const websiteHref = normalizeExternalWebsite(shared.website);
  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50 p-4" aria-label={`Family contact — ${shared.familyName}`}>
      <h2 className="font-bold text-orange-950">Family contact — {shared.familyName}</h2>
      {shared.primaryContact ? (
        <div className="mt-2 grid gap-1 text-sm text-slate-700">
          <p className="font-semibold">{shared.primaryContact.name}</p>
          {shared.primaryContact.role ? <p>{shared.primaryContact.role}</p> : null}
          {(shared.primaryContact.phone || shared.primaryContact.email) ? (
            <p>{[shared.primaryContact.phone, shared.primaryContact.email].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {websiteHref ? <a className="button-secondary" href={websiteHref} rel="noreferrer noopener" target="_blank">Family website</a> : null}
        <Link className="button-secondary" href={`/event-families/${shared.familyId}`}>Open family</Link>
      </div>
    </section>
  );
}
