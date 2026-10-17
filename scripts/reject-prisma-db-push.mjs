#!/usr/bin/env node

process.stderr.write(
  'Schema-only Prisma db push is unsupported: AI chunk search uses a stored generated column.\n' +
    'Set MIGRATION_DATABASE_URL and run npm run db:migrate to apply the versioned SQL migrations.\n'
);
process.exit(1);
