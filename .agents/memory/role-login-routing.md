---
name: Role login routing boundary
description: Auth middleware ordering rule for owner, Office Coordinator, Leg Manager, and development demo routes.
---

# Role login routing boundary

Office, Manager, health, and development-only demo routes must remain ahead of the owner-only router boundary. Owner middleware mounted at `/api` must not be paired with a narrow feature router, because Express runs the middleware before deciding whether that router contains a matching endpoint.

**Why:** A broadly mounted owner guard once caused every role-specific login and demo-discovery request to return 401, even though those routers were correctly ordered before the owner boundary internally.

**How to apply:** Scope standalone owner guards to their exact endpoint prefix. Let the main API router enforce its existing internal owner boundary for the remaining CRM routes.