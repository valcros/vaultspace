import { createHash, createHmac } from 'crypto';

function canonicalize(value: unknown, depth = 0): string {
  if (depth > 20) {
    throw new Error('EVENT_GRID_CANONICAL_DEPTH_EXCEEDED');
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('EVENT_GRID_CANONICAL_VALUE_INVALID');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 1000) {
      throw new Error('EVENT_GRID_CANONICAL_ARRAY_TOO_LARGE');
    }
    return `[${value.map((item) => canonicalize(item, depth + 1)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length > 500) {
      throw new Error('EVENT_GRID_CANONICAL_OBJECT_TOO_LARGE');
    }
    return `{${keys
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key], depth + 1)}`
      )
      .join(',')}}`;
  }
  throw new Error('EVENT_GRID_CANONICAL_VALUE_INVALID');
}

export function stableEventFingerprint(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex');
}

export function payloadFingerprint(event: unknown, key: Buffer): string {
  return createHmac('sha256', key).update(canonicalize(event)).digest('hex');
}
