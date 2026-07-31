import type { EmailProviderName } from './errors';

export interface EmailProviderConfiguration {
  name: Exclude<EmailProviderName, 'unknown'>;
  deliverable: boolean;
  errorCode: 'ACS_CONNECTION_STRING_MISSING' | 'SMTP_HOST_MISSING' | 'UNKNOWN_PROVIDER' | null;
}

/** Resolve provider selection once from the same rules used by capabilities and the factory. */
export function resolveEmailProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): EmailProviderConfiguration {
  const requested =
    environment['EMAIL_PROVIDER']?.trim().toLowerCase() ||
    (environment['SMTP_HOST']?.trim() ? 'smtp' : 'console');
  const isDevelopment = environment['NODE_ENV'] !== 'production';

  if (
    isDevelopment &&
    !environment['SMTP_HOST']?.trim() &&
    !environment['ACS_CONNECTION_STRING']?.trim()
  ) {
    return { name: 'console', deliverable: false, errorCode: null };
  }

  if (requested === 'acs') {
    return environment['ACS_CONNECTION_STRING']?.trim()
      ? { name: 'acs', deliverable: true, errorCode: null }
      : { name: 'acs', deliverable: false, errorCode: 'ACS_CONNECTION_STRING_MISSING' };
  }
  if (requested === 'smtp') {
    return environment['SMTP_HOST']?.trim()
      ? { name: 'smtp', deliverable: true, errorCode: null }
      : { name: 'smtp', deliverable: false, errorCode: 'SMTP_HOST_MISSING' };
  }
  if (requested === 'console') {
    return { name: 'console', deliverable: false, errorCode: null };
  }
  return { name: 'console', deliverable: false, errorCode: 'UNKNOWN_PROVIDER' };
}
