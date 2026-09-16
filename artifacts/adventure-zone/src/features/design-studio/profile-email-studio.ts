import { createDefaultEmailDocument } from "@/lib/design-studio/email-model";
import { designStudioApi } from "@/lib/design-studio-api";

type EmailContact = {
  id: string;
  email: string | null;
  isPrimary: boolean;
  isActive?: boolean;
};

export function selectProfileEmailContact(contacts: EmailContact[]) {
  const eligible = contacts.filter(
    (contact) => contact.isActive !== false && contact.email?.trim(),
  );
  const selected = eligible.find((contact) => contact.isPrimary) ?? eligible[0];
  return selected ? { id: selected.id, email: selected.email!.trim() } : null;
}

export function safeProfileReturnTo(value: string) {
  return /^\/profiles(?:\/|\?|$)/.test(value) ? value : "/profiles";
}

export async function createProfileEmailProject(input: {
  organizationId: string;
  organizationName: string;
  contactId: string;
  now?: Date;
}) {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(input.now ?? new Date());
  return designStudioApi.create({
    type: "email",
    name: `${input.organizationName} email · ${date}`,
    linkedOrganizationId: input.organizationId,
    linkedContactId: input.contactId,
    content: JSON.stringify(createDefaultEmailDocument()),
  });
}
