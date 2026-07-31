import { afterEach, describe, expect, it } from 'vitest';

import { resolveEmailProviderConfiguration } from './email/config';
import { createEmailProvider, getConfiguredEmailProviderName } from './index';

const originalEnvironment = {
  nodeEnv: process.env['NODE_ENV'],
  emailProvider: process.env['EMAIL_PROVIDER'],
  smtpHost: process.env['SMTP_HOST'],
  acsConnectionString: process.env['ACS_CONNECTION_STRING'],
};

afterEach(() => {
  setOrDelete('NODE_ENV', originalEnvironment.nodeEnv);
  setOrDelete('EMAIL_PROVIDER', originalEnvironment.emailProvider);
  setOrDelete('SMTP_HOST', originalEnvironment.smtpHost);
  setOrDelete('ACS_CONNECTION_STRING', originalEnvironment.acsConnectionString);
});

function setOrDelete(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('getConfiguredEmailProviderName', () => {
  it('returns the normalized configured provider in production', () => {
    setOrDelete('NODE_ENV', 'production');
    process.env['EMAIL_PROVIDER'] = ' ACS ';
    process.env['ACS_CONNECTION_STRING'] =
      `endpoint=https://example.communication.azure.com/;accesskey=${Buffer.alloc(32).toString('base64')}`;

    expect(getConfiguredEmailProviderName()).toBe('acs');
    expect(createEmailProvider().providerName).toBe('acs');
  });

  it('matches the development console fallback when no transport is configured', () => {
    setOrDelete('NODE_ENV', 'development');
    process.env['EMAIL_PROVIDER'] = 'acs';
    delete process.env['SMTP_HOST'];
    delete process.env['ACS_CONNECTION_STRING'];

    expect(getConfiguredEmailProviderName()).toBe('console');
    expect(createEmailProvider().providerName).toBe('console');
  });

  it('records unknown provider configuration as the factory console fallback', () => {
    setOrDelete('NODE_ENV', 'production');
    process.env['EMAIL_PROVIDER'] = 'unsupported';

    expect(getConfiguredEmailProviderName()).toBe('console');
    expect(resolveEmailProviderConfiguration().deliverable).toBe(false);
  });

  it('selects the same SMTP provider used by capability resolution', () => {
    setOrDelete('NODE_ENV', 'production');
    process.env['EMAIL_PROVIDER'] = ' SMTP ';
    process.env['SMTP_HOST'] = 'smtp.example.com';

    expect(resolveEmailProviderConfiguration()).toEqual({
      name: 'smtp',
      deliverable: true,
      errorCode: null,
    });
    expect(createEmailProvider().providerName).toBe('smtp');
  });

  it('fails provider construction when ACS is selected without its credential', () => {
    setOrDelete('NODE_ENV', 'production');
    process.env['EMAIL_PROVIDER'] = 'acs';
    process.env['SMTP_HOST'] = 'smtp.example.com';
    delete process.env['ACS_CONNECTION_STRING'];

    expect(resolveEmailProviderConfiguration()).toEqual({
      name: 'acs',
      deliverable: false,
      errorCode: 'ACS_CONNECTION_STRING_MISSING',
    });
    expect(() => createEmailProvider()).toThrow(/ACS_CONNECTION_STRING/i);
  });

  it('fails provider construction when the ACS credential contains only whitespace', () => {
    setOrDelete('NODE_ENV', 'production');
    process.env['EMAIL_PROVIDER'] = 'acs';
    process.env['ACS_CONNECTION_STRING'] = '   ';

    expect(resolveEmailProviderConfiguration().deliverable).toBe(false);
    expect(() => createEmailProvider()).toThrow(/ACS_CONNECTION_STRING/i);
  });

  it('fails provider construction when SMTP is selected without a host', () => {
    setOrDelete('NODE_ENV', 'production');
    process.env['EMAIL_PROVIDER'] = 'smtp';
    delete process.env['SMTP_HOST'];

    expect(resolveEmailProviderConfiguration().deliverable).toBe(false);
    expect(() => createEmailProvider()).toThrow(/SMTP_HOST/i);
  });
});
