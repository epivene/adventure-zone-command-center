---
name: Navigation progressive disclosure
description: Desktop and mobile navigation intentionally use different disclosure levels while sharing the same route inventory.
---

Keep frequent Booking destinations in the desktop primary bar, expose secondary Booking tools through a nested overflow submenu, and keep the mobile overflow list compact and backward-compatible.

**Why:** Desktop users need a calm first-level header without losing access to legacy routes, while mobile users depend on the existing bottom-navigation and overflow behavior.

**How to apply:** When adding a navigation destination, decide separately whether it belongs in the desktop core list, a desktop submenu, or the mobile overflow; avoid rendering the same Booking route in both desktop core and desktop tools.

For CRM profiles, grouped destinations are a presentation layer only: preserve existing section keys and role-specific access.

**Why:** Profile links and panels depend on those section-specific values even when several sections share one visible destination.

**How to apply:** Map grouped profile controls to the existing section values and keep role-specific panels gated as before.