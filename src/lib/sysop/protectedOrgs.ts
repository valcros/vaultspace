/**
 * Organizations that platform operators must never disable or delete.
 *
 * These are the three real tenants. The structural classifier (0 rooms AND <=1
 * user) already excludes them from bulk cleanup, but this explicit list is a
 * second, independent guard enforced at EVERY mutation boundary (single PATCH
 * disable AND bulk-disable). Resolved to immutable org IDs at request time; slugs
 * are normalized (^[a-z0-9-]+$) and effectively immutable.
 *
 * NOTE: two of these orgs exist only in production (not in seed/test fixtures),
 * so tests assert exclusion via the structural classifier + this list, and the
 * runtime resolution simply excludes whichever slugs are present.
 */
export const PROTECTED_ORG_SLUGS = ['brightside', 'series-a-funding', 'org-1774897343302-qzig5'];
