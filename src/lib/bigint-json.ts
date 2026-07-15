/**
 * Global BigInt JSON serialization.
 *
 * Prisma exposes byte counts (Document.fileSize, DocumentVersion.fileSize,
 * Organization.maxStorageBytes) as BigInt. `JSON.stringify` throws on BigInt,
 * which has repeatedly 500'd API responses that returned Prisma rows directly
 * (PRs #51, #53, #54, and the Trash route). Rather than serialize per-route and
 * inevitably miss one, teach BigInt to JSON-serialize once, process-wide: from
 * here on `JSON.stringify` — and therefore `NextResponse.json` — emits BigInt as
 * a plain number. Byte counts are far within Number.MAX_SAFE_INTEGER, matching
 * the behaviour of the existing serializeBigInt() helper.
 *
 * Importing this module for its side effect installs the serializer. It is
 * imported at server startup (instrumentation.ts) and from the DB module so it
 * is always active before any Prisma result is serialized.
 */

declare global {
  interface BigInt {
    toJSON(): number;
  }
}

if (typeof BigInt.prototype.toJSON !== 'function') {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint): number {
      return Number(this);
    },
    writable: true,
    configurable: true,
  });
}

export {};
