/**
 * VaultSpace Database Seed Script (F143)
 *
 * Seeds the database with demo data including:
 * - Demo organization: "Series A Funding"
 * - Demo users: admin, 2 viewers
 * - Demo room: "Due Diligence Package"
 * - Sample folders and documents
 *
 * Run: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Demo password for all users
const DEMO_PASSWORD = 'Demo123!';

async function main() {
  console.log('Seeding database...');

  // Hash the demo password
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  // 1. Create demo organization
  console.log('Creating organization...');
  const organization = await prisma.organization.upsert({
    where: { slug: 'series-a-funding' },
    update: {},
    create: {
      name: 'Series A Funding',
      slug: 'series-a-funding',
      primaryColor: '#2563eb',
      isActive: true,
      allowSelfSignup: false,
      eventRetentionDays: 365,
      trashRetentionDays: 30,
    },
  });
  console.log('Organization created: ' + organization.name);

  // 2. Create demo users
  console.log('Creating users...');

  // Admin user
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@demo.vaultspace.app' },
    update: {},
    create: {
      email: 'admin@demo.vaultspace.app',
      passwordHash,
      firstName: 'Demo',
      lastName: 'Admin',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  // Create admin-org relationship
  await prisma.userOrganization.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: adminUser.id,
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      userId: adminUser.id,
      role: 'ADMIN',
      isActive: true,
      canManageUsers: true,
      canManageRooms: true,
    },
  });
  console.log('Admin user created: ' + adminUser.email);

  // Viewer 1
  const viewer1 = await prisma.user.upsert({
    where: { email: 'investor1@demo.vaultspace.app' },
    update: {},
    create: {
      email: 'investor1@demo.vaultspace.app',
      passwordHash,
      firstName: 'Alice',
      lastName: 'Investor',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.userOrganization.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: viewer1.id,
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      userId: viewer1.id,
      role: 'VIEWER',
      isActive: true,
    },
  });
  console.log('Viewer 1 created: ' + viewer1.email);

  // Viewer 2
  const viewer2 = await prisma.user.upsert({
    where: { email: 'investor2@demo.vaultspace.app' },
    update: {},
    create: {
      email: 'investor2@demo.vaultspace.app',
      passwordHash,
      firstName: 'Bob',
      lastName: 'Partner',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.userOrganization.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: viewer2.id,
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      userId: viewer2.id,
      role: 'VIEWER',
      isActive: true,
    },
  });
  console.log('Viewer 2 created: ' + viewer2.email);

  // 3. Create demo room
  console.log('Creating room...');
  const room = await prisma.room.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: 'due-diligence-package',
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: 'Due Diligence Package',
      slug: 'due-diligence-package',
      description: 'Complete due diligence materials for Series A funding round',
      status: 'ACTIVE',
      requiresPassword: false,
      requiresEmailVerification: true,
      allowDownloads: true,
      createdByUserId: adminUser.id,
    },
  });
  console.log('Room created: ' + room.name);

  // 4. Create folders
  console.log('Creating folders...');
  const folders = [
    { name: 'Financials', path: '/Financials' },
    { name: 'Legal', path: '/Legal' },
    { name: 'Technical', path: '/Technical' },
  ];

  const createdFolders: Record<string, string> = {};
  for (const folder of folders) {
    const created = await prisma.folder.upsert({
      where: {
        roomId_path: {
          roomId: room.id,
          path: folder.path,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        roomId: room.id,
        name: folder.name,
        path: folder.path,
        displayOrder: folders.indexOf(folder),
      },
    });
    createdFolders[folder.name] = created.id;
    console.log('Folder created: ' + folder.name);
  }

  // 5. Create sample documents (metadata only - no actual files)
  console.log('Creating sample documents...');
  const documents = [
    {
      name: 'Capitalization Table.xlsx',
      folder: 'Financials',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 45000,
    },
    {
      name: 'Financial Statements Q1-Q4.xlsx',
      folder: 'Financials',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 128000,
    },
    {
      name: 'Revenue Projections.xlsx',
      folder: 'Financials',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 67000,
    },
    {
      name: 'Pitch Deck.pptx',
      folder: null,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: 5200000,
    },
    {
      name: 'Articles of Incorporation.pdf',
      folder: 'Legal',
      mimeType: 'application/pdf',
      fileSize: 890000,
    },
    {
      name: 'Employee Stock Option Plan.pdf',
      folder: 'Legal',
      mimeType: 'application/pdf',
      fileSize: 234000,
    },
    {
      name: 'Technology Roadmap.pdf',
      folder: 'Technical',
      mimeType: 'application/pdf',
      fileSize: 1500000,
    },
    {
      name: 'Security Audit Report.pdf',
      folder: 'Technical',
      mimeType: 'application/pdf',
      fileSize: 2100000,
    },
    {
      name: 'Architecture Overview.pdf',
      folder: 'Technical',
      mimeType: 'application/pdf',
      fileSize: 780000,
    },
    {
      name: 'Insurance Certificate.pdf',
      folder: 'Legal',
      mimeType: 'application/pdf',
      fileSize: 156000,
    },
  ];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (!doc) continue;

    const folderId = doc.folder ? createdFolders[doc.folder] : null;

    // Create document
    const document = await prisma.document.create({
      data: {
        organizationId: organization.id,
        roomId: room.id,
        folderId: folderId || null,
        name: doc.name,
        displayOrder: i,
        status: 'ACTIVE',
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        originalFileName: doc.name,
        allowDownload: true,
        viewCount: Math.floor(Math.random() * 50),
        uniqueViewerCount: Math.floor(Math.random() * 10),
        totalVersions: 1,
      },
    });

    // Create initial version
    const versionHash = crypto
      .createHash('sha256')
      .update(doc.name + Date.now())
      .digest('hex');

    const version = await prisma.documentVersion.create({
      data: {
        organizationId: organization.id,
        documentId: document.id,
        versionNumber: 1,
        uploadedByUserId: adminUser.id,
        uploadedByEmail: adminUser.email,
        changeDescription: 'Initial upload',
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        fileName: doc.name,
        fileSha256: versionHash,
        versionHash: versionHash,
        previewStatus: 'READY',
        scanStatus: 'CLEAN',
        scannedAt: new Date(),
      },
    });

    // Update document with current version ID
    await prisma.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });

    console.log('Document created: ' + doc.name);
  }

  // 6. Create viewer permissions
  console.log('Creating permissions...');
  await prisma.permission.create({
    data: {
      organizationId: organization.id,
      resourceType: 'ROOM',
      roomId: room.id,
      granteeType: 'USER',
      userId: viewer1.id,
      permissionLevel: 'VIEW',
      inheritFromParent: true,
      isActive: true,
    },
  });

  await prisma.permission.create({
    data: {
      organizationId: organization.id,
      resourceType: 'ROOM',
      roomId: room.id,
      granteeType: 'USER',
      userId: viewer2.id,
      permissionLevel: 'VIEW',
      inheritFromParent: true,
      isActive: true,
    },
  });
  console.log('Permissions created for viewers');

  // 7. Update room statistics
  await prisma.room.update({
    where: { id: room.id },
    data: {
      totalDocuments: documents.length,
      totalFolders: folders.length,
    },
  });

  console.log('\n--- Seed Complete ---');
  console.log('Organization: ' + organization.name);
  console.log('Room: ' + room.name);
  console.log('Users: 3 (1 admin, 2 viewers)');
  console.log('Folders: ' + folders.length);
  console.log('Documents: ' + documents.length);
  console.log('\nDemo Login Credentials:');
  console.log('Admin: admin@demo.vaultspace.app / ' + DEMO_PASSWORD);
  console.log('Viewer 1: investor1@demo.vaultspace.app / ' + DEMO_PASSWORD);
  console.log('Viewer 2: investor2@demo.vaultspace.app / ' + DEMO_PASSWORD);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
