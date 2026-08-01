import { Buffer } from 'buffer';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AcsEventGridConfigurationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AcsEventGridConfigurationError';
  }
}

export interface AcsEventGridSource {
  subscriptionName: string;
  topic: string;
}

export interface AcsEventGridConfiguration {
  enabled: boolean;
  tenantId: string;
  audience: string;
  callerAppId: string;
  callerObjectId: string | null;
  requiredRole: string;
  sources: AcsEventGridSource[];
  activeFingerprintKeyId: string;
  fingerprintKeys: Map<string, Buffer>;
  expectedInboxOwner: string;
}

function required(environment: NodeJS.ProcessEnv, name: string, maxLength = 500): string {
  const value = environment[name]?.trim();
  if (!value || value.length > maxLength) {
    throw new AcsEventGridConfigurationError(`${name}_INVALID`);
  }
  return value;
}

export function canonicalEventGridTopic(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

export function resolveAcsEventGridConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): AcsEventGridConfiguration {
  const enabled = environment['ACS_EVENT_GRID_INGESTION_ENABLED'] === 'true';
  if (!enabled) {
    return {
      enabled: false,
      tenantId: '',
      audience: '',
      callerAppId: '',
      callerObjectId: null,
      requiredRole: '',
      sources: [],
      activeFingerprintKeyId: '',
      fingerprintKeys: new Map(),
      expectedInboxOwner: '',
    };
  }

  required(environment, 'EVENT_GRID_INGRESS_DATABASE_URL', 2_000);

  const tenantId = required(environment, 'EVENT_GRID_WEBHOOK_TENANT_ID', 36).toLowerCase();
  const expectedInboxOwner = required(
    environment,
    'EVENT_GRID_INBOX_EXPECTED_OWNER',
    63
  ).toLowerCase();
  const audience = required(environment, 'EVENT_GRID_WEBHOOK_AUDIENCE', 36).toLowerCase();
  const callerAppId = required(environment, 'EVENT_GRID_WEBHOOK_CALLER_APP_ID', 36).toLowerCase();
  const callerObjectId =
    environment['EVENT_GRID_WEBHOOK_CALLER_OBJECT_ID']?.trim().toLowerCase() || null;
  if (
    !UUID_PATTERN.test(tenantId) ||
    !UUID_PATTERN.test(audience) ||
    !UUID_PATTERN.test(callerAppId) ||
    (callerObjectId !== null && !UUID_PATTERN.test(callerObjectId))
  ) {
    throw new AcsEventGridConfigurationError('EVENT_GRID_WEBHOOK_IDENTITY_INVALID');
  }
  if (
    !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedInboxOwner) ||
    expectedInboxOwner === 'vaultspace_app'
  ) {
    throw new AcsEventGridConfigurationError('EVENT_GRID_INBOX_EXPECTED_OWNER_INVALID');
  }

  let sources: unknown;
  let rawKeys: unknown;
  try {
    sources = JSON.parse(required(environment, 'ACS_EVENT_GRID_ALLOWED_SOURCES', 10_000));
    rawKeys = JSON.parse(required(environment, 'EVENT_GRID_PAYLOAD_FINGERPRINT_KEYS', 10_000));
  } catch (error) {
    if (error instanceof AcsEventGridConfigurationError) {
      throw error;
    }
    throw new AcsEventGridConfigurationError('EVENT_GRID_WEBHOOK_JSON_CONFIGURATION_INVALID');
  }
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 10) {
    throw new AcsEventGridConfigurationError('ACS_EVENT_GRID_ALLOWED_SOURCES_INVALID');
  }
  const normalizedSources = sources.map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new AcsEventGridConfigurationError('ACS_EVENT_GRID_ALLOWED_SOURCES_INVALID');
    }
    const record = source as Record<string, unknown>;
    if (
      typeof record['subscriptionName'] !== 'string' ||
      typeof record['topic'] !== 'string' ||
      !record['subscriptionName'].trim() ||
      record['subscriptionName'].length > 100 ||
      !record['topic'].trim() ||
      record['topic'].length > 500
    ) {
      throw new AcsEventGridConfigurationError('ACS_EVENT_GRID_ALLOWED_SOURCES_INVALID');
    }
    return {
      subscriptionName: record['subscriptionName'].trim(),
      topic: canonicalEventGridTopic(record['topic']),
    };
  });

  if (!rawKeys || typeof rawKeys !== 'object' || Array.isArray(rawKeys)) {
    throw new AcsEventGridConfigurationError('EVENT_GRID_PAYLOAD_FINGERPRINT_KEYS_INVALID');
  }
  const fingerprintKeys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(rawKeys as Record<string, unknown>)) {
    if (!keyId || keyId.length > 64 || typeof encoded !== 'string') {
      throw new AcsEventGridConfigurationError('EVENT_GRID_PAYLOAD_FINGERPRINT_KEYS_INVALID');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      throw new AcsEventGridConfigurationError('EVENT_GRID_PAYLOAD_FINGERPRINT_KEYS_INVALID');
    }
    const key = Buffer.from(encoded, 'base64');
    if (key.length < 32 || key.toString('base64') !== encoded) {
      throw new AcsEventGridConfigurationError('EVENT_GRID_PAYLOAD_FINGERPRINT_KEYS_INVALID');
    }
    fingerprintKeys.set(keyId, key);
  }
  const activeFingerprintKeyId = required(
    environment,
    'EVENT_GRID_PAYLOAD_FINGERPRINT_ACTIVE_KEY_ID',
    64
  );
  if (!fingerprintKeys.has(activeFingerprintKeyId)) {
    throw new AcsEventGridConfigurationError('EVENT_GRID_PAYLOAD_FINGERPRINT_ACTIVE_KEY_MISSING');
  }

  return {
    enabled,
    tenantId,
    audience,
    callerAppId,
    callerObjectId,
    requiredRole:
      environment['EVENT_GRID_WEBHOOK_REQUIRED_ROLE']?.trim() ||
      'AzureEventGridSecureWebhookSubscriber',
    sources: normalizedSources,
    activeFingerprintKeyId,
    fingerprintKeys,
    expectedInboxOwner,
  };
}
