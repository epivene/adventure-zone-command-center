---
name: Organization consolidation
description: Durable decisions for the consolidation workflow  retired-org detection, redirect accuracy, trigger constraints, and test setup.
---

# Organization consolidation

## Redirect accuracy
`organization_locations.consolidation_source_org_id` (nullable UUID, FK ’ organizations) identifies which retired source org produced each location. `getConsolidationRedirect` queries by `(organization_id = canonical, consolidation_source_org_id = retired_org_id)`  do NOT rely on label-matching or first-row order.

**Why:** Multiple source orgs may consolidate into the same canonical org, so the first-location heuristic returns the wrong redirect target for all but one source.

## Contact FK ordering
`contacts_primary_organization_contact_fk` enforces `(contacts.organization_id, contacts.id)` ’ `(organization_contacts.organization_id, organization_contacts.contact_id)`. When creating a contact in tests or consolidation code, `contacts.organization_id` can only be set after the `organization_contacts` row exists. Order: insert contact with `organizationId = null` ’ insert organizationContacts ’ update contacts.organization_id.

## Trigger constraint
A trigger checks that if both `organization_id` and `organization_location_id` are set on contacts/bookings/activities, the location must belong to that org. Update both fields in the same SQL statement, never in two separate statements.

## Retired-org exclusion
Both `duplicateOrganizationGroupsQuery` (raw SQL) and `buildOrganizationListCondition` (drizzle) already filter `consolidated_into_id IS NULL`. If new list/search queries are added, they must include the same filter.
