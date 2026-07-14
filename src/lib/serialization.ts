/**
 * JSON-safe serialization helpers.
 */

/**
 * Convert BigInt values to Number so a value can be returned via
 * NextResponse.json() / JSON.stringify, which throw on BigInt.
 *
 * Prisma models such as Document expose `fileSize` as a BigInt; returning the
 * raw row previously threw "Do not know how to serialize a BigInt" and 500'd
 * the restore and document-edit endpoints. Byte sizes fit safely in a JS Number.
 */
export function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? Number(val) : val))
  ) as T;
}
