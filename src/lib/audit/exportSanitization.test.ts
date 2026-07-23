import { describe, expect, it } from 'vitest';

import { csvCell, redactIpAddress } from './exportSanitization';

describe('csvCell', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', '\tformula', '\rformula'])(
    'neutralizes spreadsheet formula prefix %j',
    (value) => {
      expect(csvCell(value)).toBe(`"'${value}"`);
    }
  );

  it('preserves ordinary values while escaping embedded quotes', () => {
    expect(csvCell('Investor "A"')).toBe('"Investor ""A"""');
  });
});

describe('redactIpAddress', () => {
  it('redacts IPv4 and IPv6 addresses consistently', () => {
    expect(redactIpAddress('198.51.100.23')).toBe('198.51.100.xxx');
    expect(redactIpAddress('2001:db8:1234:5678::1')).toBe('2001:db8:1234:…');
    expect(redactIpAddress(null)).toBeNull();
  });
});
