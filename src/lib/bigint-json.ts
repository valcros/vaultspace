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
 * IMPORTANT: this must be *called*, not merely imported for its side effect.
 * package.json declares the package side-effect-free (sideEffects: ["*.css"]),
 * so a bare `import '@/lib/bigint-json'` is tree-shaken out of the server bundle
 * and the patch never runs. Callers import and invoke installBigIntJsonSerializer().
 */

declare global {
  interface BigInt {
    toJSON(): number;
  }
}

let installed = false;

export function installBigIntJsonSerializer(): void {
  if (installed || typeof BigInt.prototype.toJSON === 'function') {
    installed = true;
    return;
  }
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint): number {
      return Number(this);
    },
    writable: true,
    configurable: true,
  });
  installed = true;
}
