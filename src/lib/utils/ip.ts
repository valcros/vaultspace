/**
 * IP Address Utilities
 *
 * Provides IP address validation and CIDR matching functionality
 * for IP allowlist enforcement (F018).
 */

/**
 * Parse an IPv4 address into its numeric representation
 */
function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) {
      return null;
    }
    result = (result << 8) | num;
  }
  return result >>> 0; // Ensure unsigned
}

/**
 * Check if an IP address matches a CIDR range
 *
 * @param ip - The IP address to check (e.g., "192.168.1.100")
 * @param cidr - The CIDR notation (e.g., "192.168.1.0/24") or single IP
 * @returns true if the IP matches the CIDR range
 */
export function ipMatchesCidr(ip: string, cidr: string): boolean {
  // Handle exact IP match (no CIDR notation)
  if (!cidr.includes('/')) {
    return ip === cidr;
  }

  const parts = cidr.split('/');
  const networkStr = parts[0];
  const prefixStr = parts[1];

  if (!networkStr || !prefixStr) {
    return false;
  }

  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipNum = ipv4ToNumber(ip);
  const networkNum = ipv4ToNumber(networkStr);

  if (ipNum === null || networkNum === null) {
    return false;
  }

  // Create mask from prefix length
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  // Compare masked values
  return (ipNum & mask) === (networkNum & mask);
}

/**
 * Check if an IP address is allowed by an allowlist
 *
 * Supports both exact IP addresses and CIDR notation.
 *
 * @param ip - The IP address to check
 * @param allowlist - Array of allowed IPs or CIDR ranges
 * @returns true if the IP is allowed
 */
export function isIpAllowed(ip: string | null | undefined, allowlist: string[]): boolean {
  // If no IP provided, deny
  if (!ip) {
    return false;
  }

  // If allowlist is empty, allow all
  if (allowlist.length === 0) {
    return true;
  }

  // Check each entry in the allowlist
  return allowlist.some((entry) => ipMatchesCidr(ip, entry));
}

/**
 * Validate an IP address or CIDR notation
 *
 * @param value - The IP or CIDR to validate
 * @returns true if valid
 */
export function isValidIpOrCidr(value: string): boolean {
  if (value.includes('/')) {
    const parts = value.split('/');
    const ip = parts[0];
    const prefix = parts[1];
    if (!ip || !prefix) {
      return false;
    }
    const prefixNum = parseInt(prefix, 10);
    return ipv4ToNumber(ip) !== null && !isNaN(prefixNum) && prefixNum >= 0 && prefixNum <= 32;
  }
  return ipv4ToNumber(value) !== null;
}

/**
 * Extract client IP from request headers
 *
 * Handles proxied requests with X-Forwarded-For and X-Real-IP headers.
 *
 * @param headers - Request headers
 * @returns The client IP address or null
 */
export function getClientIp(headers: Headers): string | null {
  // X-Forwarded-For can contain multiple IPs; take the first one (client)
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first && ipv4ToNumber(first) !== null) {
      return first;
    }
  }

  // Try X-Real-IP
  const realIp = headers.get('x-real-ip');
  if (realIp && ipv4ToNumber(realIp) !== null) {
    return realIp;
  }

  return null;
}
