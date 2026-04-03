/**
 * IP Address Utilities Tests
 *
 * Tests for IP validation and CIDR matching (F018).
 */

import { describe, it, expect } from 'vitest';
import { ipMatchesCidr, isIpAllowed, isValidIpOrCidr, getClientIp } from './ip';

describe('ipMatchesCidr', () => {
  describe('exact IP matching', () => {
    it('matches exact IP address', () => {
      expect(ipMatchesCidr('192.168.1.1', '192.168.1.1')).toBe(true);
    });

    it('does not match different IP address', () => {
      expect(ipMatchesCidr('192.168.1.1', '192.168.1.2')).toBe(false);
    });

    it('handles edge case IPs', () => {
      expect(ipMatchesCidr('0.0.0.0', '0.0.0.0')).toBe(true);
      expect(ipMatchesCidr('255.255.255.255', '255.255.255.255')).toBe(true);
    });
  });

  describe('CIDR notation matching', () => {
    it('matches IP in /24 network', () => {
      expect(ipMatchesCidr('192.168.1.100', '192.168.1.0/24')).toBe(true);
      expect(ipMatchesCidr('192.168.1.1', '192.168.1.0/24')).toBe(true);
      expect(ipMatchesCidr('192.168.1.254', '192.168.1.0/24')).toBe(true);
    });

    it('does not match IP outside /24 network', () => {
      expect(ipMatchesCidr('192.168.2.1', '192.168.1.0/24')).toBe(false);
      expect(ipMatchesCidr('192.167.1.1', '192.168.1.0/24')).toBe(false);
    });

    it('matches IP in /16 network', () => {
      expect(ipMatchesCidr('10.0.0.1', '10.0.0.0/16')).toBe(true);
      expect(ipMatchesCidr('10.0.255.255', '10.0.0.0/16')).toBe(true);
    });

    it('does not match IP outside /16 network', () => {
      expect(ipMatchesCidr('10.1.0.1', '10.0.0.0/16')).toBe(false);
    });

    it('matches IP in /8 network', () => {
      expect(ipMatchesCidr('10.0.0.1', '10.0.0.0/8')).toBe(true);
      expect(ipMatchesCidr('10.255.255.255', '10.0.0.0/8')).toBe(true);
    });

    it('handles /32 (single IP)', () => {
      expect(ipMatchesCidr('192.168.1.1', '192.168.1.1/32')).toBe(true);
      expect(ipMatchesCidr('192.168.1.2', '192.168.1.1/32')).toBe(false);
    });

    it('handles /0 (all IPs)', () => {
      expect(ipMatchesCidr('192.168.1.1', '0.0.0.0/0')).toBe(true);
      expect(ipMatchesCidr('10.0.0.1', '0.0.0.0/0')).toBe(true);
    });

    it('handles common corporate networks', () => {
      // 10.0.0.0/8 - Class A private
      expect(ipMatchesCidr('10.1.2.3', '10.0.0.0/8')).toBe(true);
      // 172.16.0.0/12 - Class B private
      expect(ipMatchesCidr('172.16.0.1', '172.16.0.0/12')).toBe(true);
      expect(ipMatchesCidr('172.31.255.255', '172.16.0.0/12')).toBe(true);
      // 192.168.0.0/16 - Class C private
      expect(ipMatchesCidr('192.168.1.1', '192.168.0.0/16')).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('returns false for invalid IP', () => {
      expect(ipMatchesCidr('invalid', '192.168.1.0/24')).toBe(false);
      expect(ipMatchesCidr('256.1.1.1', '192.168.1.0/24')).toBe(false);
    });

    it('returns false for invalid CIDR', () => {
      expect(ipMatchesCidr('192.168.1.1', 'invalid/24')).toBe(false);
      expect(ipMatchesCidr('192.168.1.1', '192.168.1.0/33')).toBe(false);
      expect(ipMatchesCidr('192.168.1.1', '192.168.1.0/-1')).toBe(false);
    });
  });
});

describe('isIpAllowed', () => {
  it('allows all IPs when allowlist is empty', () => {
    expect(isIpAllowed('192.168.1.1', [])).toBe(true);
  });

  it('denies when IP is null or undefined', () => {
    expect(isIpAllowed(null, ['192.168.1.0/24'])).toBe(false);
    expect(isIpAllowed(undefined, ['192.168.1.0/24'])).toBe(false);
  });

  it('allows IP in allowlist', () => {
    expect(isIpAllowed('192.168.1.100', ['192.168.1.100'])).toBe(true);
  });

  it('denies IP not in allowlist', () => {
    expect(isIpAllowed('192.168.1.100', ['192.168.1.1', '192.168.1.2'])).toBe(false);
  });

  it('allows IP matching CIDR in allowlist', () => {
    expect(isIpAllowed('192.168.1.100', ['192.168.1.0/24'])).toBe(true);
  });

  it('supports mixed exact IPs and CIDRs', () => {
    const allowlist = ['10.0.0.1', '192.168.1.0/24', '172.16.0.0/12'];
    expect(isIpAllowed('10.0.0.1', allowlist)).toBe(true);
    expect(isIpAllowed('192.168.1.50', allowlist)).toBe(true);
    expect(isIpAllowed('172.20.1.1', allowlist)).toBe(true);
    expect(isIpAllowed('8.8.8.8', allowlist)).toBe(false);
  });

  it('handles corporate VPN scenario', () => {
    const corpAllowlist = ['10.0.0.0/8', '172.16.0.0/12'];
    expect(isIpAllowed('10.1.2.3', corpAllowlist)).toBe(true);
    expect(isIpAllowed('172.31.255.1', corpAllowlist)).toBe(true);
    expect(isIpAllowed('192.168.1.1', corpAllowlist)).toBe(false); // Home network
    expect(isIpAllowed('8.8.8.8', corpAllowlist)).toBe(false); // Public IP
  });
});

describe('isValidIpOrCidr', () => {
  it('validates correct IP addresses', () => {
    expect(isValidIpOrCidr('192.168.1.1')).toBe(true);
    expect(isValidIpOrCidr('0.0.0.0')).toBe(true);
    expect(isValidIpOrCidr('255.255.255.255')).toBe(true);
  });

  it('validates correct CIDR notation', () => {
    expect(isValidIpOrCidr('192.168.1.0/24')).toBe(true);
    expect(isValidIpOrCidr('10.0.0.0/8')).toBe(true);
    expect(isValidIpOrCidr('0.0.0.0/0')).toBe(true);
    expect(isValidIpOrCidr('192.168.1.1/32')).toBe(true);
  });

  it('rejects invalid IP addresses', () => {
    expect(isValidIpOrCidr('256.1.1.1')).toBe(false);
    expect(isValidIpOrCidr('192.168.1')).toBe(false);
    expect(isValidIpOrCidr('invalid')).toBe(false);
    expect(isValidIpOrCidr('')).toBe(false);
  });

  it('rejects invalid CIDR notation', () => {
    expect(isValidIpOrCidr('192.168.1.0/33')).toBe(false);
    expect(isValidIpOrCidr('192.168.1.0/-1')).toBe(false);
    expect(isValidIpOrCidr('invalid/24')).toBe(false);
  });
});

describe('getClientIp', () => {
  it('extracts IP from X-Forwarded-For header', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '192.168.1.1');
    expect(getClientIp(headers)).toBe('192.168.1.1');
  });

  it('extracts first IP from multiple X-Forwarded-For values', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '192.168.1.1, 10.0.0.1, 172.16.0.1');
    expect(getClientIp(headers)).toBe('192.168.1.1');
  });

  it('extracts IP from X-Real-IP header', () => {
    const headers = new Headers();
    headers.set('x-real-ip', '192.168.1.1');
    expect(getClientIp(headers)).toBe('192.168.1.1');
  });

  it('prefers X-Forwarded-For over X-Real-IP', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '192.168.1.1');
    headers.set('x-real-ip', '10.0.0.1');
    expect(getClientIp(headers)).toBe('192.168.1.1');
  });

  it('returns null when no IP headers present', () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe(null);
  });

  it('returns null for invalid IP in headers', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', 'invalid');
    expect(getClientIp(headers)).toBe(null);
  });

  it('handles whitespace in header values', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '  192.168.1.1  ,  10.0.0.1  ');
    expect(getClientIp(headers)).toBe('192.168.1.1');
  });
});
