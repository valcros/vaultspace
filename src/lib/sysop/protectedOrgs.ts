/**
 * Protected organizations are deployment-specific operational data, not public
 * application configuration. The list is injected through a secret-backed
 * runtime variable and is intentionally never logged or given a source fallback.
 *
 * SysOp destructive operations call this resolver immediately before querying
 * the protected organizations. If the setting is missing or malformed, those
 * operations fail closed instead of silently treating every organization as
 * disposable.
 */
const ENVIRONMENT_VARIABLE = 'PLATFORM_PROTECTED_ORG_SLUGS';
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ProtectedOrganizationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectedOrganizationConfigurationError';
  }
}

export function getProtectedOrganizationSlugs(
  rawValue: string | undefined = process.env[ENVIRONMENT_VARIABLE]
): string[] {
  if (!rawValue?.trim()) {
    throw new ProtectedOrganizationConfigurationError(
      `${ENVIRONMENT_VARIABLE} must be configured before organization disable operations are available.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new ProtectedOrganizationConfigurationError(
      `${ENVIRONMENT_VARIABLE} must be a JSON array of normalized organization slugs.`
    );
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((value) => typeof value === 'string')
  ) {
    throw new ProtectedOrganizationConfigurationError(
      `${ENVIRONMENT_VARIABLE} must be a non-empty JSON array of normalized organization slugs.`
    );
  }

  const slugs = parsed.map((value) => value.trim());
  if (slugs.some((slug) => !SLUG_PATTERN.test(slug)) || new Set(slugs).size !== slugs.length) {
    throw new ProtectedOrganizationConfigurationError(
      `${ENVIRONMENT_VARIABLE} contains an invalid or duplicate organization slug.`
    );
  }

  return slugs;
}
