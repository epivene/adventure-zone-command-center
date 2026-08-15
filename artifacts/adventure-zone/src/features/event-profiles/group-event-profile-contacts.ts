import type { EventProfileContact } from "./event-profile-repository";

export type GroupedEventProfileContact = EventProfileContact & {
  locations: string[];
  contactIds: string[];
};

function keyFor(contact: EventProfileContact) {
  const name = contact.name.trim().toLowerCase();
  const email = contact.email?.trim().toLowerCase();
  if (email) return `email:${name}:${email}`;
  const phone = contact.phone?.replace(/\D/g, "");
  if (phone) return `phone:${name}:${phone}`;
  if (contact.id) return `id:${contact.id}`;
  return `record:${contact.name.trim().toLowerCase()}`;
}

function locationFor(contact: EventProfileContact) {
  const label = contact.locationName?.trim();
  const city = [contact.locationCity, contact.locationRegion].filter(Boolean).join(", ");
  return label || city || null;
}

export function groupEventProfileContacts(contacts: EventProfileContact[]): GroupedEventProfileContact[] {
  const groups = new Map<string, GroupedEventProfileContact>();
  for (const contact of contacts) {
    const key = keyFor(contact);
    const existing = groups.get(key);
    const location = locationFor(contact);
    if (!existing) {
      groups.set(key, { ...contact, locations: location ? [location] : [], contactIds: [contact.id] });
      continue;
    }
    if (location && !existing.locations.includes(location)) existing.locations.push(location);
    if (!existing.contactIds.includes(contact.id)) existing.contactIds.push(contact.id);
    existing.isPrimary ||= contact.isPrimary;
    existing.role ||= contact.role;
    existing.phone ||= contact.phone;
    existing.email ||= contact.email;
  }
  return [...groups.values()];
}
