import { describe, it, expect } from 'vitest';

import '@/lib/bigint-json';

describe('global BigInt JSON serialization', () => {
  it('serializes a bare BigInt as a number', () => {
    expect(JSON.stringify(BigInt(42))).toBe('42');
  });

  it('serializes BigInt fields nested in objects and arrays', () => {
    expect(
      JSON.stringify({ fileSize: BigInt(123), nested: { s: BigInt('9007199254740991') } })
    ).toBe('{"fileSize":123,"nested":{"s":9007199254740991}}');
    expect(JSON.stringify([BigInt(1), BigInt(2)])).toBe('[1,2]');
  });

  it('does not throw on a mixed BigInt payload (the class of 500s this fixes)', () => {
    expect(() => JSON.stringify({ id: 'doc-1', size: BigInt(500), tags: ['a'] })).not.toThrow();
  });
});
