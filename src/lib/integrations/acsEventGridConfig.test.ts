import { describe, expect, it } from 'vitest';

import { resolveAcsEventGridConfiguration } from './acsEventGridConfig';

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    ACS_EVENT_GRID_INGESTION_ENABLED: 'true',
    EVENT_GRID_INGRESS_DATABASE_URL: 'postgresql://event_ingress:test@localhost/vaultspace',
    EVENT_GRID_INBOX_EXPECTED_OWNER: 'vaultspace_migrator',
    EVENT_GRID_WEBHOOK_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    EVENT_GRID_WEBHOOK_AUDIENCE: '44444444-4444-4444-8444-444444444444',
    EVENT_GRID_WEBHOOK_CALLER_APP_ID: '22222222-2222-4222-8222-222222222222',
    ACS_EVENT_GRID_ALLOWED_SOURCES: JSON.stringify([
      {
        subscriptionName: 'email-delivery',
        topic:
          '/Subscriptions/SUB/resourceGroups/RG/providers/Microsoft.Communication/communicationServices/ACS/',
      },
    ]),
    EVENT_GRID_PAYLOAD_FINGERPRINT_ACTIVE_KEY_ID: '2026-07',
    EVENT_GRID_PAYLOAD_FINGERPRINT_KEYS: JSON.stringify({
      '2026-07': Buffer.alloc(32, 4).toString('base64'),
      '2026-06': Buffer.alloc(32, 3).toString('base64'),
    }),
  };
}

describe('ACS Event Grid configuration', () => {
  it('normalizes exact source pairs and retains rotation keys', () => {
    const resolved = resolveAcsEventGridConfiguration(environment());
    expect(resolved.sources).toEqual([
      {
        subscriptionName: 'email-delivery',
        topic:
          '/subscriptions/sub/resourcegroups/rg/providers/microsoft.communication/communicationservices/acs',
      },
    ]);
    expect(resolved.fingerprintKeys.size).toBe(2);
  });

  it('fails closed for a short fingerprint key', () => {
    const input = environment();
    input['EVENT_GRID_PAYLOAD_FINGERPRINT_KEYS'] = JSON.stringify({
      '2026-07': Buffer.alloc(16).toString('base64'),
    });
    expect(() => resolveAcsEventGridConfiguration(input)).toThrow(
      /EVENT_GRID_PAYLOAD_FINGERPRINT_KEYS_INVALID/
    );
  });

  it('requires the dedicated ingress database URL whenever ingestion is enabled', () => {
    const input = environment();
    delete input['EVENT_GRID_INGRESS_DATABASE_URL'];
    expect(() => resolveAcsEventGridConfiguration(input)).toThrow(
      /EVENT_GRID_INGRESS_DATABASE_URL_INVALID/
    );
  });

  it('rejects the ordinary application role as the inbox owner', () => {
    const input = environment();
    input['EVENT_GRID_INBOX_EXPECTED_OWNER'] = 'vaultspace_app';
    expect(() => resolveAcsEventGridConfiguration(input)).toThrow(
      /EVENT_GRID_INBOX_EXPECTED_OWNER_INVALID/
    );
  });
});
