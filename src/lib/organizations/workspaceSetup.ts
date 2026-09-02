/**
 * Self-service workspace setup contract.
 *
 * Email verification must create an organization atomically, before a user can
 * choose a public-facing URL. New organizations therefore receive a
 * recognizable provisional slug which may be claimed exactly once while the
 * starter room remains untouched and private.
 */

export const INITIAL_SELF_SERVICE_ROOM_NAME = 'My First Data Room';
export const INITIAL_SELF_SERVICE_ROOM_SLUG = 'my-first-data-room';

const PROVISIONAL_SLUG = /^org-\d{10,16}-[a-z0-9]{5}$/;
const WORKSPACE_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

export const RESERVED_WORKSPACE_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'dev',
  'help',
  'local',
  'mail',
  'prod',
  'production',
  'staging',
  'status',
  'support',
  'sysop',
  'test',
  'vaultspace',
  'www',
]);

export function isProvisionalWorkspaceSlug(slug: string): boolean {
  return PROVISIONAL_SLUG.test(slug);
}

export function normalizeWorkspaceSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isClaimableWorkspaceSlug(slug: string): boolean {
  return WORKSPACE_SLUG.test(slug) && !RESERVED_WORKSPACE_SLUGS.has(slug);
}

export function suggestWorkspaceSlug(organizationName: string): string {
  const normalized = organizationName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const truncated = normalized.slice(0, 63).replace(/-+$/g, '');
  const candidate = truncated.length >= 3 ? truncated : 'my-workspace';
  return RESERVED_WORKSPACE_SLUGS.has(candidate) ? `${candidate}-workspace` : candidate;
}
