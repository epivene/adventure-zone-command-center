import { describe, expect, it } from "vitest";

import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";
import { CallerFinderService } from "@/features/caller-finder/caller-finder-service";
import type {
  CallerCandidateQuery,
  CallerExactQuery,
  CallerFinderRepository,
} from "@/features/caller-finder/caller-finder-service";
import type { CallerFinderCandidate } from "@/features/caller-finder/caller-finder-types";
import type { CallRepository, CallTransaction } from "@/features/calls/call-repository";
import { CallService } from "@/features/calls/call-service";
import type {
  CallWorkspaceContext,
  CallWorkspaceContextRepository,
} from "@/features/calls/call-workspace-context";
import { loadCallWorkspace } from "@/features/calls/call-workspace-query";
import {
  ContactPhoneRepository,
  type ContactPhoneRecord,
  type ContactPhoneStore,
  type LegacyContactPhoneFields,
} from "@/features/contact-phones/contact-phone-repository";
import {
  getTodayDashboard,
  type TodayDashboardFollowUpRow,
  type TodayDashboardRepository,
} from "@/features/follow-ups/today-query";

const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";
const bookingId = "30000000-0000-4000-8000-000000000001";
const routeLegId = "40000000-0000-4000-8000-000000000001";
const originalFollowUpId = "50000000-0000-4000-8000-000000000001";
const officePhoneId = "60000000-0000-4000-8000-000000000001";
const mobilePhoneId = "60000000-0000-4000-8000-000000000002";
const requestKey = "70000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-13T16:00:00.000Z");
const completedAt = new Date("2026-08-13T16:05:00.000Z");

type Organization = {
  id: string;
  name: string;
  lastResort: boolean;
  lastResortReason: string | null;
};

type Contact = LegacyContactPhoneFields & {
  firstName: string;
  lastName: string;
  email: string | null;
  city: string | null;
  region: string | null;
};

type Booking = {
  id: string;
  organizationId: string;
  primaryContactId: string;
  name: string;
  city: string;
  region: string;
  status: "interested";
  probability: "possible";
  startsAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type FollowUp = {
  id: string;
  organizationId: string;
  contactId: string;
  bookingId: string;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
  outcome: string | null;
  nextFollowUpId: string | null;
  createdAt: Date;
};

type PersistedSessionInput = Parameters<CallTransaction["createCallSession"]>[0];

type CompletedSession = PersistedSessionInput & {
  id: string;
};

class AssistedCallingState implements
  ContactPhoneStore,
  CallRepository,
  CallTransaction,
  CallWorkspaceContextRepository,
  TodayDashboardRepository,
  CallerFinderRepository {
  organization!: Organization;
  contact!: Contact;
  booking!: Booking;
  routeLeg!: { id: string; name: string; color: string };
  phones: ContactPhoneRecord[] = [];
  followUps: FollowUp[] = [];
  sessions: CompletedSession[] = [];
  activities: Array<{
    id: string;
    organizationId: string | null;
    contactId: string | null;
    bookingId: string | null;
    body: string;
    occurredAt: Date;
  }> = [];
  private phoneSequence = 0;
  private followUpSequence = 0;

  createOrganization() {
    this.organization = {
      id: organizationId,
      name: "Prairie Event Center",
      lastResort: false,
      lastResortReason: null,
    };
  }

  createContact() {
    this.contact = {
      id: contactId,
      organizationId,
      firstName: "Avery",
      lastName: "Lee",
      email: "avery@example.test",
      phone: null,
      normalizedPhone: null,
      city: "Fargo",
      region: "ND",
    };
  }

  createBooking() {
    this.booking = {
      id: bookingId,
      organizationId,
      primaryContactId: contactId,
      name: "Harvest Festival",
      city: "Fargo",
      region: "ND",
      status: "interested",
      probability: "possible",
      startsAt: new Date("2026-09-01T14:00:00.000Z"),
      createdAt: new Date("2026-08-01T14:00:00.000Z"),
      updatedAt: new Date("2026-08-12T14:00:00.000Z"),
    };
  }

  createRouteLeg() {
    this.routeLeg = { id: routeLegId, name: "North Route", color: "#2563eb" };
  }

  createDueCall() {
    this.followUps.push({
      id: originalFollowUpId,
      organizationId,
      contactId,
      bookingId,
      kind: "call",
      dueAt: new Date("2026-08-13T15:00:00.000Z"),
      completedAt: null,
      outcome: null,
      nextFollowUpId: null,
      createdAt: new Date("2026-08-12T15:00:00.000Z"),
    });
  }

  transaction<T>(operation: (transaction: CallTransaction) => Promise<T>): Promise<T>;
  transaction<T>(operation: (store: ContactPhoneStore) => Promise<T>): Promise<T>;
  transaction<T>(operation: ((transaction: CallTransaction) => Promise<T>) | ((store: ContactPhoneStore) => Promise<T>)) {
    return operation(this as never);
  }

  async lockContact(id: string) {
    return id === this.contact.id ? this.contact : null;
  }

  async listForContact(id: string) {
    return this.phones.filter((phone) => phone.contactId === id).map((phone) => ({ ...phone }));
  }

  async insertPhone(input: Omit<ContactPhoneRecord, "id" | "source" | "doNotCallAt" | "doNotCallReason">) {
    const requestedId = this.phoneSequence++ === 0 ? mobilePhoneId : officePhoneId;
    const phone: ContactPhoneRecord = {
      ...input,
      id: requestedId,
      source: "local",
      doNotCallAt: null,
      doNotCallReason: null,
    };
    this.phones.push(phone);
    return { ...phone };
  }

  async updatePhone(id: string, input: Parameters<ContactPhoneStore["updatePhone"]>[1]) {
    const phone = this.phones.find((candidate) => candidate.id === id);
    if (!phone) throw new Error("Contact phone is missing.");
    Object.assign(phone, input);
    return { ...phone };
  }

  async deletePhones(ids: string[]) {
    this.phones = this.phones.filter((phone) => !ids.includes(phone.id));
  }

  async updateLegacyContact(id: string, phone: string | null, normalizedPhone: string | null) {
    if (id !== this.contact.id) throw new Error("Contact is missing.");
    this.contact.phone = phone;
    this.contact.normalizedPhone = normalizedPhone;
  }

  async markPhoneDoNotCall(id: string, reason: string, at: Date): Promise<any> {
    const phone = this.phones.find((candidate) => candidate.id === id);
    if (!phone) throw new Error("Contact phone is missing.");
    phone.doNotCallAt = at;
    phone.doNotCallReason = reason;
    return { ...phone };
  }

  async lockRequest(key: string) {
    return this.sessions.find((session) => session.requestKey === key) ?? null;
  }

  async lockContext() {
    const followUp = this.followUps.find(({ id }) => id === originalFollowUpId)!;
    return {
      organization: this.organization,
      contact: {
        ...this.contact,
        jobTitle: null,
        address1: null,
        address2: null,
        postalCode: null,
      },
      booking: this.booking,
      followUp,
      contactHasActiveOrganizationRelationship: true,
      contactHasBookingRelationship: true,
    };
  }

  async lockContactPhone(id: string, linkedContactId: string) {
    const phone = this.phones.find((candidate) =>
      candidate.id === id && candidate.contactId === linkedContactId
    );
    return phone
      ? { id: phone.id, number: phone.number, extension: phone.extension }
      : null;
  }

  async createActivity(input: Omit<AssistedCallingState["activities"][number], "id">) {
    const activity = { id: `activity-${this.activities.length + 1}`, ...input };
    this.activities.push(activity);
    return { id: activity.id };
  }

  async createCallSession(input: PersistedSessionInput) {
    const session = { id: `session-${this.sessions.length + 1}`, ...input };
    this.sessions.push(session);
    return { id: session.id };
  }

  async completeFollowUp(id: string, input: { outcome: string; completedAt: Date }) {
    const followUp = this.followUps.find((candidate) => candidate.id === id)!;
    Object.assign(followUp, input);
  }

  async createFollowUp(input: Omit<FollowUp, "id" | "completedAt" | "outcome" | "nextFollowUpId" | "createdAt">) {
    const next: FollowUp = {
      ...input,
      id: `80000000-0000-4000-8000-${String(++this.followUpSequence).padStart(12, "0")}`,
      completedAt: null,
      outcome: null,
      nextFollowUpId: null,
      createdAt: completedAt,
    };
    this.followUps.push(next);
    return { id: next.id };
  }

  async linkNextFollowUp(id: string, nextFollowUpId: string) {
    this.followUps.find((candidate) => candidate.id === id)!.nextFollowUpId = nextFollowUpId;
  }

  async updateBooking() {
    return this.booking;
  }

  async updateContact() {
    return this.contact;
  }

  async setLastResort(_id: string, reason: string) {
    this.organization.lastResort = true;
    this.organization.lastResortReason = reason;
  }

  async createAuditEntry() {}

  async findOrganization(id: string) {
    return id === this.organization.id ? this.organization : null;
  }

  async findContact(id: string) {
    return id === this.contact.id
      ? {
          id: this.contact.id,
          organizationId: this.contact.organizationId,
          firstName: this.contact.firstName,
          lastName: this.contact.lastName,
          email: this.contact.email,
          phone: this.contact.phone,
          city: this.contact.city,
          region: this.contact.region,
        }
      : null;
  }

  async findBooking(id: string) {
    return id === this.booking.id ? this.booking : null;
  }

  async findFollowUp(id: string) {
    return this.followUps.find((followUp) => followUp.id === id) ?? null;
  }

  async hasActiveOrganizationContact(requestedOrganizationId: string, requestedContactId: string) {
    return requestedOrganizationId === organizationId && requestedContactId === contactId;
  }

  async hasBookingContact(requestedBookingId: string, requestedContactId: string) {
    return requestedBookingId === bookingId && requestedContactId === contactId;
  }

  async findLastContactedAt(_context: CallWorkspaceContext) {
    return this.activities.toSorted((left, right) =>
      right.occurredAt.getTime() - left.occurredAt.getTime()
    )[0]?.occurredAt ?? null;
  }

  private todayRow(followUp: FollowUp): TodayDashboardFollowUpRow {
    return {
      booking: this.booking,
      contact: {
        organizationId,
        firstName: this.contact.firstName,
        lastName: this.contact.lastName,
      },
      followUp,
      organization: { name: this.organization.name },
      lastContactedAt: this.activities.at(-1)?.occurredAt ?? null,
    };
  }

  async getCounts() {
    return {
      followUpCount: this.followUps.filter(({ completedAt }) => !completedAt).length,
      newLeadCount: 0,
      contractCount: 0,
    };
  }

  async listOpenFollowUps({ page }: { page: number }) {
    const records = this.followUps
      .filter(({ completedAt }) => !completedAt)
      .map((followUp) => this.todayRow(followUp));
    return { records, total: records.length, page };
  }

  async findNextCall() {
    const followUp = this.followUps.find(({ completedAt, kind }) => !completedAt && kind === "call");
    return followUp ? this.todayRow(followUp) : null;
  }

  async listNeedsFollowUpPlan(_futureBoundary: Date, { page }: { page: number }) {
    return { records: [], total: 0, page };
  }

  async listUpcomingEvents() {
    return [];
  }

  private callerCandidate(): CallerFinderCandidate {
    return {
      contactId,
      name: `${this.contact.firstName} ${this.contact.lastName}`,
      email: this.contact.email,
      normalizedPhones: this.phones.map(({ normalizedNumber }) => normalizedNumber).filter((value): value is string => Boolean(value)),
      organizationName: this.organization.name,
      city: this.contact.city,
      region: this.contact.region,
      bookingName: this.booking.name,
      bookingStatus: this.booking.status,
      routeLegName: this.routeLeg.name,
      lastContactedAt: this.activities.at(-1)?.occurredAt ?? null,
      dueToday: this.followUps.some(({ completedAt, dueAt }) =>
        !completedAt && dueAt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
      ),
      noteText: this.activities.at(-1)?.body ?? null,
      matchedOrganizationOrEvent: false,
      matchedLocation: false,
      matchedRouteLeg: false,
    };
  }

  async findCallerCandidates(_query: CallerCandidateQuery) {
    return [this.callerCandidate()];
  }

  async findCallerExactMetadata(query: CallerExactQuery) {
    return {
      exactPhoneContactIds: this.callerCandidate().normalizedPhones.includes(query.normalizedPhone ?? "")
        ? [contactId]
        : [],
      hasExactEmail: query.normalizedEmail === this.contact.email,
    };
  }
}

const operations: BookingOperationsSummary = {
  packageNames: [],
  sharedAttractionTotal: null,
  pendingRequestCount: 0,
  leg: { id: routeLegId, name: "North Route", color: "#2563eb" },
  warnings: [],
};

describe("assisted calling complete workflow", () => {
  it("preserves call evidence, follow-up continuity, caller matching, and number-level suppression", async () => {
    const state = new AssistedCallingState();
    state.createOrganization();
    state.createContact();
    state.createBooking();
    state.createRouteLeg();
    state.createDueCall();
    const phoneRepository = new ContactPhoneRepository(state);
    await phoneRepository.replaceForContact(contactId, [
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: "Avery mobile", primary: true },
      { id: null, number: "701-555-0100", type: "office", extension: "12", label: "Front desk", primary: false },
    ], now);

    const today = await getTodayDashboard(now, state, {}, {
      getForBooking: async () => operations,
    });
    expect(today.nextCall).toMatchObject({
      id: originalFollowUpId,
      bookingId,
      contactId,
      routeLeg: { id: routeLegId, name: "North Route" },
    });

    const workspace = await loadCallWorkspace(
      { followUpId: originalFollowUpId },
      state,
      phoneRepository,
      { getForBooking: async () => operations },
    );
    expect(workspace).toMatchObject({
      ok: true,
      value: {
        contextSummary: {
          bookingStatus: "interested",
          bookingStatusLabel: "Interested",
          travelLeg: { id: routeLegId, name: "North Route" },
          lastContactedAt: null,
        },
        defaultScriptKind: "follow_up",
        phones: [
          { id: mobilePhoneId, type: "mobile", primary: true },
          { id: officePhoneId, type: "office", extension: "12", primary: false },
        ],
      },
    });

    const result = await new CallService(state, { now: () => completedAt }).complete({
      requestKey,
      organizationId,
      contactId,
      bookingId,
      followUpId: originalFollowUpId,
      note: "Spoke with the office and scheduled a follow-up.",
      disposition: "follow_up_needed",
      resultingBookingStatus: null,
      startedAt: now,
      endedAt: completedAt,
      nextAction: { kind: "call", dueAt: new Date("2026-08-14T16:00:00.000Z") },
      lastResortReason: null,
      lastResortConfirmed: false,
      approvedContactUpdates: null,
      approvedBookingUpdates: null,
      direction: "outgoing",
      method: "office_call",
      phoneId: officePhoneId,
      scriptKind: "follow_up",
      doNotCallConfirmed: false,
      doNotCallReason: null,
      doNotCallPhoneId: null,
      entryMode: "desktop",
    });
    expect(result.ok).toBe(true);

    const completedSession = state.sessions[0];
    const originalFollowUp = state.followUps.find(({ id }) => id === originalFollowUpId)!;
    const nextFollowUp = state.followUps.find(
      ({ id }) => id === (result.ok ? result.value.nextFollowUpId : null),
    )!;
    expect(completedSession).toMatchObject({
      direction: "outgoing",
      method: "office_call",
      phoneNumberSnapshot: "701-555-0100",
      phoneExtensionSnapshot: "12",
      scriptKind: "follow_up",
    });
    expect(originalFollowUp.completedAt).not.toBeNull();
    expect(nextFollowUp).toMatchObject({ kind: "call" });

    const callerFinder = new CallerFinderService(state);
    await expect(callerFinder.find({ phone: "701-555-0100", query: "" }))
      .resolves.toMatchObject({ exact: { kind: "one", contactId } });
    await expect(callerFinder.find({ phone: "701-555-9999", query: "" }))
      .resolves.toMatchObject({
        exact: { kind: "none" },
        suggestions: [expect.objectContaining({
          contactId,
          reasons: expect.arrayContaining(["Same area code"]),
        })],
      });

    await phoneRepository.markDoNotCall(mobilePhoneId, "Requested no mobile calls", completedAt);
    const suppressedWorkspace = await loadCallWorkspace(
      { contactId },
      state,
      phoneRepository,
      { getForBooking: async () => operations },
    );
    expect(suppressedWorkspace.ok).toBe(true);
    if (!suppressedWorkspace.ok) throw new Error("Expected the workspace to load.");
    expect(suppressedWorkspace.value.phones.find(({ id }) => id === mobilePhoneId))
      .toMatchObject({ doNotCallReason: "Requested no mobile calls" });
    expect(suppressedWorkspace.value.phones.filter(({ doNotCallAt }) => !doNotCallAt))
      .toEqual([expect.objectContaining({ id: officePhoneId })]);
    expect(state.organization.lastResort).toBe(false);
  });
});
