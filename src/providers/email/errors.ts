export type EmailProviderName = 'acs' | 'smtp' | 'console' | 'unknown';

export class EmailDeliveryError extends Error {
  readonly code: string;
  readonly provider: EmailProviderName;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(input: {
    code: string;
    provider: EmailProviderName;
    retryable: boolean;
    statusCode?: number;
    cause?: unknown;
  }) {
    super(input.code, { cause: input.cause });
    this.name = 'EmailDeliveryError';
    this.code = input.code;
    this.provider = input.provider;
    this.retryable = input.retryable;
    this.statusCode = input.statusCode;
  }
}

function numericField(error: Record<string, unknown>, key: string): number | undefined {
  const value = error[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(error: Record<string, unknown>, key: string): string | undefined {
  const value = error[key];
  return typeof value === 'string' && value.length <= 100 ? value : undefined;
}

export function normalizeEmailError(
  error: unknown,
  provider: EmailProviderName
): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) {
    return error;
  }

  const details = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const smtpStatus = numericField(details, 'responseCode');
  const httpStatus = numericField(details, 'statusCode');
  const rawCode = stringField(details, 'code')?.toUpperCase();

  if (smtpStatus && smtpStatus >= 500) {
    return new EmailDeliveryError({
      code: 'SMTP_PERMANENT_REJECTION',
      provider,
      retryable: false,
      statusCode: smtpStatus,
      cause: error,
    });
  }

  if (smtpStatus && smtpStatus >= 400) {
    return new EmailDeliveryError({
      code: 'SMTP_TRANSIENT_REJECTION',
      provider,
      retryable: true,
      statusCode: smtpStatus,
      cause: error,
    });
  }

  if (httpStatus && [408, 409, 425, 429].includes(httpStatus)) {
    return new EmailDeliveryError({
      code: `EMAIL_HTTP_${httpStatus}`,
      provider,
      retryable: true,
      statusCode: httpStatus,
      cause: error,
    });
  }

  if (httpStatus && httpStatus >= 500) {
    return new EmailDeliveryError({
      code: 'EMAIL_PROVIDER_UNAVAILABLE',
      provider,
      retryable: true,
      statusCode: httpStatus,
      cause: error,
    });
  }

  if (httpStatus && httpStatus >= 400) {
    return new EmailDeliveryError({
      code: `EMAIL_HTTP_${httpStatus}`,
      provider,
      retryable: false,
      statusCode: httpStatus,
      cause: error,
    });
  }

  if (rawCode && ['EAUTH', 'EENVELOPE', 'EMESSAGE'].includes(rawCode)) {
    return new EmailDeliveryError({
      code: `SMTP_${rawCode}`,
      provider,
      retryable: false,
      cause: error,
    });
  }

  if (
    rawCode &&
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ESOCKET'].includes(rawCode)
  ) {
    return new EmailDeliveryError({
      code: `EMAIL_${rawCode}`,
      provider,
      retryable: true,
      cause: error,
    });
  }

  // Unknown failures remain retryable so an unrecognized transient provider
  // condition does not silently discard a password-reset email.
  return new EmailDeliveryError({
    code: 'EMAIL_PROVIDER_ERROR',
    provider,
    retryable: true,
    cause: error,
  });
}
