# Leg planning onboarding

The app feature and a ready operating season are separate outcomes. This change creates no live workers, equipment, approvals or assignments. Enable `LEG_PLANNING_ENABLED=true` only after applying the additive migration and checking the required schema; startup fails closed if required constraints or writer guards are missing. Keep the existing outreach setting independent.

## Set up the actual season

1. In Routes, choose the intended season explicitly. Review the nine current planning slots: Dave, Hulk, Kristy, Mikey, Angel, Jeremy (tentative), and three unfilled. Record confirmed, tentative or unfilled leadership and the actual responsible manager. Angel and archived Angelo remain separate; Jeremy must not be substituted with archived JR. Exclude Mouth from current assignments while retaining history.
2. Use existing crew editors to maintain actual workers and leg membership. Record sourced, dated availability separately from previous work or rehire eligibility. Confirm the full working interval; unavailable evidence overrides overlapping confirmed availability.
3. In package/resource settings, describe each complete physical set using actual resource IDs and explicit category/count requirements. Record who verified composition and the source. Unconfigured or unverified sets cannot support a verified plan. Two names for the same physical item do not create two items.
4. Configure normal inventory for at most five Adventure Zone, three Pirates and one Warrior setup at the same time. An actual sixth Adventure Zone or fourth Pirates set is extra inventory, requires additional disjoint equipment/staffing and Dave's dated approval. No second simultaneous Warrior setup is allowed.
5. Bind Dave authority in settings to Dave's actual enabled boss account. A display name or an office note about a conversation does not authorize a decision. Dave submits extra-set decisions through his authenticated view. Disabling or rebinding that authority requires fresh review.
6. Record the leg's actual base location and transport defaults. Managers can select only office-assigned equipment/transport and current membership workers; the office must assign those real resources first. A pool is not transport. Transport categories must explicitly identify a vehicle, truck, van, bus, trailer, camper, RV or transport resource.

## Use it for every event

Open the event's operating plan from its booking/profile, schedule or map. Keep the selected booking, leg and season together. Historical ambiguous records remain visible; resolve their dates deliberately in the operating proposal without silently rewriting source history.

Enter the full working/reserved interval with its source and date meaning, the actual minimum crew and role requirements, and each worker's role, shift and confirmation. There is no automatic staffing minimum. Select actual verified package sets and transport. Record sourced lodging with dates and capacity, or explicitly explain why lodging is unnecessary. Unknown accommodation remains incomplete.

Save an incomplete draft whenever needed. Drafts reserve nothing. After saving current locations and transport, review travel against the current endpoints and available transfer time. Changing material facts can require a fresh travel review or approval.

Read each server readiness dimension: crew, equipment, dates/travel, accommodation and approvals. A completed task or a confirmed customer booking does not make the operating plan verified. Follow the missing-fact links, reread after a revision conflict, and deliberately reconcile preserved unsaved edits.

For a split, select the exact two events on the same parent leg and season, then finish both branch drafts. Prefer Adventure Zone plus a smaller Pirates or Warrior event. Dave or that exact leg's authenticated manager reviews the two-site plan. Two Adventure Zone branches require explicit strategic acknowledgement and enough separate actual staff/equipment for both. A split approval does not approve an extra set. Request any Dave-only extra-set approval separately.

Commit only after current server checks permit it. Both split branches commit atomically with their exact revisions. Commitment updates the canonical operating assignment and reservations; it does not change commercial status or send a message. Neighboring plans refresh and may become conflicted when facts change.

## Daily handoff

Use the schedule/map to open the selected event plan and its contextual manager view. Check the displayed evaluation time and current evidence before booking more events. Managers maintain their own staffing/availability and view scoped conflicts; the office maintains shared inventory and Dave's account binding. Customer messages still go to Desiree for review and an explicit instruction to send.

Before release, obtain green disposable-PostgreSQL concurrency checks and verify the editor, leg cards and decision views at 360px, 768px and desktop widths. The implementation's local visual preview was blocked, so component tests alone do not establish those visual results.
