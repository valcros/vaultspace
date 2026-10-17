import { createHash } from 'node:crypto';

import { AI_PIPELINE_REVISION } from './chunking';
import type { EligibleSource } from './sourceEligibility';

/** Metadata only. The original bytes and extracted text never enter job records. */
export function aiIndexInputFingerprint(source: EligibleSource, modelId: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        source.roomId,
        source.fileSha256,
        source.mimeType,
        source.blobId,
        source.storageBucket,
        source.storageKey,
        modelId,
        AI_PIPELINE_REVISION,
      ])
    )
    .digest('hex');
}
