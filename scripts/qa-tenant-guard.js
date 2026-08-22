/**
 * Guards write-capable deployed QA smoke scripts from proceeding against an
 * arbitrary organization. The smoke scripts authenticate first because the
 * login response is the authoritative source of the active organization; no
 * room, document, link, export, or invitation mutation may happen before this
 * check passes.
 */

const BRIGHTSIDE_SLUG = 'brightside';

function getExpectedQaOrganizationSlug(environment = process.env) {
  const expected = environment['QA_EXPECTED_ORGANIZATION_SLUG']?.trim().toLowerCase();

  if (!expected) {
    throw new Error(
      'QA_EXPECTED_ORGANIZATION_SLUG is required before running a write-capable QA smoke test'
    );
  }

  if (expected === BRIGHTSIDE_SLUG) {
    throw new Error('QA smoke tests must not target the Brightside organization');
  }

  return expected;
}

function assertQaTenant(organization, environment = process.env) {
  const expected = getExpectedQaOrganizationSlug(environment);
  const actual = organization?.slug?.trim().toLowerCase();

  if (!actual) {
    throw new Error(
      'Login response did not include an organization slug for QA tenant verification'
    );
  }

  if (actual === BRIGHTSIDE_SLUG || actual !== expected) {
    throw new Error('Authenticated organization does not match the approved QA tenant');
  }

  return actual;
}

function maskEmail(value) {
  if (!value || !value.includes('@')) {
    return '(not set)';
  }

  const [local, domain] = value.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

module.exports = {
  assertQaTenant,
  getExpectedQaOrganizationSlug,
  maskEmail,
};
