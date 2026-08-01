import { describe, expect, it } from 'vitest';

import { payloadFingerprint, stableEventFingerprint } from './eventGridFingerprint';

describe('event grid fingerprints', () => {
  it('canonicalizes object key order but includes discarded PII semantics', () => {
    const key = Buffer.alloc(32, 7);
    const first = { id: 'event-1', data: { recipient: 'a@example.com', status: 'Delivered' } };
    const reordered = {
      data: { status: 'Delivered', recipient: 'a@example.com' },
      id: 'event-1',
    };
    const changedRecipient = {
      data: { status: 'Delivered', recipient: 'b@example.com' },
      id: 'event-1',
    };

    expect(payloadFingerprint(first, key)).toBe(payloadFingerprint(reordered, key));
    expect(payloadFingerprint(first, key)).not.toBe(payloadFingerprint(changedRecipient, key));
  });

  it('keeps event identity stable independently of payload-key rotation', () => {
    expect(stableEventFingerprint(' event-1 ')).toBe(stableEventFingerprint('event-1'));
    expect(payloadFingerprint({ id: 'event-1' }, Buffer.alloc(32, 1))).not.toBe(
      payloadFingerprint({ id: 'event-1' }, Buffer.alloc(32, 2))
    );
  });
});
