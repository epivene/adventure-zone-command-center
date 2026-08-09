import type { ActReplacementStreamType } from "./import-types";

type ParentStream = "company" | "opportunity" | "activity" | "group" | "note" | "history";
type ChildStream = "company" | "contact" | "opportunity" | "activity" | "group" | "note" | "history";

export type ActSourceIdentity = {
  sourceRecordId: string;
  streamType: ActReplacementStreamType | string;
  actRecordId?: string | null;
  sourceKey?: string | null;
};

export type ActRelationshipEvidence = {
  parentStream: ParentStream;
  childStream: ChildStream;
  parentSourceRecordId: string | null;
  parentActRecordId: string | null;
  childSourceRecordId: string | null;
  childActRecordId: string | null;
  evidenceKind: "relationship_record" | "inline" | "external_link";
  relationshipSlot?: string | null;
  sourceRecordId?: string | null;
  sourceVersionId?: string | null;
};

export type ActSourceAssignmentEvidence = {
  sourceRecordId: string;
  targetEntityType: "organization" | "contact" | "booking" | "calling_list" | "activity" | string;
  targetEntityId: string;
  /** When local entity IDs differ from archived source IDs, callers provide this exact source identity. */
  targetSourceRecordId?: string | null;
  manualAuthority?: boolean;
  active?: boolean;
  role?: string;
};

export type ActExternalLinkEvidence = {
  sourceRecordId: string;
  targetSourceRecordId: string;
  targetEntityType: "organization" | "contact" | "booking" | "calling_list" | "activity" | string;
};

export type MatcherSuggestion = {
  sourceRecordId: string;
  targetType: string;
  candidateSourceRecordIds: readonly string[];
};

export type ActSourceGraph = {
  companiesByContact: ReadonlyMap<string, ReadonlySet<string>>;
  companiesByOpportunity: ReadonlyMap<string, ReadonlySet<string>>;
  contactsByOpportunity: ReadonlyMap<string, ReadonlySet<string>>;
  contactsByGroup: ReadonlyMap<string, ReadonlySet<string>>;
  timelineParents: ReadonlyMap<string, {
    companyIds: ReadonlySet<string>;
    contactIds: ReadonlySet<string>;
    opportunityIds: ReadonlySet<string>;
  }>;
};

export type RelationshipDiagnostic = {
  code: "unresolved_exact_relationship" | "source_relationship_conflict" | "manual_assignment_source_conflict";
  sourceRecordId: string;
  parentStream?: string;
  childStream?: string;
  evidenceKind?: string;
  context: Record<string, string>;
};

export type RelationshipResolutionInput = {
  records: readonly ActSourceIdentity[];
  relationships?: readonly ActRelationshipEvidence[];
  assignments?: readonly ActSourceAssignmentEvidence[];
  externalLinks?: readonly ActExternalLinkEvidence[];
  matcherSuggestions?: readonly MatcherSuggestion[];
};

export type RelationshipResolution = {
  graph: ActSourceGraph;
  conflicts: readonly RelationshipDiagnostic[];
  unresolved: readonly RelationshipDiagnostic[];
  suggestions: readonly MatcherSuggestion[];
  provenance: ReadonlyMap<string, readonly string[]>;
};

const validParent = new Set(["company", "opportunity", "activity"]);

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sortedSetMap(input: Map<string, Set<string>>): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map([...input.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, new Set([...values].sort())]));
}

function add(map: Map<string, Set<string>>, key: string, value: string) {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

/** Resolve only source identities and explicit evidence. Text/body/name matching belongs in review. */
export function resolveActSourceGraph(input: RelationshipResolutionInput): RelationshipResolution {
  const bySource = new Map(input.records.map((record) => [record.sourceRecordId, record]));
  const byAct = new Map<string, string[]>();
  for (const record of input.records) {
    const id = clean(record.actRecordId);
    if (!id) continue;
    const key = `${record.streamType}:${id}`;
    const values = byAct.get(key) ?? [];
    values.push(record.sourceRecordId);
    byAct.set(key, values);
  }
  for (const ids of byAct.values()) ids.sort();

  const companiesByContact = new Map<string, Set<string>>();
  const companiesByOpportunity = new Map<string, Set<string>>();
  const contactsByOpportunity = new Map<string, Set<string>>();
  const contactsByGroup = new Map<string, Set<string>>();
  const timeline = new Map<string, { companyIds: Set<string>; contactIds: Set<string>; opportunityIds: Set<string> }>();
  const conflicts: RelationshipDiagnostic[] = [];
  const unresolved: RelationshipDiagnostic[] = [];
  const provenance = new Map<string, string[]>();

  const resolve = (sourceId: string | null, actId: string | null, stream: string): string | null => {
    const direct = clean(sourceId);
    if (direct && bySource.get(direct)?.streamType === stream) return direct;
    const id = clean(actId);
    if (!id) return null;
    const candidates = byAct.get(`${stream}:${id}`) ?? [];
    return candidates.length === 1 ? candidates[0] : null;
  };

  const manual = new Map<string, Set<string>>();
  const targetStreamForType = new Map([["organization", "company"], ["contact", "contact"], ["booking", "opportunity"], ["calling_list", "group"], ["activity", "activity"]]);
  for (const assignment of input.assignments ?? []) {
    if (assignment.active === false || assignment.manualAuthority === false) continue;
    const target = clean(assignment.targetSourceRecordId) ?? clean(assignment.targetEntityId);
    if (!target || !bySource.has(target) || bySource.get(target)?.streamType !== targetStreamForType.get(assignment.targetEntityType)) continue;
    const values = manual.get(`${assignment.sourceRecordId}:${assignment.targetEntityType}`) ?? new Set<string>();
    values.add(target);
    manual.set(`${assignment.sourceRecordId}:${assignment.targetEntityType}`, values);
  }

  const sourceEdges = new Map<string, Set<string>>();
  const parentEdges = new Map<string, Set<string>>();
  const slotTargets = new Map<string, string>();
  for (const relation of input.relationships ?? []) {
    const directParent = clean(relation.parentSourceRecordId) && bySource.has(clean(relation.parentSourceRecordId)!) ? clean(relation.parentSourceRecordId) : null;
    const actParentCandidates = clean(relation.parentActRecordId) ? (byAct.get(`${relation.parentStream}:${clean(relation.parentActRecordId)}`) ?? []) : [];
    const directChild = clean(relation.childSourceRecordId) && bySource.has(clean(relation.childSourceRecordId)!) ? clean(relation.childSourceRecordId) : null;
    const actChildCandidates = clean(relation.childActRecordId) ? (byAct.get(`${relation.childStream}:${clean(relation.childActRecordId)}`) ?? []) : [];
    if (directParent && actParentCandidates.length === 1 && directParent !== actParentCandidates[0]) {
      conflicts.push({ code: "source_relationship_conflict", sourceRecordId: directChild ?? directParent ?? clean(relation.sourceRecordId) ?? "unknown", parentStream: relation.parentStream, childStream: relation.childStream, evidenceKind: relation.evidenceKind, context: { reason: "parent_identity_disagrees" } });
    }
    if (directChild && actChildCandidates.length === 1 && directChild !== actChildCandidates[0]) {
      conflicts.push({ code: "source_relationship_conflict", sourceRecordId: directChild ?? directParent ?? clean(relation.sourceRecordId) ?? "unknown", parentStream: relation.parentStream, childStream: relation.childStream, evidenceKind: relation.evidenceKind, context: { reason: "child_identity_disagrees" } });
    }
    const parent = resolve(relation.parentSourceRecordId, relation.parentActRecordId, relation.parentStream);
    const child = resolve(relation.childSourceRecordId, relation.childActRecordId, relation.childStream);
    const diagnosticSource = child ?? parent ?? clean(relation.sourceRecordId) ?? "unknown";
    if (!parent || !child) {
      unresolved.push({
        code: "unresolved_exact_relationship",
        sourceRecordId: diagnosticSource,
        parentStream: relation.parentStream,
        childStream: relation.childStream,
        evidenceKind: relation.evidenceKind,
        context: {
          reason: "identity_not_found",
          relationshipSlot: clean(relation.relationshipSlot) ?? clean(relation.sourceRecordId) ?? `${relation.parentStream}:${relation.childStream}:${relation.evidenceKind}`,
        },
      });
      continue;
    }
    if (relation.relationshipSlot) {
      const slotKey = `${child}:${relation.childStream}:${relation.relationshipSlot}`;
      const priorTarget = slotTargets.get(slotKey);
      if (priorTarget && priorTarget !== parent) {
        conflicts.push({ code: "source_relationship_conflict", sourceRecordId: child, parentStream: relation.parentStream, childStream: relation.childStream, evidenceKind: relation.evidenceKind, context: { relationshipSlot: relation.relationshipSlot, firstTarget: priorTarget, secondTarget: parent } });
      } else {
        slotTargets.set(slotKey, parent);
      }
    }
    const key = `${child}:${relation.parentStream}`;
    const values = sourceEdges.get(key) ?? new Set<string>();
    values.add(parent);
    sourceEdges.set(key, values);
    const parentKey = `${parent}:${relation.childStream}`;
    const children = parentEdges.get(parentKey) ?? new Set<string>();
    children.add(child);
    parentEdges.set(parentKey, children);
    const evidence = `${relation.evidenceKind}:${relation.parentStream}:${relation.childStream}`;
    const prior = provenance.get(`${child}:${parent}`) ?? [];
    if (!prior.includes(evidence)) prior.push(evidence);
    provenance.set(`${child}:${parent}`, prior.sort());
  }

  const linked = (child: string, parentStream: string): Set<string> => {
    const exact = new Set([
      ...(sourceEdges.get(`${child}:${parentStream}`) ?? []),
      ...(parentEdges.get(`${child}:${parentStream}`) ?? []),
    ]);
    const manualTargets = manual.get(`${child}:${parentStream === "company" ? "organization" : parentStream}`) ?? new Set<string>();
    if (manualTargets.size) {
      for (const target of exact) if (!manualTargets.has(target)) conflicts.push({ code: "manual_assignment_source_conflict", sourceRecordId: child, parentStream, context: { manualTarget: [...manualTargets].sort().join(","), sourceTarget: target } });
      return new Set(manualTargets);
    }
    return new Set(exact);
  };

  const reportManualSourceConflict = (sourceRecordId: string, parentStream: string, sourceTargets: ReadonlySet<string>, manualTargets: ReadonlySet<string>) => {
    for (const target of sourceTargets) if (!manualTargets.has(target)) conflicts.push({ code: "manual_assignment_source_conflict", sourceRecordId, parentStream, context: { manualTarget: [...manualTargets].sort().join(","), sourceTarget: target } });
  };

  for (const [key, targets] of sourceEdges) {
    if (targets.size > 1 && key.includes(":activity")) {
      // Multiple activity associations are valid; do not turn them into a false conflict.
      continue;
    }
  }

  const external = input.externalLinks ?? [];
  for (const link of external) {
    const target = clean(link.targetSourceRecordId);
    if (!target || !bySource.has(target)) continue;
    const key = `${link.sourceRecordId}:${link.targetEntityType === "organization" ? "company" : link.targetEntityType}`;
    const values = sourceEdges.get(key) ?? new Set<string>();
    values.add(target);
    sourceEdges.set(key, values);
    const sourceRecord = bySource.get(link.sourceRecordId);
    if (sourceRecord && (sourceRecord.streamType === "opportunity" || sourceRecord.streamType === "group")) {
      const parentKey = `${link.sourceRecordId}:${link.targetEntityType === "organization" ? "company" : link.targetEntityType}`;
      const children = parentEdges.get(parentKey) ?? new Set<string>();
      children.add(target);
      parentEdges.set(parentKey, children);
    }
    const prior = provenance.get(`${link.sourceRecordId}:${target}`) ?? [];
    if (!prior.includes("external_link")) prior.push("external_link");
    provenance.set(`${link.sourceRecordId}:${target}`, prior.sort());
  }

  // External links are exact evidence and are resolved below with the same authority rules.
  for (const record of input.records) {
    const id = record.sourceRecordId;
    if (record.streamType === "contact") for (const company of linked(id, "company")) add(companiesByContact, id, company);
    if (record.streamType === "opportunity") {
      // Relationship records are represented as opportunity -> company/contact.
      const manualCompanies = manual.get(`${id}:organization`);
      const manualContacts = manual.get(`${id}:contact`);
      const sourceCompanies = linked(id, "company");
      const sourceContacts = linked(id, "contact");
      if (manualCompanies?.size) reportManualSourceConflict(id, "company", sourceCompanies, manualCompanies);
      if (manualContacts?.size) reportManualSourceConflict(id, "contact", sourceContacts, manualContacts);
      for (const company of manualCompanies?.size ? manualCompanies : sourceCompanies) add(companiesByOpportunity, id, company);
      for (const contact of manualContacts?.size ? manualContacts : sourceContacts) add(contactsByOpportunity, id, contact);
    }
    if (record.streamType === "group") {
      const manualContacts = manual.get(`${id}:contact`);
      const sourceContacts = linked(id, "contact");
      if (manualContacts?.size) reportManualSourceConflict(id, "contact", sourceContacts, manualContacts);
      for (const contact of manualContacts?.size ? manualContacts : sourceContacts) add(contactsByGroup, id, contact);
    }
    if (["activity", "note", "history"].includes(record.streamType)) {
      const parents = { companyIds: new Set<string>(), contactIds: new Set<string>(), opportunityIds: new Set<string>() };
      const manualCompanies = manual.get(`${id}:organization`);
      const manualContacts = manual.get(`${id}:contact`);
      const manualOpportunities = manual.get(`${id}:booking`);
      const sourceCompanies = linked(id, "company");
      const sourceContacts = linked(id, "contact");
      const sourceOpportunities = linked(id, "opportunity");
      if (manualCompanies?.size) reportManualSourceConflict(id, "company", sourceCompanies, manualCompanies);
      if (manualContacts?.size) reportManualSourceConflict(id, "contact", sourceContacts, manualContacts);
      if (manualOpportunities?.size) reportManualSourceConflict(id, "opportunity", sourceOpportunities, manualOpportunities);
      for (const company of manualCompanies?.size ? manualCompanies : sourceCompanies) parents.companyIds.add(company);
      for (const contact of manualContacts?.size ? manualContacts : sourceContacts) parents.contactIds.add(contact);
      for (const opportunity of manualOpportunities?.size ? manualOpportunities : sourceOpportunities) parents.opportunityIds.add(opportunity);
      if (parents.companyIds.size || parents.contactIds.size || parents.opportunityIds.size) timeline.set(id, parents);
    }
  }

  const suggestions = [...(input.matcherSuggestions ?? [])].map((suggestion) => ({ ...suggestion, candidateSourceRecordIds: [...new Set(suggestion.candidateSourceRecordIds)].sort() })).sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId) || a.targetType.localeCompare(b.targetType));
  return {
    graph: {
      companiesByContact: sortedSetMap(companiesByContact),
      companiesByOpportunity: sortedSetMap(companiesByOpportunity),
      contactsByOpportunity: sortedSetMap(contactsByOpportunity),
      contactsByGroup: sortedSetMap(contactsByGroup),
      timelineParents: new Map([...timeline.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { companyIds: new Set([...value.companyIds].sort()), contactIds: new Set([...value.contactIds].sort()), opportunityIds: new Set([...value.opportunityIds].sort()) }])),
    },
    conflicts: conflicts.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId) || a.code.localeCompare(b.code)),
    unresolved: unresolved.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)),
    suggestions,
    provenance: new Map([...provenance.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, [...values].sort()])),
  };
}

export const resolveSourceGraph = resolveActSourceGraph;
