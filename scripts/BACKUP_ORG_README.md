# Per-Tenant Backup & Restore (Sprint 3)

Back up and restore a SINGLE organization independently — the safety net before
an irreversible hard-purge, and the way to recover a real tenant if a purge ever
goes wrong.

## ⚠️ VALIDATE BEFORE YOU TRUST IT

This tool was built and unit-tested (completeness drift guard + crypto envelope),
but its correctness as a safety net **cannot be certified without a live-DB
round-trip**, which the author could not run. **Do NOT authorize any real
hard-purge (e.g. of the ~278 junk orgs) until the round-trip below passes on a
throwaway org against a live, production-equivalent database + object store.**

### Required round-trip (run on a disposable org, live DB clone)

1. Pick/create a throwaway org with rooms, docs, members, Q&A, etc.
2. Disable it (SysOp) so it is quiescent.
3. `BACKUP_ENCRYPTION_KEY=<32-byte base64> npm run ops:backup-org -- --org <slug>`
4. Record its full state (row counts per table, document bytes/checksums).
5. Hard-delete the org from the DB + storage (the purge you're validating).
6. `BACKUP_ENCRYPTION_KEY=<same key> npm run ops:restore-org -- --file <backup-dir>`
7. **Byte-for-byte verify**: every table's row count matches, every document
   opens with the same checksum, Q&A/messages/permissions/memberships intact,
   shared users not clobbered (their current password/2FA unchanged).
8. Only after a clean pass: the backup is trustworthy for real purges.

## Usage

```
# Back up (org should be DISABLED first; refuses an active org without --allow-active)
BACKUP_ENCRYPTION_KEY=<32-byte base64> npm run ops:backup-org -- --org <slug|id> [--out <dir>]

# Restore (into a system where the org is ABSENT — e.g. after purge)
BACKUP_ENCRYPTION_KEY=<same key> npm run ops:restore-org -- --file <backup-dir>
```

## Safety properties (built in, from the review gate)

- **Completeness, fail-closed.** The table set is derived from the Prisma schema
  with a drift guard (`src/lib/backup/tenantModelClassification.ts`): a new,
  unclassified org-scoped model **aborts the backup** rather than being silently
  dropped. Unit-tested against the live DMMF.
- **Explicit org scoping.** Every table is read with `WHERE organizationId` (not
  trusting RLS, whose coverage is split), inside a REPEATABLE READ snapshot with
  the org GUCs set so RLS-enforced tables are readable.
- **Shared users never clobbered.** Referenced users are collected from every
  `*UserId` and restored create-if-absent (empty update) — a user in Brightside
  AND Series A keeps their current credentials.
- **No global delete, ever.** Unlike `scripts/restore.ts` (whole-system wipe),
  `restore-org.ts` is strictly org-scoped and refuses to run over an existing org
  (id/slug/customDomain collision) — it cannot wipe the real tenants.
- **Storage from DB rows.** Blobs are copied via the storage provider `get()`/`put()`
  keyed by `FileBlob`/`PreviewAsset` rows (works on Azure/S3, not just local) —
  guarantees DB↔storage correspondence.
- **Authenticated encryption.** AES-256-GCM envelope: per-archive DEK wrapped by a
  KEK. ⚠️ PROD: wrap the DEK via KMS/Key Vault, not an env-held `BACKUP_ENCRYPTION_KEY`.

## Known limits / follow-ups (see code comments)

- The live-DB round-trip (above) is the real acceptance test — not yet run.
- KEK should move to KMS/Key Vault for production.
- Cross-system / cross-schema-version migration is out of scope (same-system
  purge-recovery only); restore checks schema version in the manifest.
- `--force` (restore over an existing org) is intentionally narrow and still never
  touches other orgs' rows; prefer restoring into an absent org.
