import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { db as appDatabase } from "@/db/client";
import {
  auditEntries,
  communicationBlocks,
  communicationTemplates,
  contacts,
  marketingAudienceMembers,
  marketingAudiences,
  marketingCampaignDeliveries,
  marketingCampaignEvents,
  marketingCampaignRecipients,
  marketingCampaigns,
  organizationContacts,
  organizations,
} from "@/db/schema";
import {
  createMailDeliveryFromEnv,
  MailConfigurationError,
  type MailDelivery,
} from "@/features/office/mail-delivery";

type Database = typeof appDatabase;
const tokenPattern = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class MarketingError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    message = code,
  ) {
    super(message);
  }
}

function safeProviderError(error: unknown): string {
  if (error instanceof MailConfigurationError) return error.message.slice(0, 500);
  return "The email provider could not deliver this message.";
}

export function renderMarketingCopy(text: string, values: Record<string, string | null | undefined>) {
  const output = text.replace(tokenPattern, (whole, token: string) => values[token]?.trim() || whole).trim();
  const unresolved = [...output.matchAll(tokenPattern)].map((match) => match[1]);
  if (unresolved.length) throw new MarketingError("UNRESOLVED_TEMPLATE_FIELDS", 422, `Unresolved template fields: ${[...new Set(unresolved)].join(", ")}`);
  return output;
}

export function canTransitionMarketingCampaign(
  state: string,
  action: "request_review" | "approve" | "schedule" | "send_now" | "retry" | "cancel",
) {
  return (
    (action === "request_review" && (state === "draft" || state === "needs_review"))
    || (action === "approve" && state === "needs_review")
    || (action === "schedule" && state === "approved")
    || (action === "send_now" && state === "approved")
    || (action === "retry" && state === "failed")
    || (action === "cancel" && ["draft", "needs_review", "approved", "scheduled", "failed"].includes(state))
  );
}

export class MarketingService {
  constructor(
    private readonly database: Database,
    private readonly mailFactory: () => MailDelivery = createMailDeliveryFromEnv,
  ) {}

  async listAudiences() {
    return this.database.select({
      id: marketingAudiences.id, name: marketingAudiences.name, description: marketingAudiences.description,
      createdBy: marketingAudiences.createdBy, createdAt: marketingAudiences.createdAt, updatedAt: marketingAudiences.updatedAt,
      memberCount: sql<number>`count(${marketingAudienceMembers.id})::int`,
    }).from(marketingAudiences).leftJoin(marketingAudienceMembers, eq(marketingAudienceMembers.audienceId, marketingAudiences.id))
      .groupBy(marketingAudiences.id).orderBy(asc(marketingAudiences.name));
  }

  async updateAudience(id: string, input: { name?: string; description?: string | null; members?: Array<{ organizationId: string; contactId: string }> }, actorId: string) {
    return this.database.transaction(async (tx) => {
      const [audience] = await tx.select().from(marketingAudiences).where(eq(marketingAudiences.id, id)).limit(1).for("update");
      if (!audience) throw new MarketingError("NOT_FOUND", 404);
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) set.name = input.name.trim();
      if (input.description !== undefined) set.description = input.description?.trim() || null;
      if (input.members !== undefined) {
        await tx.delete(marketingAudienceMembers).where(eq(marketingAudienceMembers.audienceId, id));
        if (input.members.length) await tx.insert(marketingAudienceMembers).values(input.members.map((member) => ({ ...member, audienceId: id }))).onConflictDoNothing();
        // An audience change invalidates every saved recipient confirmation. Active
        // campaigns are explicitly returned to review before any worker can claim them.
        await tx.update(marketingCampaigns).set({
          audienceRevision: sql`${marketingCampaigns.audienceRevision} + 1`,
          state: sql`case when ${marketingCampaigns.state} in ('approved','scheduled') then 'needs_review' else ${marketingCampaigns.state} end`,
          approvedAt: sql`case when ${marketingCampaigns.state} in ('approved','scheduled') then null else ${marketingCampaigns.approvedAt} end`,
          approvedBy: sql`case when ${marketingCampaigns.state} in ('approved','scheduled') then null else ${marketingCampaigns.approvedBy} end`,
          scheduledFor: sql`case when ${marketingCampaigns.state} = 'scheduled' then null else ${marketingCampaigns.scheduledFor} end`,
          updatedAt: new Date(),
        }).where(eq(marketingCampaigns.audienceId, id));
      }
      const [updated] = await tx.update(marketingAudiences).set(set).where(eq(marketingAudiences.id, id)).returning();
      return updated!;
    });
  }

  async createAudience(input: { name: string; description?: string | null; members: Array<{ organizationId: string; contactId: string }> }, actorId: string) {
    return this.database.transaction(async (tx) => {
      const [audience] = await tx.insert(marketingAudiences).values({
        name: input.name.trim(), description: input.description?.trim() || null, createdBy: actorId,
      }).returning();
      if (!audience) throw new Error("Audience was not created.");
      if (input.members.length) {
        await tx.insert(marketingAudienceMembers).values(input.members.map((member) => ({ ...member, audienceId: audience.id }))).onConflictDoNothing();
      }
      return audience;
    });
  }

  async deleteAudience(id: string) {
    try {
      const [row] = await this.database.delete(marketingAudiences).where(eq(marketingAudiences.id, id)).returning();
      if (!row) throw new MarketingError("NOT_FOUND", 404);
    } catch (error) {
      // Campaigns deliberately restrict audience deletion so historical campaign
      // evidence cannot be orphaned. Do not expose a database constraint name.
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23503") {
        throw new MarketingError("AUDIENCE_IN_USE", 409, "This audience is used by a campaign and cannot be deleted.");
      }
      throw error;
    }
  }

  async audienceDetail(id: string) {
    const [audience] = await this.database.select().from(marketingAudiences)
      .where(eq(marketingAudiences.id, id)).limit(1);
    if (!audience) throw new MarketingError("NOT_FOUND", 404);
    const members = await this.database.select({
      organizationId: marketingAudienceMembers.organizationId,
      contactId: marketingAudienceMembers.contactId,
      organizationName: organizations.name,
      contactName: sql<string>`btrim(concat_ws(' ', ${contacts.firstName}, ${contacts.lastName}))`,
      email: contacts.email,
      membershipActive: organizationContacts.active,
    }).from(marketingAudienceMembers)
      .innerJoin(organizations, eq(organizations.id, marketingAudienceMembers.organizationId))
      .innerJoin(contacts, eq(contacts.id, marketingAudienceMembers.contactId))
      .leftJoin(organizationContacts, and(
        eq(organizationContacts.organizationId, marketingAudienceMembers.organizationId),
        eq(organizationContacts.contactId, marketingAudienceMembers.contactId),
      ))
      .where(eq(marketingAudienceMembers.audienceId, id))
      .orderBy(asc(organizations.name), asc(contacts.lastName), asc(contacts.firstName));
    return { audience, members };
  }

  async listTemplates() {
    return this.database.select({
      id: communicationTemplates.id, name: communicationTemplates.name, code: communicationTemplates.code,
      templateVersion: communicationTemplates.templateVersion, subjectTemplate: communicationTemplates.subjectTemplate,
      bodyTemplate: communicationTemplates.bodyTemplate, requiredPlaceholders: communicationTemplates.requiredPlaceholders,
    }).from(communicationTemplates).where(and(
      eq(communicationTemplates.state, "active"),
      eq(communicationTemplates.accessScope, "owner"),
      inArray(communicationTemplates.channel, ["email", "internal_email"]),
    )).orderBy(asc(communicationTemplates.name));
  }

  async preflightAudience(audienceId: string) {
    const rows = await this.database.select({
      organizationId: marketingAudienceMembers.organizationId,
      contactId: marketingAudienceMembers.contactId,
      organizationName: organizations.name,
      consolidatedIntoId: organizations.consolidatedIntoId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      email: contacts.email,
      membershipActive: organizationContacts.active,
    }).from(marketingAudienceMembers)
      .leftJoin(organizations, eq(organizations.id, marketingAudienceMembers.organizationId))
      .leftJoin(contacts, eq(contacts.id, marketingAudienceMembers.contactId))
      .leftJoin(organizationContacts, and(
        eq(organizationContacts.organizationId, marketingAudienceMembers.organizationId),
        eq(organizationContacts.contactId, marketingAudienceMembers.contactId),
      )).where(eq(marketingAudienceMembers.audienceId, audienceId));
    const blocks = await this.database.select().from(communicationBlocks).where(eq(communicationBlocks.active, true));
    const recipients: Array<Record<string, string>> = [];
    const excluded: Array<Record<string, string>> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const email = row.email?.trim().toLowerCase() ?? "";
      let reason: string | null =
        !row.organizationName || row.consolidatedIntoId ? "inactive_organization"
        : !row.membershipActive ? "inactive_membership"
        : !email ? "missing_email"
        : !emailPattern.test(email) ? "invalid_email"
        : blocks.some((block) =>
            (block.targetType === "organization" && block.organizationId === row.organizationId)
            || (block.targetType === "contact" && block.contactId === row.contactId)
            || (block.targetType === "recipient_email" && block.normalizedEmail === email)
          ) ? "communication_block"
        : seen.has(email) ? "duplicate_email"
        : null;
      if (reason) {
        excluded.push({ organizationId: row.organizationId, contactId: row.contactId, email, reason });
        continue;
      }
      seen.add(email);
      recipients.push({
        organizationId: row.organizationId, contactId: row.contactId, email,
        organizationName: row.organizationName!,
        contactName: [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ").trim(),
      });
    }
    return { recipients, excluded, totalMembers: rows.length };
  }

  async listCampaigns() {
    return this.database.select({
      campaign: marketingCampaigns,
      audienceName: marketingAudiences.name,
      templateName: communicationTemplates.name,
      recipientCount: sql<number>`(select count(*)::int from marketing_campaign_recipients r where r.campaign_id = ${marketingCampaigns.id} and r.snapshot_revision = ${marketingCampaigns.snapshotRevision})`,
      deliverySentCount: sql<number>`(select count(*)::int from marketing_campaign_deliveries d join marketing_campaign_recipients r on r.id = d.recipient_id where d.campaign_id = ${marketingCampaigns.id} and r.snapshot_revision = ${marketingCampaigns.snapshotRevision} and d.state = 'sent')`,
    }).from(marketingCampaigns).innerJoin(marketingAudiences, eq(marketingAudiences.id, marketingCampaigns.audienceId))
      .innerJoin(communicationTemplates, eq(communicationTemplates.id, marketingCampaigns.templateId))
      .orderBy(sql`${marketingCampaigns.updatedAt} desc`);
  }

  async campaignDetail(id: string) {
    const campaign = await this.getCampaign(id);
    const [counts, events, recipients] = await Promise.all([
      this.database.select({
        recipients: sql<number>`count(*)::int`,
        sent: sql<number>`count(*) filter (where ${marketingCampaignDeliveries.state} = 'sent')::int`,
        failed: sql<number>`count(*) filter (where ${marketingCampaignDeliveries.state} = 'failed')::int`,
      }).from(marketingCampaignRecipients).leftJoin(marketingCampaignDeliveries, eq(marketingCampaignDeliveries.recipientId, marketingCampaignRecipients.id))
        .where(and(eq(marketingCampaignRecipients.campaignId, id), eq(marketingCampaignRecipients.snapshotRevision, campaign.snapshotRevision ?? -1))),
      this.database.select().from(marketingCampaignEvents).where(eq(marketingCampaignEvents.campaignId, id)).orderBy(sql`${marketingCampaignEvents.createdAt} desc`),
      this.database.select().from(marketingCampaignRecipients).where(and(eq(marketingCampaignRecipients.campaignId, id), eq(marketingCampaignRecipients.snapshotRevision, campaign.snapshotRevision ?? -1))),
    ]);
    return { campaign, counts: counts[0] ?? { recipients: 0, sent: 0, failed: 0 }, events, recipients, exclusions: campaign.snapshotExcluded };
  }

  async getCampaign(id: string, lock = false, tx: any = this.database) {
    let query = tx.select().from(marketingCampaigns).where(eq(marketingCampaigns.id, id)).limit(1);
    if (lock) query = query.for("update");
    const [campaign] = await query;
    if (!campaign) throw new MarketingError("NOT_FOUND", 404);
    return campaign as typeof marketingCampaigns.$inferSelect;
  }

  async createCampaign(input: {
    name: string; audienceId: string; templateId: string; senderName: string;
    senderEmail?: string | null; senderPhone?: string | null; extraValues?: Record<string, string | null>;
    subjectTemplate?: string | null; bodyTemplate?: string | null;
  }, actorId: string) {
    const [template] = await this.database.select().from(communicationTemplates).where(and(
      eq(communicationTemplates.id, input.templateId), eq(communicationTemplates.state, "active"),
      eq(communicationTemplates.accessScope, "owner"),
    )).limit(1);
    if (!template) throw new MarketingError("INVALID_TEMPLATE");
    const [row] = await this.database.insert(marketingCampaigns).values({
      name: input.name.trim(), audienceId: input.audienceId, templateId: template.id,
      senderName: input.senderName.trim(), senderEmail: input.senderEmail?.trim() || null,
      senderPhone: input.senderPhone?.trim() || null, extraValues: input.extraValues ?? {}, createdBy: actorId,
      templateVersionSnapshot: template.templateVersion, templateNameSnapshot: template.name,
      subjectTemplateSnapshot: template.subjectTemplate, bodyTemplateSnapshot: template.bodyTemplate,
      subjectTemplate: input.subjectTemplate?.trim() || template.subjectTemplate,
      bodyTemplate: input.bodyTemplate?.trim() || template.bodyTemplate,
      requiredPlaceholdersSnapshot: template.requiredPlaceholders,
    }).returning();
    return row!;
  }

  async updateCampaign(id: string, input: Partial<{
    name: string; audienceId: string; templateId: string; senderName: string; senderEmail: string | null;
    senderPhone: string | null; extraValues: Record<string, string | null>; subjectTemplate: string | null; bodyTemplate: string | null;
  }>) {
    const current = await this.getCampaign(id);
    if (!["draft", "needs_review"].includes(current.state)) throw new MarketingError("INVALID_STATE", 409);
    const set: Record<string, unknown> = { updatedAt: new Date(), state: "draft", approvedAt: null, approvedBy: null };
    for (const key of ["name", "audienceId", "senderName", "senderEmail", "senderPhone", "extraValues", "subjectTemplate", "bodyTemplate"] as const) {
      if (input[key] !== undefined) set[key] = typeof input[key] === "string" ? input[key].trim() : input[key];
    }
    if (input.subjectTemplate === null) set.subjectTemplate = current.subjectTemplateSnapshot;
    if (input.bodyTemplate === null) set.bodyTemplate = current.bodyTemplateSnapshot;
    if (input.audienceId && input.audienceId !== current.audienceId) set.audienceRevision = current.audienceRevision + 1;
    if (input.templateId && input.templateId !== current.templateId) {
      const [template] = await this.database.select().from(communicationTemplates).where(and(
        eq(communicationTemplates.id, input.templateId), eq(communicationTemplates.state, "active"),
        eq(communicationTemplates.accessScope, "owner"),
      )).limit(1);
      if (!template) throw new MarketingError("INVALID_TEMPLATE");
      Object.assign(set, {
        templateId: template.id, templateVersionSnapshot: template.templateVersion, templateNameSnapshot: template.name,
        subjectTemplateSnapshot: template.subjectTemplate, bodyTemplateSnapshot: template.bodyTemplate,
        subjectTemplate: input.subjectTemplate?.trim() || template.subjectTemplate,
        bodyTemplate: input.bodyTemplate?.trim() || template.bodyTemplate,
        requiredPlaceholdersSnapshot: template.requiredPlaceholders,
      });
    }
    const [row] = await this.database.update(marketingCampaigns).set(set).where(eq(marketingCampaigns.id, id)).returning();
    return row!;
  }

  private values(campaign: typeof marketingCampaigns.$inferSelect, recipient: Record<string, string>) {
    return {
      ...campaign.extraValues, contactName: recipient.contactName, eventName: recipient.organizationName,
      senderName: campaign.senderName, senderEmail: campaign.senderEmail, senderPhone: campaign.senderPhone,
    };
  }

  async snapshot(id: string, actorId: string) {
    return this.database.transaction(async (tx) => {
      const campaign = await this.getCampaign(id, true, tx);
      if (!["draft", "needs_review"].includes(campaign.state)) throw new MarketingError("INVALID_STATE", 409);
      const preflight = await this.preflightAudience(campaign.audienceId);
      if (!preflight.recipients.length) throw new MarketingError("NO_ELIGIBLE_RECIPIENTS", 422);
      const revision = campaign.audienceRevision + 1;
      const rendered = preflight.recipients.map((recipient) => ({
        campaignId: id, snapshotRevision: revision, organizationId: recipient.organizationId,
        contactId: recipient.contactId, recipientEmail: recipient.email, organizationName: recipient.organizationName,
        contactName: recipient.contactName,
        subject: renderMarketingCopy(campaign.subjectTemplate ?? "", this.values(campaign, recipient)),
        body: renderMarketingCopy(campaign.bodyTemplate ?? "", this.values(campaign, recipient)),
      }));
      const recipients = await tx.insert(marketingCampaignRecipients).values(rendered).returning({ id: marketingCampaignRecipients.id });
      await tx.insert(marketingCampaignDeliveries).values(recipients.map((recipient) => ({ campaignId: id, recipientId: recipient.id })));
      const now = new Date();
      const [updated] = await tx.update(marketingCampaigns).set({
        state: "needs_review", audienceRevision: revision, snapshotRevision: revision, snapshotConfirmedAt: now,
        snapshotRecipientCount: rendered.length, snapshotExcluded: preflight.excluded,
        requestedReviewBy: actorId, requestedReviewAt: now, updatedAt: now, lastError: null,
      }).where(eq(marketingCampaigns.id, id)).returning();
      await this.record(tx, id, "review_requested", actorId, { recipients: rendered.length, excluded: preflight.excluded });
      return updated!;
    });
  }

  async transition(id: string, from: string[], state: "draft" | "approved" | "scheduled" | "cancelled", actorId: string, extra: Record<string, unknown> = {}) {
    return this.database.transaction(async (tx) => {
      const campaign = await this.getCampaign(id, true, tx);
      if (!from.includes(campaign.state)) throw new MarketingError("INVALID_STATE", 409);
      if (state === "approved" && (campaign.snapshotRevision === null || campaign.snapshotRevision !== campaign.audienceRevision)) {
        throw new MarketingError("AUDIENCE_CONFIRMATION_REQUIRED", 409);
      }
      const now = new Date();
      const set: Record<string, unknown> = { state, updatedAt: now, ...extra };
      if (state === "approved") Object.assign(set, { approvedBy: actorId, approvedAt: now });
      if (state === "cancelled") set.cancelledAt = now;
      const [row] = await tx.update(marketingCampaigns).set(set).where(eq(marketingCampaigns.id, id)).returning();
      await this.record(tx, id, state === "draft" ? "returned_for_changes" : state, actorId, extra);
      return row!;
    });
  }

  async approve(id: string, actorId: string) {
    const campaign = await this.getCampaign(id);
    if (campaign.state !== "needs_review" || campaign.snapshotRevision === null) {
      throw new MarketingError("INVALID_STATE", 409);
    }
    const [current, snapshot] = await Promise.all([
      this.preflightAudience(campaign.audienceId),
      this.database.select({ email: marketingCampaignRecipients.recipientEmail })
        .from(marketingCampaignRecipients)
        .where(and(
          eq(marketingCampaignRecipients.campaignId, id),
          eq(marketingCampaignRecipients.snapshotRevision, campaign.snapshotRevision),
        )),
    ]);
    const currentEmails = current.recipients.map((item) => item.email).sort();
    const snapshotEmails = snapshot.map((item) => item.email).sort();
    if (currentEmails.length !== snapshotEmails.length || currentEmails.some((email, index) => email !== snapshotEmails[index])) {
      throw new MarketingError("AUDIENCE_CHANGED_REVIEW_AGAIN", 409, "Audience eligibility changed; request review again.");
    }
    return this.transition(id, ["needs_review"], "approved", actorId);
  }

  private async snapshotIsCurrent(campaign: typeof marketingCampaigns.$inferSelect) {
    if (campaign.snapshotRevision === null || campaign.snapshotRevision !== campaign.audienceRevision) return false;
    const [current, snapshot] = await Promise.all([
      this.preflightAudience(campaign.audienceId),
      this.database.select({ email: marketingCampaignRecipients.recipientEmail })
        .from(marketingCampaignRecipients)
        .where(and(
          eq(marketingCampaignRecipients.campaignId, campaign.id),
          eq(marketingCampaignRecipients.snapshotRevision, campaign.snapshotRevision),
        )),
    ]);
    const currentEmails = current.recipients.map((item) => item.email).sort();
    const snapshotEmails = snapshot.map((item) => item.email).sort();
    return currentEmails.length === snapshotEmails.length && currentEmails.every((email, index) => email === snapshotEmails[index]);
  }

  async sendTest(id: string, address: string, values: Record<string, string | null> = {}, actorId = "owner") {
    const campaign = await this.getCampaign(id);
    const email = address.trim().toLowerCase();
    if (!emailPattern.test(email)) throw new MarketingError("INVALID_EMAIL");
    const merged = { ...campaign.extraValues, ...values, senderName: campaign.senderName, senderEmail: campaign.senderEmail, senderPhone: campaign.senderPhone };
    const subject = renderMarketingCopy(campaign.subjectTemplate ?? "", merged);
    const body = renderMarketingCopy(campaign.bodyTemplate ?? "", merged);
    try {
      const result = await this.mailFactory().send({ to: email, subject, body });
      await this.database.transaction((tx) => this.record(tx, id, "test_sent", actorId, { recipientEmail: email, messageId: result.messageId }));
      return result;
    } catch (error) {
      throw new MarketingError("DELIVERY_FAILED", 502, safeProviderError(error));
    }
  }

  async send(id: string, actorId: string, allowedState: "approved" | "scheduled" | "failed") {
    const beforeClaim = await this.getCampaign(id);
    if (beforeClaim.state !== allowedState) throw new MarketingError("NOT_APPROVED_OR_CONFIRMED", 409);
    if (!await this.snapshotIsCurrent(beforeClaim)) {
      await this.database.update(marketingCampaigns).set({
        state: "needs_review", approvedAt: null, approvedBy: null,
        scheduledFor: null, updatedAt: new Date(),
      }).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.state, allowedState)));
      throw new MarketingError("AUDIENCE_CHANGED_REVIEW_AGAIN", 409, "Audience eligibility changed; request review again.");
    }
    const [claimedCampaign] = await this.database.update(marketingCampaigns).set({
      state: "sending", sendStartedAt: new Date(), updatedAt: new Date(), lastError: null,
    }).where(and(
      eq(marketingCampaigns.id, id),
      eq(marketingCampaigns.state, allowedState),
      sql`${marketingCampaigns.snapshotRevision} = ${marketingCampaigns.audienceRevision}`,
    )).returning();
    if (!claimedCampaign) throw new MarketingError("NOT_APPROVED_OR_CONFIRMED", 409);
    let mail: MailDelivery;
    try { mail = this.mailFactory(); }
    catch (error) {
      const message = safeProviderError(error);
      await this.database.update(marketingCampaigns).set({ state: "failed", lastError: message, updatedAt: new Date() }).where(eq(marketingCampaigns.id, id));
      throw new MarketingError("DELIVERY_CONFIGURATION", 503, message);
    }
    const deliveries = await this.database.select({
      id: marketingCampaignDeliveries.id, recipientId: marketingCampaignDeliveries.recipientId,
      state: marketingCampaignDeliveries.state,
    }).from(marketingCampaignDeliveries)
      .innerJoin(marketingCampaignRecipients, eq(marketingCampaignRecipients.id, marketingCampaignDeliveries.recipientId))
      .where(and(eq(marketingCampaignDeliveries.campaignId, id), eq(marketingCampaignRecipients.snapshotRevision, claimedCampaign.snapshotRevision!)));
    let failures = 0;
    for (const delivery of deliveries) {
      if (delivery.state === "sent") continue;
      const claimToken = randomUUID();
      const [claim] = await this.database.update(marketingCampaignDeliveries).set({
        state: "sending", claimToken, claimedAt: new Date(), attemptCount: sql`${marketingCampaignDeliveries.attemptCount} + 1`,
        updatedAt: new Date(),
      }).where(and(eq(marketingCampaignDeliveries.id, delivery.id), or(
        inArray(marketingCampaignDeliveries.state, ["pending", "failed"]),
        and(eq(marketingCampaignDeliveries.state, "sending"), lte(marketingCampaignDeliveries.claimedAt, new Date(Date.now() - 15 * 60_000))),
      ))).returning();
      if (!claim) continue;
      const [recipient] = await this.database.select().from(marketingCampaignRecipients).where(eq(marketingCampaignRecipients.id, delivery.recipientId)).limit(1);
      try {
        const result = await mail.send({ to: recipient!.recipientEmail, subject: recipient!.subject, body: recipient!.body });
        await this.database.update(marketingCampaignDeliveries).set({
          state: "sent", providerMessageId: result.messageId, sentAt: new Date(), lastError: null, updatedAt: new Date(),
        }).where(and(eq(marketingCampaignDeliveries.id, delivery.id), eq(marketingCampaignDeliveries.claimToken, claimToken)));
      } catch (error) {
        failures++;
        await this.database.update(marketingCampaignDeliveries).set({
          state: "failed", lastError: safeProviderError(error), updatedAt: new Date(),
        }).where(and(eq(marketingCampaignDeliveries.id, delivery.id), eq(marketingCampaignDeliveries.claimToken, claimToken)));
      }
    }
    const [{ remaining }] = await this.database.select({
      remaining: sql<number>`count(*) filter (where ${marketingCampaignDeliveries.state} <> 'sent')::int`,
    }).from(marketingCampaignDeliveries)
      .innerJoin(marketingCampaignRecipients, eq(marketingCampaignRecipients.id, marketingCampaignDeliveries.recipientId))
      .where(and(
        eq(marketingCampaignDeliveries.campaignId, id),
        eq(marketingCampaignRecipients.snapshotRevision, claimedCampaign.snapshotRevision!),
      ));
    const state = remaining === 0 ? "sent" : "failed";
    const now = new Date();
    await this.database.transaction(async (tx) => {
      await tx.update(marketingCampaigns).set({
        state, sentAt: state === "sent" ? now : null,
        lastError: state === "failed" ? `${remaining} recipient delivery(s) remain.` : null, updatedAt: now,
      }).where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.state, "sending")));
      await this.record(tx, id, state, actorId, { failures, remaining });
    });
    return { state, failures, remaining };
  }

  async dispatchDue(actorId = "system:marketing-scheduler") {
    const due = await this.database.select({ id: marketingCampaigns.id }).from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.state, "scheduled"), lte(marketingCampaigns.scheduledFor, new Date())));
    return Promise.allSettled(due.map((campaign) => this.send(campaign.id, actorId, "scheduled")));
  }

  private async record(tx: any, campaignId: string, eventType: string, actorId: string, details: Record<string, unknown>) {
    await tx.insert(marketingCampaignEvents).values({ campaignId, eventType, actorId, details });
    await tx.insert(auditEntries).values({
      entityType: "marketing_campaign", entityId: campaignId, action: `marketing_campaign_${eventType}`, after: details,
    });
  }
}

/** Entry point for a scheduler/worker; uses the same claiming path as HTTP sends. */
export function dispatchDueMarketingCampaigns(
  database: Database,
  mailFactory?: () => MailDelivery,
) {
  return new MarketingService(database, mailFactory).dispatchDue();
}