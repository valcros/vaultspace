/**
 * GDPR Data Export Script (F052)
 *
 * Exports all personal data for a user as required by GDPR Article 20.
 * Generates a JSON file with all user data that can be provided to the user.
 *
 * Usage: npx tsx scripts/gdpr-export.ts <user-email> [output-file]
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface GdprExportData {
  exportDate: string;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  };
  organizations: Array<{
    name: string;
    role: string;
    joinedAt: string;
  }>;
  sessions: Array<{
    createdAt: string;
    lastActivityAt: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  }>;
  uploadedDocuments: Array<{
    documentName: string;
    roomName: string;
    uploadedAt: string;
    fileName: string;
  }>;
  events: Array<{
    eventType: string;
    description: string | null;
    createdAt: string;
    roomName?: string;
    documentName?: string;
  }>;
  notificationPreferences: Array<{
    organizationName: string;
    emailOnDocumentViewed: boolean;
    emailOnDocumentUploaded: boolean;
    emailOnAccessRevoked: boolean;
  }>;
}

async function exportUserData(userEmail: string): Promise<GdprExportData> {
  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    include: {
      organizations: {
        include: {
          organization: { select: { name: true } },
          notificationPreferences: true,
        },
      },
      sessions: {
        select: {
          createdAt: true,
          lastActiveAt: true,
          ipAddress: true,
          userAgent: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100, // Limit to last 100 sessions
      },
    },
  });

  if (!user) {
    throw new Error(`User not found: ${userEmail}`);
  }

  // Get uploaded documents
  const uploadedVersions = await prisma.documentVersion.findMany({
    where: { uploadedByUserId: user.id },
    include: {
      document: {
        select: {
          name: true,
          room: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Get user events (events don't have direct relations, just IDs)
  const events = await prisma.event.findMany({
    where: { actorId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 1000, // Limit to last 1000 events
  });

  return {
    exportDate: new Date().toISOString(),
    user: {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
    },
    organizations: user.organizations.map((uo: { organization: { name: string }; role: string; createdAt: Date }) => ({
      name: uo.organization.name,
      role: uo.role,
      joinedAt: uo.createdAt.toISOString(),
    })),
    sessions: user.sessions.map((s: { createdAt: Date; lastActiveAt: Date | null; ipAddress: string | null; userAgent: string | null }) => ({
      createdAt: s.createdAt.toISOString(),
      lastActivityAt: s.lastActiveAt?.toISOString() || null,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
    })),
    uploadedDocuments: uploadedVersions.map((v) => ({
      documentName: v.document.name,
      roomName: v.document.room?.name || 'Unknown',
      uploadedAt: v.createdAt.toISOString(),
      fileName: v.fileName,
    })),
    events: events.map((e) => ({
      eventType: e.eventType,
      description: e.description,
      createdAt: e.createdAt.toISOString(),
      roomName: e.roomId || undefined,
      documentName: e.documentId || undefined,
    })),
    notificationPreferences: user.organizations
      .filter((uo) => uo.notificationPreferences && uo.notificationPreferences.length > 0)
      .map((uo) => {
        const prefs = uo.notificationPreferences[0];
        return {
          organizationName: uo.organization.name,
          emailOnDocumentViewed: prefs?.emailOnDocumentViewed ?? true,
          emailOnDocumentUploaded: prefs?.emailOnDocumentUploaded ?? true,
          emailOnAccessRevoked: prefs?.emailOnAccessRevoked ?? true,
        };
      }),
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: npx tsx scripts/gdpr-export.ts <user-email> [output-file]');
    process.exit(1);
  }

  const userEmail = args[0];
  const outputFile = args[1] || `gdpr-export-${userEmail?.replace('@', '-at-')}-${Date.now()}.json`;

  if (!userEmail) {
    console.error('Error: User email is required');
    process.exit(1);
  }

  console.log(`[GDPR Export] Exporting data for user: ${userEmail}`);

  try {
    const data = await exportUserData(userEmail);
    const outputPath = path.resolve(outputFile);

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

    console.log(`[GDPR Export] Export complete: ${outputPath}`);
    console.log(`[GDPR Export] Data summary:`);
    console.log(`  - Organizations: ${data.organizations.length}`);
    console.log(`  - Sessions: ${data.sessions.length}`);
    console.log(`  - Uploaded documents: ${data.uploadedDocuments.length}`);
    console.log(`  - Events: ${data.events.length}`);
  } catch (error) {
    console.error('[GDPR Export] Error:', error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error('[GDPR Export] Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
