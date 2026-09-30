# Recovering a read-only ChatGPT connection

The live owner consent screen showed only `crm:read`, because the client requested only that scope. The server correctly refuses to grant scopes outside the request. Reconnecting and selecting the same checkbox cannot enable writes.

The MCP catalog filtered out unauthorized writes and provided no explicit way for a read-only client to request additional permission. This change adds `request_write_access`, visible to authenticated connections. It declares OAuth scope metadata and returns the documented `mcp/www_authenticate` insufficient-scope challenge for `crm:read crm:append drafts:write followups:write`. It does not request `crm:update`.

The action never writes records, changes grants, sends messages, calls app AI, or revokes existing access. Existing write actions remain filtered and scope-enforced until the owner completes consent. An already authorized connection gets a confirmation instead of another challenge. SDK v2 tool descriptors carry the compatibility `securitySchemes` declaration in `_meta`.

## Deployment verification

Local verification: 45 connector/backend tests passed, one existing PostgreSQL concurrency test skipped; API production build passed. The new protocol tests were observed failing before implementation and passing afterward. The first broad run had nine fixture/test timeouts under parallel PGlite startup; all passed with `--no-file-parallelism` and unchanged timeout thresholds. This is not a whole-repository test claim.

1. Deploy the change and refresh the plugin tools in ChatGPT.
2. In a fresh Work task using the installed Command Center plugin, explicitly invoke `request_write_access`. Do not create test customer records or send messages.
3. Confirm that ChatGPT starts authorization with the four advertised scopes and that the owner sees the additional checkboxes. Obtain owner approval for the expanded access. Do not manually broaden the provider's accepted scopes to bypass a client requesting only read access.
4. Confirm the granted scopes in Command Center and refresh plugin tools. Verify that sourced lead creation, note append, app draft saves and follow-up saves are exposed.
5. Update Com's read-only instruction only after the grant is verified. Require source verification, duplicate checks and operation receipts for user-requested saves. Sending still requires separate explicit authorization and is not supported by this connector.

This is a protocol-level fix, not proof that the live ChatGPT host has completed reauthorization. Existing PostgreSQL multi-client and physical-device release gates remain unchanged.
