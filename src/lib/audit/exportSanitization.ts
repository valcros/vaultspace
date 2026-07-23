const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Quote a CSV cell and neutralize spreadsheet formulas from external text.
 */
export function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const neutralized = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

/**
 * Preserve enough IP context for operations while minimizing exported PII.
 */
export function redactIpAddress(ipAddress: string | null): string | null {
  if (!ipAddress) {
    return null;
  }
  const ipv4 = ipAddress.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.xxx`;
  }
  if (ipAddress.includes(':')) {
    const visible = ipAddress.split(':').filter(Boolean).slice(0, 3).join(':');
    return `${visible || 'ipv6'}:…`;
  }
  return 'redacted';
}
