import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { AssistantContextRegistration } from "@/components/assistant/assistant-context-registration";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import {
  createActivityAction,
  deleteActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
  loadTimelinePageAction,
} from "@/actions/activities";
import type { ReactNode } from "react";
import type { ContactPhoneRecord } from "@/features/contact-phones/contact-phone-types";

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-sm font-semibold text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 text-slate-900">
            {item.value == null || item.value === "" ? "Not set" : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ContactDetailPage({ contactId }: { contactId: string }) {
  const { openAssistant } = useAssistantContext();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId) {
      setError("Contact not found");
      setLoading(false);
      return;
    }
    apiGet<any>(`/contacts/${contactId}`)
      .then((d) => {
        const coerced = {
          ...d,
          timeline: (d.timeline ?? []).map((item: any) => ({
            ...item,
            occurredAt: item.occurredAt ? new Date(item.occurredAt) : item.occurredAt,
            createdAt: item.createdAt ? new Date(item.createdAt) : item.createdAt,
            updatedAt: item.updatedAt ? new Date(item.updatedAt) : item.updatedAt,
          })),
        };
        setData(coerced);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [contactId]);

  if (loading) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-slate-500">Opening profile…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  const { contact, relatedBookings, timeline, phones = [] } = data;
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();
  const callSuppressed = phones.length > 0 && phones.every((phone: ContactPhoneRecord) => Boolean(phone.doNotCallAt));
  const assistedCallingEnabled = data.assistedCallingEnabled === true;

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <AssistantContextRegistration kind="contact" label={fullName} recordId={contactId} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{fullName}</h1>
          {contact.jobTitle && <p className="mt-1 text-slate-600">{contact.jobTitle}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="button-secondary" onClick={() => openAssistant("What should I know before I call this person?")} type="button">Ask Assistant</button>
          {callSuppressed ? (
            <button className="button-primary" disabled type="button">Call</button>
          ) : (
            <Link className="button-primary text-center" href={`/calls/workspace?contactId=${contactId}`}>Call</Link>
          )}
          {assistedCallingEnabled ? <Link className="button-secondary text-center" href={`/calls/log?contactId=${contactId}`}>Log call</Link> : null}
          <Link className="button-secondary text-center" href={`/contacts/${contactId}/edit`}>Edit contact</Link>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <DetailSection title="Details">
          <DetailList
            items={[
              { label: "Email", value: contact.email ? <a className="link" href={`mailto:${contact.email}`}>{contact.email}</a> : null },
              { label: "Phone", value: phones.length ? (
                <ul className="grid gap-2">
                  {phones.map((phone: ContactPhoneRecord) => (
                    <li key={phone.id} className="flex flex-wrap items-center gap-2">
                      {phone.doNotCallAt
                        ? <span>{phone.number}</span>
                        : <a className="link" href={`tel:${phone.number}`}>{phone.number}</a>}
                      <span className="text-sm text-slate-500">{phone.label ?? phone.type}{phone.extension ? ` ext. ${phone.extension}` : ""}</span>
                      {phone.primary ? <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">Primary</span> : null}
                      {phone.doNotCallAt ? <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">Do Not Call</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (contact.phone ? <a className="link" href={`tel:${contact.phone}`}>{contact.phone}</a> : null) },
              { label: "Location", value: [contact.city, contact.region].filter(Boolean).join(", ") },
            ]}
          />
        </DetailSection>

        <DetailSection title="Bookings">
          {relatedBookings?.length ? (
            <ul className="grid gap-2">
              {relatedBookings.map((b: any) => (
                <li key={b.id}>
                  <Link className="link" href={`/bookings/${b.id}`}>{b.name}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No bookings</p>
          )}
        </DetailSection>
      </div>

      <ActivityTimeline
        activities={timeline ?? []}
        parent={{ contactId }}
        createActivity={createActivityAction}
        deleteActivity={deleteActivityAction}
        editActivity={editActivityAction}
        loadRevisions={listActivityRevisionsAction}
        initialNextPage={data.timelineNextPage ?? null}
        loadPage={(page) => loadTimelinePageAction({ contactId }, page)}
      />
    </div>
  );
}
