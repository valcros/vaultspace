import { describe, expect, it } from 'vitest';

import { normalizeEmailError } from './errors';

describe('normalizeEmailError', () => {
  it('classifies SMTP 5xx as permanent', () => {
    const error = normalizeEmailError({ responseCode: 550 }, 'smtp');
    expect(error.code).toBe('SMTP_PERMANENT_REJECTION');
    expect(error.retryable).toBe(false);
  });

  it('classifies SMTP 4xx as transient', () => {
    const error = normalizeEmailError({ responseCode: 421 }, 'smtp');
    expect(error.code).toBe('SMTP_TRANSIENT_REJECTION');
    expect(error.retryable).toBe(true);
  });

  it('classifies HTTP throttling and service failures as transient', () => {
    expect(normalizeEmailError({ statusCode: 429 }, 'acs').retryable).toBe(true);
    expect(normalizeEmailError({ statusCode: 503 }, 'acs').retryable).toBe(true);
  });

  it('classifies non-transient HTTP client failures as permanent', () => {
    const error = normalizeEmailError({ statusCode: 400 }, 'acs');
    expect(error.code).toBe('EMAIL_HTTP_400');
    expect(error.retryable).toBe(false);
  });
});
