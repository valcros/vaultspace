import type { Prisma } from '@prisma/client';

export interface EligibleSource {
  organizationId: string;
  roomId: string;
  documentId: string;
  versionId: string;
  fileSha256: string;
  mimeType: string;
  storageBucket: string;
  storageKey: string;
}

/** Queue payload IDs never grant authorization to read or embed source bytes. */
export async function resolveEligibleSource(
  tx: Prisma.TransactionClient,
  organizationId: string,
  documentId: string,
  versionId: string
): Promise<EligibleSource | null> {
  const document = await tx.document.findFirst({
    where: {
      id: documentId,
      organizationId,
      currentVersionId: versionId,
      status: 'ACTIVE',
      deletedAt: null,
      withdrawnAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      roomId: true,
      organization: { select: { isActive: true } },
      room: { select: { status: true, mode: true } },
      versions: {
        where: { id: versionId, organizationId, scanStatus: 'CLEAN' },
        select: {
          id: true,
          scanStatus: true,
          fileSha256: true,
          mimeType: true,
          fileBlob: { select: { storageBucket: true, storageKey: true } },
        },
      },
    },
  });
  if (
    !document ||
    !document.organization.isActive ||
    document.room.status !== 'ACTIVE' ||
    document.room.mode !== 'INDEPENDENT'
  ) {
    return null;
  }
  const policy = await tx.aiPolicy.findFirst({
    where: { organizationId, roomId: document.roomId, enabled: true },
    select: { id: true },
  });
  const version = document.versions[0];
  if (!policy || version?.scanStatus !== 'CLEAN' || !version.fileBlob) {
    return null;
  }
  return {
    organizationId,
    roomId: document.roomId,
    documentId,
    versionId,
    fileSha256: version.fileSha256,
    mimeType: version.mimeType,
    storageBucket: version.fileBlob.storageBucket,
    storageKey: version.fileBlob.storageKey,
  };
}
