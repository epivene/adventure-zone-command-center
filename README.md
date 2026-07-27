# Adventure Zone Command Center

A private booking, routing, contact, and follow-up workspace for Adventure
Zone. The app uses Next.js, PostgreSQL, Clerk owner authentication, MapLibre,
and a manually triggered Act! Premium Cloud contact sync.

## Local development

Install dependencies, copy `.env.example` to an untracked `.env.local`, fill
only the values needed for local work, then run:

```bash
npm ci
npx drizzle-kit migrate
npm run db:seed
npm run dev
```

Never commit database, Clerk, Act!, or backup credentials. The Act! variables
are server-only and must not use a `NEXT_PUBLIC_` prefix.

## Operations

- [Deployment and release](docs/operations/deployment.md)
- [Act! contact sync](docs/operations/act-sync.md)
- [Act! CSV import fallback](docs/operations/act-import.md)
- [Backup and restore](docs/operations/backup-and-restore.md)

The Act! sync is always manual: **Sync with Act!** creates a stored preview,
and a separate **Apply approved** action performs only the decisions selected
by the owner.
