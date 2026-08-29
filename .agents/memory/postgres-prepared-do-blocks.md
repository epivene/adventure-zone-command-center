---
name: PostgreSQL prepared DO blocks
description: Parameter handling for optional-table logic in Drizzle transactions.
---

Prepared-statement parameters are not available inside a PostgreSQL dollar-quoted `DO` block. Use a schema-presence query followed by ordinary parameterized statements when optional tables need guarded updates.

**Why:** The PostgreSQL extended query protocol binds parameters to the outer statement, while PL/pgSQL code inside `DO` is parsed independently; `$1`-style placeholders therefore fail at runtime even when the same literal SQL works in `psql`.

**How to apply:** Avoid interpolating application values inside `DO` bodies used by Drizzle/node-postgres. Query `information_schema` or `to_regclass` first, then execute one normal parameterized update per optional table.