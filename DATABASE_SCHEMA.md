# DATABASE_SCHEMA.md - VaultSpace Database Design

**Feature Reference:** F152

This document provides a comprehensive database schema specification for VaultSpace, a secure self-hosted data room platform. It covers the complete data model, relationships, indexes, and implementation strategy using PostgreSQL 15+ with Prisma ORM.

---

## Table of Contents

1. [Overview](#overview)
2. [Multi-Tenant Architecture](#multi-tenant-architecture)
3. [Entity Relationship Diagram](#entity-relationship-diagram)
4. [Core Entities & Schema](#core-entities--schema)
5. [Enum Types](#enum-types)
6. [Index Strategy](#index-strategy)
7. [Partitioning Strategy](#partitioning-strategy)
8. [Seed Data](#seed-data)
9. [Migration Strategy](#migration-strategy)
10. [Query Patterns](#query-patterns)

---

## Overview

### Technology Stack

- **Database:** PostgreSQL 15+
- **ORM:** Prisma 5.x
- **Tenancy Model:** Multi-tenant by design
- **Scalability:** Designed for small initial deployments (<50 users, <10K documents) with horizontal scaling without schema rewrites

### Design Principles

1. **Multi-tenant from day one** - Every entity includes `organization_id`
2. **Immutable audit trail** - All changes tracked in `Event` table
3. **Document versioning** - Documents stored as immutable snapshots
4. **Hash chain integrity** - Version hashes include parent hash for tamper detection
5. **Denormalization for performance** - Selected fields duplicated for query efficiency
6. **Time-based partitioning** - Event table partitioned monthly for retention policies

### Performance Considerations

- Composite indexes on `(organization_id, ...)` for multi-tenant isolation
- Separate `SearchIndex` table for full-text search to avoid bloating document queries
- Event table partitioned monthly with archival support
- Lazy preview generation with status tracking
- Bitmap indexes for boolean flags in high-cardinality queries

---

## Multi-Tenant Architecture

Every database entity includes an `organization_id` field. This enables:

1. **Single-org deployments** - Self-hosted installations have one default organization
2. **Multi-org SaaS** - Future hosted SaaS without schema migration
3. **Tenant isolation** - Enforced at query layer via Prisma middleware

### Tenant Isolation Approach

```prisma
// Middleware example (enforces in code)
prisma.$use(async (params, next) => {
  // Only allow queries with organization_id for multi-tenant tables
  if (MULTI_TENANT_MODELS.includes(params.model)) {
    if (params.args.where) {
      params.args.where.organization_id = getCurrentOrganizationId();
    }
  }
  return next(params);
});
```

### Security Implications

- All queries must include `organization_id` filter
- **Row-Level Security (RLS) is REQUIRED in production** for all org-scoped tables; OPTIONAL in local development (Docker Compose) for debugging convenience
- Admin users scoped to specific organizations
- API authentication includes organization context

### Row-Level Security (RLS) Requirements

**Tables with REQUIRED RLS policies in production:**

| Table             | Policy Type               | Context                                 |
| ----------------- | ------------------------- | --------------------------------------- |
| organizations     | SELECT via org membership | Users only see orgs they belong to      |
| users             | SELECT/UPDATE via org     | Users only see other users in their org |
| rooms             | SELECT via org            | Users only see rooms in their org       |
| documents         | SELECT via org            | Users only see documents in their org   |
| document_versions | SELECT via org            | Versions scoped to document's org       |
| folders           | SELECT via org            | Folders scoped to room's org            |
| permissions       | SELECT via org            | Perms only for own org resources        |
| events            | SELECT via org            | Audit logs scoped to org                |
| room_memberships  | SELECT via org            | Membership in own org only              |
| links             | SELECT via org            | Sharing links for own org's rooms       |
| audit_logs        | SELECT via org            | Logs scoped to org                      |
| watermark_configs | SELECT via org            | Watermarks scoped to org                |

**System-level tables (NO RLS required):**

- migrations
- feature_flags (global feature toggles)

---

## Entity Relationship Diagram

```
┌─────────────────┐
│   Organization  │ (multi-tenant root)
└────────┬────────┘
         │
    ┌────┴────────────────────────────────┬────────────┐
    │                                      │            │
┌───▼───────────┐              ┌──────────▼──┐  ┌──────▼────────┐
│     User      │              │   Room       │  │  RoomTemplate  │
└───┬───────────┘              └──────┬───────┘  └────────────────┘
    │                                 │
    │ (M2M join)                      │
    │                        ┌────────┼────────┐
    │  ┌──────────────────┐  │        │        │
    └─▶│UserOrganization  │  │        │        │
       └──────────────────┘  │        │        │
                             │        │        │
                        ┌────▼──┐ ┌──▼──┐ ┌───▼──────────┐
                        │Folder │ │Link │ │ Watermark    │
                        └────┬──┘ └──┬──┘ │ Configuration│
                             │       │    └──────────────┘
                        ┌────▼───────▼─┐
                        │  Document    │
                        └────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼────┐      ┌───────▼────────┐   ┌─────▼──────┐
    │Document │      │DocumentVersion │   │  Metadata  │
    │Version  │      └───────┬────────┘   └────────────┘
    └────┬────┘              │
         │         ┌─────────┼─────────┬──────────────┐
         │         │         │         │              │
    ┌────▼──┐  ┌───▼──┐ ┌───▼──────┐ ┌▼──────┐  ┌───▼──────────┐
    │FileBlob│  │Preview│ │Extracted│ │SearchIndex  │  │ Permission   │
    │        │  │Asset  │ │Text     │ │(denorm)     │  │ + RoleAssign │
    └────────┘  └───────┘ └─────────┘ └────────────┘  └───┬──────────┘
                                                           │
                                                      ┌────▼─────┐
                                                      │ Group     │
                                                      │ Membership│
                                                      └───────────┘

    ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
    │ LinkVisit      │  │ Notification │  │  Invitation  │
    │ ViewSession    │  │ Preference   │  │              │
    │ (analytics)    │  │              │  │              │
    └────────────────┘  └──────────────┘  └──────────────┘

    ┌──────────────────────────────────────────┐
    │ Event (partitioned by month)             │
    │ - Immutable audit log                    │
    │ - Tracks all state changes               │
    │ - Indexes for common queries             │
    └──────────────────────────────────────────┘

    ┌──────────────────────────────────────────┐
    │ NDA / Agreement Tracking                 │
    │ - NDA acceptance records                 │
    │ - Legally timestamped                    │
    └──────────────────────────────────────────┘
```

---

## Core Entities & Schema

### Organization (Multi-Tenant Root)

```prisma
model Organization {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  // Organization identity
  name                    String        @db.VarChar(255)
  slug                    String        @unique @db.VarChar(100) // For custom domains

  // Branding
  logoUrl                 String?       @db.VarChar(500) // URL to logo asset
  primaryColor            String        @default("#0066cc") @db.VarChar(7) // Hex color
  faviconUrl              String?       @db.VarChar(500)

  // Configuration
  isActive                Boolean       @default(true)
  allowSelfSignup         Boolean       @default(false) // MVP: admin-only
  dataResidency           String        @default("us") @db.VarChar(50) // us, eu, etc. - Future: F053

  // Retention & compliance
  eventRetentionDays      Int           @default(365) // Archive events after this period
  trashRetentionDays      Int           @default(30)  // Auto-delete from trash
  maxStorageBytes         BigInt?       // null = unlimited

  // Email configuration
  smtpHost                String?       @db.VarChar(255)
  smtpPort                Int           @default(587)
  smtpFromEmail           String?       @db.VarChar(255)

  // Relations
  users                   UserOrganization[]
  rooms                   Room[]
  roomTemplates           RoomTemplate[]
  documents               Document[]
  documentVersions        DocumentVersion[]
  events                  Event[]
  invitations             Invitation[]
  permissions             Permission[]
  groups                  Group[]
  links                   Link[]
  ndaRecords              NDARecord[]
  searchIndexes           SearchIndex[]

  @@index([slug])
  @@index([isActive])
}
```

### User (Identity & Authentication)

```prisma
model User {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  // Authentication
  email                   String        @unique @db.VarChar(255)
  passwordHash            String        @db.VarChar(255)

  // Profile
  firstName               String        @db.VarChar(100)
  lastName                String        @db.VarChar(100)

  // Session & security
  lastLoginAt             DateTime?
  emailVerifiedAt         DateTime?
  totpSecret              String?       // TOTP secret for 2FA - F026

  // Account status
  isActive                Boolean       @default(true)

  // Relations
  organizations           UserOrganization[]
  permissions             Permission[]
  roleAssignments         RoleAssignment[]
  groupMemberships        GroupMembership[]
  sessions                ViewSession[]
  invitations             Invitation[]
  apiKeys                 ApiKey[]      // F135: API key management

  @@index([email])
  @@index([isActive])
}
```

### UserOrganization (Multi-Tenant User-Org Mapping)

```prisma
model UserOrganization {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String
  userId                  String

  // Role: admin or viewer (primary role)
  role                    UserRole      @default(VIEWER) // ADMIN, VIEWER

  // Permissions
  isActive                Boolean       @default(true)
  canManageUsers          Boolean       @default(false)
  canManageRooms          Boolean       @default(false)
  canManageBilling        Boolean       @default(false)

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  notificationPreferences NotificationPreference[]

  @@unique([organizationId, userId])
  @@index([organizationId])
  @@index([userId])
  @@index([role])
}
```

### Room (Data Room Container)

```prisma
model Room {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping

  // Identity
  name                    String        @db.VarChar(255)
  description             String?       @db.Text
  slug                    String        @db.VarChar(100) // URL-friendly identifier

  // Lifecycle - F108
  status                  RoomStatus    @default(DRAFT)
  // DRAFT: not accessible to viewers
  // ACTIVE: normal operation
  // ARCHIVED: read-only
  // CLOSED: no viewer access

  // Access control
  requiresPassword        Boolean       @default(false)
  passwordHash            String?       @db.VarChar(255)
  requiresEmailVerification Boolean     @default(true)
  requiresNda             Boolean       @default(false) // F018

  // Settings - F130
  allowDownloads          Boolean       @default(true)
  allowPrinting           Boolean       @default(false) // F015: V1
  enableWatermark         Boolean       @default(false) // F023: V1
  defaultExpiryDays       Int?          // null = no default expiry

  // Lifecycle tracking
  archivedAt              DateTime?
  closedAt                DateTime?

  // Statistics (denormalized)
  totalDocuments          Int           @default(0)
  totalFolders            Int           @default(0)
  totalViews              Int           @default(0)
  totalViewers            Int           @default(0)

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdByUserId         String?       // Track who created room
  templateId              String?       // Based on template - F109

  folders                 Folder[]
  documents               Document[]
  links                   Link[]
  permissions             Permission[]
  events                  Event[]
  watermarkConfig         WatermarkConfig?
  linkVisits              LinkVisit[]
  viewSessions            ViewSession[]
  ndaRecords              NDARecord[]
  legalHolds              LegalHold[]   // F157: Legal hold support

  @@unique([organizationId, slug])
  @@index([organizationId])
  @@index([status])
  @@index([createdAt])
  @@index([archivedAt])
  @@index([closedAt])
}
```

### Folder (Hierarchical Structure)

```prisma
model Folder {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  roomId                  String

  // Hierarchy - F010, F111: drag-drop reordering
  parentId                String?       // null = root folder
  name                    String        @db.VarChar(255)
  displayOrder            Int           @default(0) // For ordering in UI

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room                    Room          @relation(fields: [roomId], references: [id], onDelete: Cascade)
  parent                  Folder?       @relation("FolderHierarchy", fields: [parentId], references: [id], onDelete: Cascade)
  children                Folder[]      @relation("FolderHierarchy")

  documents               Document[]
  permissions             Permission[]
  events                  Event[]

  @@unique([roomId, parentId, name]) // Unique folder names per parent
  @@index([organizationId])
  @@index([roomId])
  @@index([parentId])
}
```

### Document (Document Metadata & Container)

```prisma
model Document {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  roomId                  String
  folderId                String?       // null = room root

  // Identity & version tracking
  name                    String        @db.VarChar(500) // Original filename
  displayOrder            Int           @default(0)     // For ordering - F111
  status                  DocumentStatus @default(ACTIVE)
  // ACTIVE: normal operation
  // ARCHIVED: hidden from viewers
  // DELETED: soft-deleted (in trash)

  // File information
  mimeType                String        @db.VarChar(100) // e.g., "application/pdf"
  fileSize                BigInt        // Bytes, for storage quota tracking
  originalFileName        String        @db.VarChar(500) // Name on upload

  // Versioning - F002
  currentVersionId        String?       // Current version (denormalized for performance)
  totalVersions           Int           @default(0)

  // Indexing - F010
  batesNumber             String?       @db.VarChar(20) // Optional Bates number
  batesStartNumber        Int?          // For auto-numbering ranges

  // Tagging & metadata - F110
  tags                    String[]      @default([]) // Searchable tags
  customMetadata          Json?         // Key-value pairs: {"contract_type": "NDA", "region": "EMEA"}

  // Access control
  expiryDate              DateTime?     // F012: V1 document expiry
  allowDownload           Boolean       @default(true) // F014
  allowPrint              Boolean       @default(false) // F015: V1

  // Analytics
  viewCount               Int           @default(0)
  uniqueViewerCount       Int           @default(0)
  lastViewedAt            DateTime?
  downloadCount           Int           @default(0)

  // Soft delete tracking
  deletedAt               DateTime?     // For trash - F114

  // Legal hold - F157
  onLegalHold             Boolean       @default(false)
  legalHoldId             String?

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room                    Room          @relation(fields: [roomId], references: [id], onDelete: Cascade)
  folder                  Folder?       @relation(fields: [folderId], references: [id], onDelete: SetNull)

  versions                DocumentVersion[]
  permissions             Permission[]
  events                  Event[]
  searchIndexes           SearchIndex[]
  linkVisits              LinkVisit[]
  viewSessions            ViewSession[]
  redactions              DocumentRedaction[] // F145: V2 redaction
  legalHold               LegalHold?    @relation(fields: [legalHoldId], references: [id])

  @@unique([organizationId, id])
  @@index([organizationId])
  @@index([roomId])
  @@index([folderId])
  @@index([status])
  @@index([batesNumber])
  @@index([expiryDate])
  @@index([deletedAt])
  @@index([onLegalHold])
  @@fulltext([name, tags]) // PostgreSQL full-text search
}
```

### DocumentVersion (Immutable Snapshots)

```prisma
model DocumentVersion {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  documentId              String

  // Version tracking
  versionNumber           Int           // 1, 2, 3, ... auto-increment per document
  uploadedByUserId        String?       // Who uploaded this version
  uploadedByEmail         String?       @db.VarChar(255) // Denormalized for audit
  changeDescription       String?       @db.Text // "Updated pricing schedule"

  // File information
  mimeType                String        @db.VarChar(100)
  fileSize                BigInt        // Bytes
  fileName                String        @db.VarChar(500)

  // Integrity - F106: Hash chain for tamper detection
  // Each version's hash includes the parent hash: H(versionNumber || fileContent || parentHash)
  fileSha256              String        @db.VarChar(64) // Original file SHA-256
  versionHash             String        @db.VarChar(64) // Hash of this version (includes parent)
  parentVersionHash       String?       @db.VarChar(64) // Previous version's hash (null for first)

  // Preview generation status - F101
  previewStatus           PreviewStatus @default(PENDING)
  // PENDING: queued for generation
  // PROCESSING: currently generating
  // READY: previews available
  // FAILED: generation failed
  previewError            String?       @db.Text // Error message if generation failed
  previewGeneratedAt      DateTime?

  // Scan status - F107
  scanStatus              ScanStatus    @default(PENDING)
  // PENDING: queued for scan
  // SCANNING: currently scanning
  // CLEAN: passed scan
  // INFECTED: flagged as malware
  // ERROR: scan failed with error
  scanError               String?       @db.Text
  scannedAt               DateTime?

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  document                Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)
  uploadedByUser          User?         @relation(fields: [uploadedByUserId], references: [id], onDelete: SetNull)

  fileBlob                FileBlob?
  previewAssets           PreviewAsset[]
  extractedText           ExtractedText?
  searchIndexes           SearchIndex[]

  @@unique([documentId, versionNumber]) // One version per number per document
  @@index([organizationId])
  @@index([documentId])
  @@index([previewStatus])
  @@index([scanStatus])
  @@index([createdAt])
}
```

### FileBlob (Original File Storage Reference)

```prisma
model FileBlob {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  organizationId          String        // Multi-tenant scoping
  versionId               String        @unique // One blob per version

  // Storage reference
  storageKey              String        @db.VarChar(500) // Path in storage provider: "org-123/rooms/room-456/docs/doc-789/v1.pdf"
  storageBucket           String        @db.VarChar(100) @default("documents")

  // Encryption - F120: Optional document-level encryption
  isEncrypted             Boolean       @default(false)
  encryptionKey           String?       @db.VarChar(500) // Encrypted key material or KMS reference
  encryptionAlgorithm     String?       @db.VarChar(50)   // "aes-256-gcm"

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  version                 DocumentVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([storageKey])
}
```

### PreviewAsset (Generated Previews & Thumbnails)

```prisma
model PreviewAsset {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  versionId               String

  // Preview type
  assetType               PreviewAssetType @default(PDF)
  // PDF: Full document converted to PDF
  // THUMBNAIL: Page thumbnail (120x160)
  // RENDER: High-res preview (1024x1024)

  // Page/variant information
  pageNumber              Int?          // null for whole-document assets
  variantDpi              Int           @default(96) // Resolution

  // Storage reference
  storageKey              String        @db.VarChar(500) // Path in storage provider
  mimeType                String        @db.VarChar(100) // Usually "application/pdf" or "image/jpeg"
  fileSizeBytes           BigInt

  // Dimensions for rendering
  width                   Int?          // pixels
  height                  Int?          // pixels

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  version                 DocumentVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([versionId])
  @@index([assetType])
  @@index([pageNumber])
}
```

### ExtractedText (Full-Text Content)

```prisma
model ExtractedText {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  versionId               String        @unique

  // Full extracted text
  plainText               String        @db.Text // Raw OCR/extraction output

  // Language detection
  detectedLanguage        String?       @db.VarChar(10) // "en", "fr", etc.
  confidence              Float?        // 0.0 to 1.0

  // Redaction support - F145: V2
  hasRedactions           Boolean       @default(false)
  redactedText            String?       @db.Text // Text with redactions applied

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  version                 DocumentVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([versionId])
  @@index([detectedLanguage])
}
```

### SearchIndex (Denormalized Search Data)

```prisma
model SearchIndex {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  documentId              String
  versionId               String

  // Searchable content - F011
  documentTitle           String        @db.VarChar(500)
  extractedText           String        @db.Text // Full text for FTS
  fileName                String        @db.VarChar(500)

  // Metadata for search
  tags                    String[]      @default([])
  customMetadata          Json?
  mimeType                String        @db.VarChar(100)
  uploadedAt              DateTime

  // Vector embedding for semantic search - F076: V2
  vectorEmbedding         String?       @db.Text // JSON array of floats, e.g., "[0.123, 0.456, ...]"
  embeddingModel          String?       @db.VarChar(100) // "openai-3-small", "anthropic-embed", etc.

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  document                Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)
  version                 DocumentVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@unique([organizationId, versionId])
  @@index([organizationId])
  @@index([documentId])
  @@index([versionId])
  @@fulltext([extractedText, tags]) // PostgreSQL full-text search
}
```

### Link (Shareable Access Links)

```prisma
model Link {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  roomId                  String
  createdByUserId         String?       // Who created this link

  // Link identity
  slug                    String        @unique @db.VarChar(50) // URL-friendly: "share-abc123"
  name                    String?       @db.VarChar(255) // Display name for link
  description             String?       @db.Text

  // Access permissions - F116
  permission              LinkPermission @default(VIEW)
  // VIEW: read-only access
  // DOWNLOAD: can download
  // PRINT: can print
  // SIGN: can sign documents (F045+)

  // Link-level access control
  requiresPassword        Boolean       @default(false)
  passwordHash            String?       @db.VarChar(255)

  requiresEmailVerification Boolean     @default(false)
  allowedEmails           String[]      @default([]) // Whitelist of emails, empty = allow all

  // Expiry - F116
  expiresAt               DateTime?     // null = no expiry
  maxViews                Int?          // null = unlimited
  viewCount               Int           @default(0) // Increment on each view

  // Scope: what documents are accessible via this link
  scope                   LinkScope     @default(ENTIRE_ROOM)
  // ENTIRE_ROOM: all documents in room
  // FOLDER: specific folder
  // DOCUMENT: single document

  scopedFolderId          String?       // For FOLDER scope
  scopedDocumentId        String?       // For DOCUMENT scope

  // Status
  isActive                Boolean       @default(true)

  // Analytics - F121, F027
  lastAccessedAt          DateTime?

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room                    Room          @relation(fields: [roomId], references: [id], onDelete: Cascade)
  createdByUser           User?         @relation(fields: [createdByUserId], references: [id], onDelete: SetNull)

  visits                  LinkVisit[]

  @@unique([organizationId, slug])
  @@index([organizationId])
  @@index([roomId])
  @@index([expiresAt])
  @@index([viewCount])
  @@index([isActive])
}
```

### LinkVisit (Link-Level Analytics)

```prisma
model LinkVisit {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  organizationId          String        // Multi-tenant scoping
  linkId                  String
  roomId                  String
  documentId              String?       // null if viewing room/folder

  // Visitor identification
  visitorEmail            String?       @db.VarChar(255)
  visitorIdentifier       String?       @db.VarChar(100) // Anonymous hash if not email-verified

  // Session information
  viewSessionId           String?       // Link to detailed session

  // Metrics - F027
  timeSpentSeconds        Int           @default(0)
  pagesViewed             Int           @default(1) // Number of pages viewed in doc

  // Device & location - F119: V2 device fingerprinting
  ipAddress               String?       @db.VarChar(50)
  userAgent               String?       @db.Text
  countryCode             String?       @db.VarChar(2) // GeoIP

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  link                    Link          @relation(fields: [linkId], references: [id], onDelete: Cascade)
  room                    Room          @relation(fields: [roomId], references: [id], onDelete: Cascade)
  document                Document?     @relation(fields: [documentId], references: [id], onDelete: SetNull)
  session                 ViewSession?  @relation(fields: [viewSessionId], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([linkId])
  @@index([roomId])
  @@index([documentId])
  @@index([visitorEmail])
  @@index([createdAt])
}
```

### ViewSession (Detailed Viewer Activity)

```prisma
model ViewSession {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  roomId                  String
  userId                  String?       // null for anonymous link access
  linkId                  String?       // null for authenticated access

  // Session identification
  sessionToken            String        @unique @db.VarChar(255) // For session validation

  // Visitor info
  visitorEmail            String?       @db.VarChar(255)
  visitorName             String?       @db.VarChar(255)

  // Activity tracking
  lastActivityAt          DateTime      @updatedAt
  totalTimeSpentSeconds   Int           @default(0)

  // Device info - F119: V2
  ipAddress               String?       @db.VarChar(50)
  userAgent               String?       @db.Text
  deviceFingerprint       String?       @db.VarChar(255) // Hash of device characteristics

  // Access flags
  isActive                Boolean       @default(true)

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room                    Room          @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user                    User?         @relation(fields: [userId], references: [id], onDelete: SetNull)
  link                    Link?         @relation(fields: [linkId], references: [id], onDelete: SetNull) // Typo fix: was 'relations'

  visits                  LinkVisit[]
  events                  Event[]

  @@unique([organizationId, sessionToken])
  @@index([organizationId])
  @@index([roomId])
  @@index([userId])
  @@index([linkId])
  @@index([lastActivityAt])
  @@index([isActive])
}
```

### Permission (RBAC: Document/Folder-Level ACLs)

```prisma
model Permission {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping

  // What resource is this permission on?
  resourceType            PermissionResourceType
  // ROOM, FOLDER, DOCUMENT

  roomId                  String?
  folderId                String?
  documentId              String?

  // Who gets this permission?
  granteeType             PermissionGranteeType
  // USER: single user
  // GROUP: group of users
  // ROLE: default role for new users
  // PUBLIC: everyone with link

  userId                  String?
  groupId                 String?

  // What can they do?
  permissionLevel         PermissionLevel
  // NONE: explicitly denied
  // VIEW: read-only
  // DOWNLOAD: can download
  // COMMENT: can comment (F115: admin annotations)
  // SIGN: can sign (F045+)
  // ADMIN: full control

  // Inheritance
  inheritFromParent       Boolean       @default(true) // Automatically inherit parent folder permissions

  // Time-based access - F022: V1
  expiresAt               DateTime?

  // Status
  isActive                Boolean       @default(true)

  // Audit trail
  grantedByUserId         String?
  grantedAt               DateTime      @default(now())

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room                    Room?         @relation(fields: [roomId], references: [id], onDelete: Cascade)
  folder                  Folder?       @relation(fields: [folderId], references: [id], onDelete: Cascade)
  document                Document?     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user                    User?         @relation(fields: [userId], references: [id], onDelete: Cascade)
  group                   Group?        @relation(fields: [groupId], references: [id], onDelete: Cascade)
  grantedByUser           User?         @relation("GrantedBy", fields: [grantedByUserId], references: [id], onDelete: SetNull)

  @@unique([organizationId, resourceType, roomId, folderId, documentId, granteeType, userId, groupId])
  @@index([organizationId])
  @@index([resourceType])
  @@index([userId])
  @@index([groupId])
  @@index([expiresAt])
  @@index([isActive])
}
```

### RoleAssignment (Explicit Role Mappings)

```prisma
model RoleAssignment {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  userId                  String

  // Role
  role                    UserRole      // ADMIN, VIEWER

  // Scope
  scopeType               RoleScopeType
  // ORGANIZATION: admin/viewer for entire org
  // ROOM: admin for specific room

  roomId                  String?       // For ROOM scope

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId, scopeType, roomId])
  @@index([organizationId])
  @@index([userId])
  @@index([role])
}
```

### Group (User Groups for Batch Permissions)

```prisma
model Group {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping

  // Group identity
  name                    String        @db.VarChar(255)
  description             String?       @db.Text

  // External organization - F158: V1
  externalOrganization    String?       @db.VarChar(255) // e.g., "Goldman Sachs", "PwC"

  // Status
  isActive                Boolean       @default(true)

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  memberships             GroupMembership[]
  permissions             Permission[]

  @@unique([organizationId, name])
  @@index([organizationId])
  @@index([externalOrganization])
}
```

### GroupMembership (User-Group Mapping)

```prisma
model GroupMembership {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  groupId                 String
  userId                  String

  // Relations
  group                   Group         @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([groupId, userId])
  @@index([groupId])
  @@index([userId])
}
```

### Event (Immutable Audit Trail - Partitioned by Month)

```prisma
model Event {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now()) // Partition key

  organizationId          String        // Multi-tenant scoping

  // Event identification
  eventType               EventType     // USER_LOGIN, DOCUMENT_UPLOADED, etc.

  // Actor information
  actorType               ActorType     // ADMIN, VIEWER, SYSTEM
  actorId                 String?       // User ID or system identifier (null for system events)
  actorEmail              String?       @db.VarChar(255) // Denormalized for audit reports

  // Resource being changed
  roomId                  String?
  folderId                String?
  documentId              String?

  // Request/Session tracking - F102: for grouping events
  requestId               String?       @db.VarChar(100) // Track request across multiple events
  sessionId               String?       @db.VarChar(100) // View session or auth session

  // Details
  description             String?       @db.Text

  // Event-specific data as JSON
  metadata                Json?         // Flexible: {"oldValue": "DRAFT", "newValue": "ACTIVE", ...}

  // Network information
  ipAddress               String?       @db.VarChar(50)
  userAgent               String?       @db.Text

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room                    Room?         @relation(fields: [roomId], references: [id], onDelete: SetNull)
  actor                   User?         @relation(fields: [actorId], references: [id], onDelete: SetNull)
  viewSession             ViewSession?  @relation(fields: [sessionId], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([eventType])
  @@index([actorId])
  @@index([roomId])
  @@index([documentId])
  @@index([createdAt]) // Critical for range queries
  @@index([requestId])
  @@index([sessionId])

  // Partition hint for PostgreSQL: monthly partition on createdAt
  // See "Partitioning Strategy" section
}
```

### WatermarkConfig (Dynamic Watermarking - F023: V1)

```prisma
model WatermarkConfig {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  roomId                  String        @unique

  // Watermark content
  showViewerEmail         Boolean       @default(true)
  showViewerName          Boolean       @default(true)
  showViewerIp            Boolean       @default(false)
  showTimestamp           Boolean       @default(true)
  showRoomName            Boolean       @default(false)
  customText              String?       @db.VarChar(255) // e.g., "CONFIDENTIAL - INTERNAL ONLY"

  // Watermark styling
  opacity                 Float         @default(0.15) // 0.0 to 1.0
  fontSize                Int           @default(48)   // Points
  angle                   Float         @default(-45)  // Degrees (-90 to 90)
  color                   String        @default("#cccccc") @db.VarChar(7) // Hex

  // Placement
  placement               WatermarkPlacement @default(DIAGONAL)
  // DIAGONAL: diagonal across page
  // FOOTER: bottom of page
  // HEADER: top of page
  // CORNER: top-right corner

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room                    Room          @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([roomId])
}
```

### RoomTemplate (Room Templates - F109)

```prisma
model RoomTemplate {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping

  // Template identity
  name                    String        @db.VarChar(255) // "M&A Due Diligence", "Investor Data Room"
  description             String?       @db.Text
  category                String        @db.VarChar(100) // "mna", "investor", "board", "compliance", "custom"
  isSystemTemplate        Boolean       @default(false) // System-provided vs. user-created
  isPublic                Boolean       @default(false) // Can other orgs use?

  // Template structure
  folderStructure         Json          // Nested folder spec: [{"name": "Financial", "children": [...]}, ...]
  defaultPermissions      Json?         // Default permission schema
  defaultSettings         Json?         // Default room settings: {allowDownloads: true, ...}

  // Checklist template - F123: V1 due diligence checklists
  checklistTemplate       Json?         // Checklist items structure

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([category])
  @@index([isSystemTemplate])
}
```

### Notification (User Notifications)

```prisma
model Notification {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  organizationId          String        // Multi-tenant scoping
  userOrganizationId      String        // Reference to user in org

  // Notification content
  type                    NotificationType
  // VIEW_ACTIVITY: someone viewed a document
  // UPLOAD_COMPLETE: document upload finished
  // NDA_PENDING: NDA needs signature
  // LINK_ACCESSED: link was accessed
  // ADMIN_ACTION: admin took an action

  title                   String        @db.VarChar(255)
  message                 String        @db.Text

  // Resource reference
  roomId                  String?
  documentId              String?
  linkId                  String?

  // Status
  isRead                  Boolean       @default(false)

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  userOrganization        UserOrganization @relation(fields: [userOrganizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([userOrganizationId])
  @@index([isRead])
  @@index([createdAt])
}
```

### NotificationPreference (User Notification Settings - F043)

```prisma
model NotificationPreference {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  userOrganizationId      String        @unique

  // Email preferences
  emailOnDocumentViewed   Boolean       @default(true)
  emailOnDocumentUploaded Boolean       @default(true)
  emailOnAccessRevoked    Boolean       @default(true)
  emailDailyDigest        Boolean       @default(false) // F122: V1 activity digest

  // Notification frequency
  digestFrequency         DigestFrequency @default(DAILY) // IMMEDIATE, DAILY, WEEKLY

  // Do not disturb
  quietHoursStart         String?       @db.VarChar(5) // "18:00"
  quietHoursEnd           String?       @db.VarChar(5) // "08:00"

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  userOrganization        UserOrganization @relation(fields: [userOrganizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
}
```

### Invitation (Team Member Invitations - F044)

```prisma
model Invitation {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping

  // Invite details
  email                   String        @db.VarChar(255)
  role                    UserRole      @default(VIEWER) // ADMIN, VIEWER

  // Status
  status                  InvitationStatus @default(PENDING)
  // PENDING: sent, awaiting acceptance
  // ACCEPTED: user created account
  // EXPIRED: invitation link expired
  // REJECTED: user declined

  expiresAt               DateTime      // Invitation link expires after 30 days
  acceptedAt              DateTime?

  // Link
  invitationToken         String        @unique @db.VarChar(255)
  invitationUrl           String        @db.VarChar(500) // Full URL for email

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedByUser           User?         @relation(fields: [invitedByUserId], references: [id], onDelete: SetNull)
  invitedByUserId         String?

  @@index([organizationId])
  @@index([email])
  @@index([status])
  @@index([expiresAt])
}
```

### NDARecord (NDA/Agreement Tracking - F018: V1, F055: V1)

```prisma
model NDARecord {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  organizationId          String        // Multi-tenant scoping
  roomId                  String

  // Visitor information
  visitorEmail            String        @db.VarChar(255)
  visitorName             String?       @db.VarChar(255)
  visitorIp               String?       @db.VarChar(50)

  // Agreement details
  agreementVersion        String        @db.VarChar(50) // v1.0, v1.1, etc.
  agreementText           String        @db.Text        // Actual agreement text accepted

  // Acceptance - legally timestamped - F055
  acceptedAt              DateTime
  acceptanceTimestamp     String?       @db.VarChar(255) // Cryptographic timestamp from service like Notarize

  // Status
  isActive                Boolean       @default(true)
  revokedAt               DateTime?

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room                    Room          @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@unique([roomId, visitorEmail])
  @@index([organizationId])
  @@index([roomId])
  @@index([visitorEmail])
  @@index([acceptedAt])
}
```

### LegalHold (Legal Hold - F157: V1)

```prisma
model LegalHold {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping

  // Hold scope
  scopeType               LegalHoldScope
  // DOCUMENT: single document
  // ROOM: entire room

  documentId              String?       // For DOCUMENT scope
  roomId                  String?       // For ROOM scope

  // Hold details
  reason                  String        @db.VarChar(500) // "Litigation: Case 2024-12345"
  holdingOfficer          String        @db.VarChar(255) // Person responsible
  externalReference       String?       @db.VarChar(255) // External case/reference number

  // Status
  isActive                Boolean       @default(true)
  releasedAt              DateTime?

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  document                Document?     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  room                    Room?         @relation(fields: [roomId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([documentId])
  @@index([roomId])
  @@index([isActive])
}
```

### DocumentRedaction (Document Redaction - F145: V2)

```prisma
model DocumentRedaction {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  documentId              String

  // Redaction details
  reason                  String        @db.VarChar(500) // e.g., "PII", "Trade Secret", "Attorney-Client"
  redactionCoordinates    Json          // Array of {page, x, y, width, height, reason}

  // Version tracking
  redactedVersionId       String?       // Link to redacted version if stored separately

  // Status
  isActive                Boolean       @default(true)
  appliedAt               DateTime?

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  document                Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([documentId])
}
```

### ApiKey (API Key Management - F135: V1)

```prisma
model ApiKey {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  organizationId          String        // Multi-tenant scoping
  userId                  String

  // Key details
  name                    String        @db.VarChar(255) // "Integration: Salesforce"
  description             String?       @db.Text

  // The actual secret
  keyHash                 String        @db.VarChar(255) // Never store plaintext
  keyPrefix               String        @db.VarChar(20)  // e.g., "drp_abc123..." for UI display

  // Permissions - scoped access
  permissions             String[]      @default([]) // ["documents:read", "rooms:list", "files:download"]

  // Expiry
  expiresAt               DateTime?
  isActive                Boolean       @default(true)

  // Audit
  lastUsedAt              DateTime?
  usageCount              Int           @default(0)

  // Relations
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([userId])
  @@index([isActive])
}
```

---

## Enum Types

All enums map to PostgreSQL enum types for data integrity.

```prisma
// User roles - F004
enum UserRole {
  ADMIN   // Can manage users, rooms, organization settings
  VIEWER  // Can access documents via links
}

// Room lifecycle - F108
enum RoomStatus {
  DRAFT    // Not accessible to viewers
  ACTIVE   // Normal operation
  ARCHIVED // Read-only
  CLOSED   // Deny all viewer access
}

// Document lifecycle
enum DocumentStatus {
  ACTIVE    // Normal operation
  ARCHIVED  // Hidden from viewers but maintained
  DELETED   // Soft-deleted (in trash)
}

// Event types - F102: comprehensive audit trail
enum EventType {
  // Organization
  ORGANIZATION_CREATED
  ORGANIZATION_UPDATED
  ORGANIZATION_DELETED

  // Users & authentication
  USER_CREATED
  USER_INVITED
  USER_ACCEPTED_INVITATION
  USER_LOGIN
  USER_LOGOUT
  USER_UPDATED
  USER_DELETED
  USER_2FA_ENABLED
  USER_2FA_DISABLED

  // Rooms
  ROOM_CREATED
  ROOM_UPDATED
  ROOM_STATUS_CHANGED  // DRAFT -> ACTIVE, etc.
  ROOM_ARCHIVED
  ROOM_CLOSED
  ROOM_DUPLICATED
  ROOM_DELETED

  // Documents
  DOCUMENT_UPLOADED
  DOCUMENT_VERSION_CREATED
  DOCUMENT_UPDATED
  DOCUMENT_METADATA_UPDATED
  DOCUMENT_MOVED
  DOCUMENT_TAGGED
  DOCUMENT_ARCHIVED
  DOCUMENT_DELETED
  DOCUMENT_RESTORED
  DOCUMENT_SCANNED         // Malware scan
  DOCUMENT_REDACTED        // F145: V2

  // Access control
  PERMISSION_GRANTED
  PERMISSION_REVOKED
  PERMISSION_UPDATED
  LINK_CREATED
  LINK_REVOKED
  LINK_ACCESSED
  LINK_PASSWORD_VERIFIED
  NDA_ACCEPTED             // F018: V1
  ACCESS_REQUEST_CREATED   // F118: V1

  // Analytics
  DOCUMENT_VIEWED
  DOCUMENT_DOWNLOADED
  DOCUMENT_PRINTED
  PAGE_VIEWED

  // Signatures - F045+: V2
  SIGNATURE_REQUESTED
  SIGNATURE_COMPLETED
  SIGNATURE_DECLINED

  // Admin actions
  ADMIN_SETTING_CHANGED
  ADMIN_EXPORT_INITIATED

  // System
  SYSTEM_BACKUP_STARTED
  SYSTEM_BACKUP_COMPLETED
  SYSTEM_JOB_FAILED
}

// Actor type - who triggered the event
enum ActorType {
  ADMIN   // Admin user action
  VIEWER  // Viewer/external user action
  SYSTEM  // Automated system action (job, background task)
}

// Link permissions - F116
enum LinkPermission {
  VIEW     // Read-only
  DOWNLOAD // Can download
  PRINT    // Can print (F015: V1)
  SIGN     // Can sign (F045+: V2)
}

// Link scope - what's accessible via link
enum LinkScope {
  ENTIRE_ROOM
  FOLDER
  DOCUMENT
}

// Preview generation status - F101
enum PreviewStatus {
  PENDING     // Queued for generation
  PROCESSING  // Currently generating
  READY       // Previews available
  FAILED      // Generation failed
}

// Malware scan status - F107
enum ScanStatus {
  PENDING   // Queued for scan
  SCANNING  // Currently scanning
  CLEAN     // Passed scan
  INFECTED  // Flagged as malware
  ERROR     // Scan failed with error
}

// Preview asset type - F101
enum PreviewAssetType {
  PDF        // Full document PDF
  THUMBNAIL  // Small page preview (120x160)
  RENDER     // High-res preview (1024x1024)
}

// Permission resource types
enum PermissionResourceType {
  ROOM
  FOLDER
  DOCUMENT
}

// Permission grantee types
enum PermissionGranteeType {
  USER
  GROUP
  ROLE
  PUBLIC  // For link-based access
}

// Permission levels - granular control
enum PermissionLevel {
  NONE      // Explicitly denied
  VIEW      // Read-only
  DOWNLOAD  // Can download
  COMMENT   // Can comment (F115: admin annotations)
  SIGN      // Can sign (F045+: V2)
  ADMIN     // Full control on resource
}

// Role scope - who can a role apply to
enum RoleScopeType {
  ORGANIZATION // Admin/viewer for entire org
  ROOM         // Admin for specific room only
}

// Watermark placement - F023: V1
enum WatermarkPlacement {
  DIAGONAL // Diagonal across page
  FOOTER   // Bottom of page
  HEADER   // Top of page
  CORNER   // Top-right corner
}

// Notification types
enum NotificationType {
  VIEW_ACTIVITY      // Someone viewed a document
  UPLOAD_COMPLETE    // Document upload finished
  NDA_PENDING        // NDA needs signature
  LINK_ACCESSED      // Link was accessed
  ADMIN_ACTION       // Admin took an action
  DIGEST             // Daily/weekly digest
}

// Notification frequency - F122: V1
enum DigestFrequency {
  IMMEDIATE
  DAILY
  WEEKLY
}

// Invitation status
enum InvitationStatus {
  PENDING   // Sent, awaiting acceptance
  ACCEPTED  // User created account
  EXPIRED   // Invitation link expired
  REJECTED  // User declined
}

// Legal hold scope - F157: V1
enum LegalHoldScope {
  DOCUMENT  // Single document
  ROOM      // Entire room
}
```

---

## Index Strategy

### Multi-Tenant Query Pattern

All indexes on multi-tenant tables include `organization_id` as the first column:

```prisma
// ✓ GOOD: Scopes to organization first
@@index([organizationId, userId])
@@index([organizationId, roomId, status])

// ✗ AVOID: Doesn't scope to organization
@@index([userId])
@@index([status])
```

### Common Index Patterns

1. **Foreign key with organization scoping**

   ```prisma
   // Every FK relationship should include organization_id
   @@index([organizationId, userId])
   @@index([organizationId, roomId])
   ```

2. **Status flags**

   ```prisma
   // For filtering active/archived/deleted records
   @@index([organizationId, status])
   @@index([organizationId, isActive])
   @@index([organizationId, deletedAt]) // For soft deletes
   ```

3. **Timestamp ranges**

   ```prisma
   // For audit queries, analytics
   @@index([organizationId, createdAt])
   @@index([organizationId, updatedAt])
   ```

4. **Full-text search**

   ```prisma
   // PostgreSQL full-text search indexes
   @@fulltext([name, tags])
   @@fulltext([extractedText])
   ```

5. **Unique constraints are automatically indexed**
   ```prisma
   @@unique([organizationId, slug])
   ```

### High-Cardinality Indexes

Partial indexes for boolean flags to avoid bloating the index:

```sql
-- After migration applied, add partial indexes via raw SQL
CREATE INDEX idx_document_active ON "Document" (organization_id, id) WHERE status = 'ACTIVE';
CREATE INDEX idx_room_active ON "Room" (organization_id, id) WHERE status = 'ACTIVE';
CREATE INDEX idx_user_active ON "User" (id) WHERE "isActive" = true;
```

### Full-Text Search Indexes

PostgreSQL full-text search on Document and SearchIndex:

```sql
-- Document table
CREATE INDEX idx_document_fts ON "Document" USING GIN (to_tsvector('english', name || ' ' || COALESCE(array_to_string(tags, ' '), '')));

-- SearchIndex table (primary search table)
CREATE INDEX idx_searchindex_fts ON "SearchIndex" USING GIN (to_tsvector('english', "extractedText"));
```

---

## Cross-Tenant Referential Integrity

### Composite Foreign Key Pattern

Relations are scoped by `organizationId` conceptually, but must be enforced **at the database level** via composite foreign key constraints. This prevents a document in org-A from referencing a room in org-B through the database layer, not just application logic.

**Critical Principle:** Every cross-organization relation (foreign key) MUST include both `organizationId` and the entity ID in the constraint.

### Pattern: Composite Unique + Composite FK

All tables with FKs to other org-scoped tables must follow this pattern:

1. **Target table has composite unique on (organizationId, id)**

   ```prisma
   model Room {
     id             String
     organizationId String

     @@unique([organizationId, id]) // Composite unique for FK targets
   }
   ```

2. **Source table references the composite unique**

   ```prisma
   model Document {
     id             String
     roomId         String
     organizationId String

     // FK enforces BOTH roomId AND organizationId match
     room           Room @relation(fields: [organizationId, roomId], references: [organizationId, id])

     @@unique([organizationId, id]) // Also composite unique for downstream FKs
   }
   ```

### Relations Requiring Composite FK Enforcement

All of the following must use composite FKs with org enforcement:

| Source          | Target   | Fields                       | Rationale                                              |
| --------------- | -------- | ---------------------------- | ------------------------------------------------------ |
| Document        | Room     | (organizationId, roomId)     | Prevents doc in org-A from linking to room in org-B    |
| DocumentVersion | Document | (organizationId, documentId) | Enforces version belongs to correct org's doc          |
| Folder          | Room     | (organizationId, roomId)     | Prevents folder in org-A from scoping to room in org-B |
| Permission      | Room     | (organizationId, roomId)     | Prevents perm in org-A granting access to org-B room   |
| Permission      | Document | (organizationId, documentId) | Prevents perm in org-A granting access to org-B doc    |
| RoomMembership  | Room     | (organizationId, roomId)     | Enforces membership is for correct org's room          |
| Event           | Room     | (organizationId, roomId)     | Audit events match room's org                          |
| Event           | Document | (organizationId, documentId) | Audit events match document's org                      |
| Link            | Room     | (organizationId, roomId)     | Sharing links bound to correct org's room              |

### Prisma Schema Pattern

```prisma
// Example: Document ← Room relationship
model Room {
  id                String      @id @default(cuid())
  organizationId    String
  name              String

  // Relations
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  documents         Document[]

  @@unique([organizationId, id])  // Composite unique for FK target
  @@index([organizationId])
}

model Document {
  id                String      @id @default(cuid())
  organizationId    String
  roomId            String
  name              String

  // Relations
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room              Room         @relation(fields: [organizationId, roomId], references: [organizationId, id], onDelete: Cascade)

  @@unique([organizationId, id])  // Also composite unique for downstream FKs
  @@index([organizationId, roomId])
}
```

### Raw SQL Example (PostgreSQL 15+)

```sql
-- Room table with composite unique constraint
ALTER TABLE "Room"
ADD CONSTRAINT room_org_unique UNIQUE ("organizationId", "id");

-- Document table with composite foreign key
ALTER TABLE "Document"
ADD CONSTRAINT document_room_org_fk
  FOREIGN KEY ("organizationId", "roomId")
  REFERENCES "Room" ("organizationId", "id")
  ON DELETE CASCADE;

-- This constraint is now enforced at the database level:
-- INSERT INTO "Document" (organizationId, roomId, ...)
--   VALUES ('org-A', 'room-B-id', ...)
-- will FAIL if room-B-id belongs to org-B
```

### Verification

To audit existing foreign keys and confirm composite enforcement:

```sql
-- List all foreign key constraints and their column references
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name, kcu.ordinal_position;
```

Look for: Each org-scoped FK should have at least 2 columns (organizationId and the entity ID).

---

## Partitioning Strategy

### Event Table Time-Based Partitioning - F102, F153

The `Event` table uses monthly time-based partitioning for:

1. **Performance** - Range queries on date don't scan unrelated months
2. **Retention** - Archive/delete old partitions efficiently without locking table
3. **Compliance** - Separate storage per retention period

#### Partition Creation

After initial migration, create monthly partitions:

```sql
-- Create main partitioned table (instead of regular table)
CREATE TABLE "Event" (
  id VARCHAR(36) PRIMARY KEY,
  "createdAt" TIMESTAMP NOT NULL,
  "organizationId" VARCHAR(36) NOT NULL,
  -- ... other columns ...
) PARTITION BY RANGE ("createdAt");

-- Create partition for current month and next 6 months
CREATE TABLE "Event_202603" PARTITION OF "Event"
  FOR VALUES FROM ('2026-03-01'::TIMESTAMP) TO ('2026-04-01'::TIMESTAMP);

CREATE TABLE "Event_202604" PARTITION OF "Event"
  FOR VALUES FROM ('2026-04-01'::TIMESTAMP) TO ('2026-05-01'::TIMESTAMP);

-- ... etc for future months

-- Create default partition for edge cases
CREATE TABLE "Event_default" PARTITION OF "Event" DEFAULT;
```

#### Maintenance Tasks

```sql
-- Archive partition (copy to archive storage)
-- Called monthly to offload old data
CREATE TABLE "Event_202501_archive" AS
  SELECT * FROM "Event_202501";
DROP TABLE "Event_202501";

-- Cleanup old partitions (after retention period)
-- Called quarterly based on organization's eventRetentionDays
DROP TABLE "Event_202410"; -- Assuming 180-day retention
```

#### Index Strategy for Partitions

Create indexes on each partition:

```sql
CREATE INDEX idx_event_202603_org_type ON "Event_202603" (organization_id, event_type);
CREATE INDEX idx_event_202603_actor ON "Event_202603" (actor_id, created_at);
```

#### Retention and Archival

Organization-level configuration controls retention:

```prisma
model Organization {
  // ...
  eventRetentionDays      Int           @default(365) // Keep 1 year
  // ...
}
```

Archival process (run monthly via background job - F100):

```typescript
// Pseudo-code for archival job
async function archiveOldEvents(orgId: string) {
  const org = await getOrganization(orgId);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - org.eventRetentionDays);

  // Export events older than cutoffDate to archive storage (S3)
  const oldEvents = await db.event.findMany({
    where: { createdAt: { lt: cutoffDate } },
    take: 10000, // Batch process
  });

  await exportToArchive(oldEvents);

  // Delete from database after export confirmed
  await db.event.deleteMany({
    where: { createdAt: { lt: cutoffDate } },
  });
}
```

---

## Seed Data

### F143: Demo Seed Data and Sample Room

On first deployment, the system optionally creates demo data:

```typescript
// seed.ts - Run via: npx prisma db seed

async function seed() {
  const defaultOrg = await createOrUpdateDefaultOrganization();
  const adminUser = await createAdminUser(defaultOrg);

  // Only if demo mode enabled
  if (process.env.SEED_DEMO_DATA === 'true') {
    await createDemoRoom(defaultOrg, adminUser);
  }
}

async function createOrUpdateDefaultOrganization() {
  return await prisma.organization.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      id: generateId(),
      name: process.env.ORGANIZATION_NAME || 'Default Organization',
      slug: 'default',
      primaryColor: '#0066cc',
      eventRetentionDays: 365,
      trashRetentionDays: 30,
    },
  });
}

async function createAdminUser(org: Organization) {
  const existingAdmin = await prisma.user.findFirst({
    where: {
      organizations: {
        some: {
          organizationId: org.id,
          role: 'ADMIN',
        },
      },
    },
  });

  if (existingAdmin) return existingAdmin;

  const admin = await prisma.user.create({
    data: {
      id: generateId(),
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      passwordHash: hashPassword(process.env.ADMIN_PASSWORD || 'changeme'),
      emailVerifiedAt: new Date(),
      organizations: {
        create: {
          organizationId: org.id,
          role: 'ADMIN',
          canManageUsers: true,
          canManageRooms: true,
          canManageBilling: true,
        },
      },
    },
  });

  return admin;
}

async function createDemoRoom(org: Organization, admin: User) {
  // Use M&A template
  const template = await prisma.roomTemplate.findFirst({
    where: { category: 'mna', isSystemTemplate: true },
  });

  const room = await prisma.room.create({
    data: {
      organizationId: org.id,
      name: 'Sample M&A Data Room',
      slug: 'sample-mna-room',
      description: 'Demo room with sample folder structure and documents',
      status: 'ACTIVE',
      allowDownloads: true,
      templateId: template?.id,
      folders: {
        create: [
          { name: 'Financial Information', displayOrder: 1 },
          { name: 'Legal Documents', displayOrder: 2 },
          { name: 'Contracts', displayOrder: 3 },
        ],
      },
    },
  });

  // Add demo documents...
  // Create sample links...

  return room;
}
```

### Default Room Templates

Seed with built-in templates:

```typescript
async function seedDefaultTemplates(org: Organization) {
  const templates = [
    {
      name: 'M&A Due Diligence',
      category: 'mna',
      description: 'Folder structure for M&A data rooms',
      folderStructure: {
        folders: [
          { name: 'Corporate & Governance' },
          { name: 'Financial Information' },
          { name: 'Legal Documents' },
          { name: 'Contracts' },
          { name: 'Material Agreements' },
          { name: 'Environmental & Regulatory' },
        ],
      },
      checklistTemplate: {
        items: [
          'Articles of incorporation',
          'Board minutes (last 3 years)',
          'Financial statements (audited)',
          'Tax returns (last 3 years)',
          'Material contracts',
        ],
      },
    },
    {
      name: 'Investor Data Room',
      category: 'investor',
      description: 'Streamlined structure for investor access',
      folderStructure: {
        folders: [
          { name: 'Executive Summary' },
          { name: 'Financials' },
          { name: 'Market & Strategy' },
          { name: 'Product & Technology' },
        ],
      },
    },
    // ... board, compliance templates
  ];

  for (const tmpl of templates) {
    await prisma.roomTemplate.upsert({
      where: {
        organizationId_name: { organizationId: org.id, name: tmpl.name },
      },
      update: {},
      create: {
        organizationId: org.id,
        isSystemTemplate: true,
        ...tmpl,
      },
    });
  }
}
```

---

## Prisma Middleware: Soft-Delete Auto-Exclusion (F114)

To prevent soft-deleted (trashed) records from appearing in normal queries, Prisma middleware automatically filters `deletedAt IS NULL` from all queries on models that support soft delete.

**Implementation:**

```typescript
// lib/db/middleware.ts
import { Prisma } from '@prisma/client';

// Models that support soft delete (F114 - Trash)
const SOFT_DELETABLE_MODELS = ['Document', 'Room', 'Folder'];

export function registerSoftDeleteMiddleware(prisma: PrismaClient) {
  prisma.$use(async (params, next) => {
    // Apply soft-delete filter to: findMany, findFirst, findUnique, count
    const queryActions = ['findMany', 'findFirst', 'findUnique', 'count'];

    if (queryActions.includes(params.action) && SOFT_DELETABLE_MODELS.includes(params.model)) {
      // Skip filter if explicitly requesting deleted records
      if (params.args?.where?.includeDeleted === true) {
        // Admin override: remove the includeDeleted flag
        delete params.args.where.includeDeleted;
      } else {
        // Normal query: add deletedAt IS NULL filter
        if (!params.args) {
          params.args = {};
        }
        if (!params.args.where) {
          params.args.where = {};
        }

        // AND the deletedAt: null condition
        const existing = params.args.where;
        params.args.where = {
          AND: [existing, { deletedAt: null }],
        };
      }
    }

    return next(params);
  });
}

// Initialize in lib/db/prisma.ts:
const prisma = new PrismaClient();
registerSoftDeleteMiddleware(prisma);
```

**Usage:**

```typescript
// Normal query: automatically excludes deleted items
const documents = await db.document.findMany({
  where: { roomId: 'room123' },
});
// Executes: ... WHERE room_id = 'room123' AND deleted_at IS NULL

// Admin trash view: explicitly request deleted items
const trashedDocs = await db.document.findMany({
  where: {
    roomId: 'room123',
    includeDeleted: true, // Override middleware
    deletedAt: { not: null }, // Only soft-deleted
  },
});

// Retention cleanup: hard-delete expired soft-deleted records
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 30); // 30-day recovery window

await db.document.deleteMany({
  where: {
    includeDeleted: true,
    deletedAt: { lt: cutoff },
  },
});
```

**Soft-Deletable Models:**

- `Document` (F114) — Documents in trash
- `Room` (F108 extension) — Archived/closed rooms optional soft-delete
- `Folder` (F010 extension) — Folders in trash

---

## Migration Strategy

### Prisma Migrate Workflow

1. **Schema changes** → Update `prisma/schema.prisma`
2. **Create migration** → `npx prisma migrate dev --name <migration_name>`
3. **Review generated SQL** → Check `prisma/migrations/<timestamp>_<name>/migration.sql`
4. **Deploy** → `npx prisma migrate deploy` (in production)

### Migration Naming Conventions

```
// Feature additions
add_document_redaction
add_legal_hold_support
add_api_key_management

// Field additions
add_document_bates_number
add_room_template_support

// Index/performance improvements
optimize_event_table_indexes
partition_event_by_month

// Data corrections
fix_document_version_hashes
```

### Zero-Downtime Deployment

For large table changes:

1. **Add new column as nullable**
2. **Backfill data** in a background job
3. **Add NOT NULL constraint** once complete
4. **Remove old column** in next release (if replacing)

Example:

```prisma
// Migration 1: Add new field
model Document {
  // ... existing fields
  newField String? // Nullable initially
}

// Application code: backfill migration job runs
// Migration 2: Make NOT NULL after backfill complete
model Document {
  newField String // Now required
}
```

### Rollback Strategy

```bash
# To previous state (development only)
npx prisma migrate resolve --rolled-back <migration_name>

# Production: requires manual data restoration
# Keep backups before running migrate deploy
```

---

## Query Patterns

### Multi-Tenant Isolation

Every query must include organization scoping:

```typescript
// ✓ GOOD: Organization-scoped
const documents = await db.document.findMany({
  where: {
    organizationId: currentOrg.id,
    roomId: roomId,
    status: 'ACTIVE',
  },
});

// ✗ WRONG: Missing organization scope
const documents = await db.document.findMany({
  where: { roomId: roomId },
});

// Use Prisma middleware to enforce (see Multi-Tenant Architecture section)
```

### Permission Evaluation

The PermissionEngine (F141) evaluates access decisions:

```typescript
async function canUserAccessDocument(
  user: User,
  document: Document,
  action: 'view' | 'download' | 'print' | 'comment' | 'sign'
): Promise<boolean> {
  // 1. Check if user is org admin (implicit full access)
  const isAdmin = await db.userOrganization.findFirst({
    where: {
      userId: user.id,
      organizationId: document.organizationId,
      role: 'ADMIN',
    },
  });
  if (isAdmin) return true;

  // 2. Check document-level ACL
  const docPerm = await db.permission.findFirst({
    where: {
      documentId: document.id,
      OR: [
        { userId: user.id },
        { groupId: { in: userGroupIds } }, // User's groups
      ],
      isActive: true,
      expiresAt: { gt: new Date() }, // Not expired
    },
  });

  if (docPerm && permissionAllows(docPerm, action)) return true;

  // 3. Check folder-level ACL (inherited)
  const folderPerm = await db.permission.findFirst({
    where: {
      folderId: document.folderId,
      OR: [{ userId: user.id }, { groupId: { in: userGroupIds } }],
      isActive: true,
      inheritFromParent: true,
    },
  });

  if (folderPerm && permissionAllows(folderPerm, action)) return true;

  // 4. Check link-based access
  const link = await db.link.findFirst({
    where: {
      roomId: document.roomId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      AND: [{ viewCount: { lt: maxViews } }],
    },
  });

  if (link && permissionAllows(link.permission, action)) {
    // Check password/email if required
    return checkLinkAccess(user, link);
  }

  return false;
}

// F141: Explain permission (diagnostic)
async function explainPermission(user: User, document: Document, action: string): Promise<string> {
  // Returns human-readable explanation:
  // "Denied: User not in group 'Investors'. Document ACL requires group membership.
  //  No link-based access available."

  const reasons: string[] = [];

  const isAdmin = await checkAdmin(user, document.organizationId);
  if (!isAdmin) reasons.push('Not organization admin');

  const docPerm = await checkDocumentPermission(user, document);
  if (!docPerm) reasons.push('No document-level permission');

  const folderPerm = await checkFolderPermission(user, document);
  if (!folderPerm) reasons.push('No folder-level permission');

  const linkAccess = await checkLinkAccess(user, document.room);
  if (!linkAccess) reasons.push('No valid shared link');

  return reasons.length === 0
    ? 'Allowed: User is organization admin'
    : `Denied: ${reasons.join('. ')}`;
}
```

### Event Auditing

All state changes emit events:

```typescript
// After document upload
await db.event.create({
  data: {
    organizationId: room.organizationId,
    eventType: 'DOCUMENT_UPLOADED',
    actorType: 'ADMIN',
    actorId: admin.id,
    actorEmail: admin.email,
    roomId: room.id,
    documentId: document.id,
    requestId: request.id, // For grouping
    sessionId: session.id,
    description: `Uploaded document: ${document.name}`,
    metadata: {
      fileName: document.originalFileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
    },
    ipAddress: request.ip,
    userAgent: request.userAgent,
  },
});

// Query events for audit
const roomEvents = await db.event.findMany({
  where: {
    organizationId: orgId,
    roomId: roomId,
    createdAt: {
      gte: startDate,
      lte: endDate,
    },
  },
  orderBy: { createdAt: 'desc' },
  take: 100,
});
```

### Analytics Queries

```typescript
// F121: Room activity summary
async function getRoomActivitySummary(roomId: string) {
  const [visits, uniqueViewers, topDocs, recentActivity] = await Promise.all([
    // Total visits
    db.linkVisit.count({
      where: { roomId },
    }),

    // Unique viewers
    db.linkVisit.findMany({
      where: { roomId },
      distinct: ['visitorEmail'],
      select: { visitorEmail: true },
    }),

    // Most viewed documents
    db.document.findMany({
      where: { roomId },
      orderBy: { viewCount: 'desc' },
      take: 5,
    }),

    // Recent events (last 10)
    db.event.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  return {
    totalViews: visits,
    uniqueViewers: uniqueViewers.length,
    topDocuments: topDocs,
    recentActivity,
  };
}

// F027: Page-level engagement
async function getPageEngagement(documentId: string) {
  const sessions = await db.viewSession.findMany({
    where: {
      visits: {
        some: { documentId },
      },
    },
    include: {
      visits: {
        where: { documentId },
      },
    },
  });

  return sessions.map((s) => ({
    visitorEmail: s.visitorEmail,
    timeSpent: s.totalTimeSpentSeconds,
    pagesViewed: s.visits[0]?.pagesViewed || 0,
    timestamp: s.createdAt,
  }));
}
```

### Search Queries

```typescript
// F011: Full-text search
async function searchDocuments(orgId: string, query: string) {
  // Option 1: PostgreSQL FTS
  const results = await db.$queryRaw`
    SELECT * FROM "SearchIndex"
    WHERE "organizationId" = ${orgId}
    AND to_tsvector('english', "extractedText")
        @@ plainto_tsquery('english', ${query})
    ORDER BY ts_rank(
      to_tsvector('english', "extractedText"),
      plainto_tsquery('english', ${query})
    ) DESC
    LIMIT 50
  `;

  return results;
}

// F076: Semantic search (V2)
async function semanticSearch(orgId: string, query: string) {
  // Embed query
  const embedding = await embedText(query);

  // Find similar vectors
  const results = await db.$queryRaw`
    SELECT *,
      1 - (vector_embedding <=> ${JSON.stringify(embedding)}) as similarity
    FROM "SearchIndex"
    WHERE "organizationId" = ${orgId}
    AND "vectorEmbedding" IS NOT NULL
    ORDER BY vector_embedding <=> ${JSON.stringify(embedding)}
    LIMIT 50
  `;

  return results.filter((r) => r.similarity > 0.7);
}
```

### Document Version Queries

```typescript
// F002: Get document version history with hash chain
async function getDocumentHistory(docId: string) {
  const versions = await db.documentVersion.findMany({
    where: { documentId: docId },
    orderBy: { versionNumber: 'asc' },
    include: {
      fileBlob: true,
      uploadedByUser: {
        select: { email: true, firstName: true, lastName: true },
      },
    },
  });

  // Verify hash chain integrity
  let parentHash = null;
  for (const version of versions) {
    if (version.parentVersionHash !== parentHash) {
      console.warn(`Hash chain broken at version ${version.versionNumber}`);
    }
    parentHash = version.versionHash;
  }

  return versions;
}

// F013: Replace document without changing share link
async function replaceDocumentVersion(
  docId: string,
  organizationId: string,
  newFile: Buffer,
  uploadedByUserId: string
) {
  // Scope to organization first to prevent existence disclosure across tenants
  const doc = await db.document.findFirst({
    where: {
      id: docId,
      organizationId, // Only fetch if belongs to this org
    },
  });
  if (!doc) {
    throw new NotFoundError('Document not found');
  }

  // Create new version
  const newVersion = await db.documentVersion.create({
    data: {
      organizationId: doc.organizationId,
      documentId: docId,
      versionNumber: doc.totalVersions + 1,
      uploadedByUserId,
      uploadedByEmail: (
        await db.user.findUnique({
          where: { id: uploadedByUserId },
        })
      ).email,
      fileSha256: hashFile(newFile),
      versionHash: hashVersion(newFile, doc.currentVersion?.versionHash),
      parentVersionHash: doc.currentVersion?.versionHash,
      // ... store file
    },
  });

  // Update document to point to new version
  await db.document.update({
    where: { id: docId },
    data: {
      currentVersionId: newVersion.id,
      totalVersions: { increment: 1 },
    },
  });

  // All share links remain valid!
  // All data access follows the scope-then-authorize pattern to prevent existence disclosure across tenants.
}
```

---

## RLS Operational Contract

Row-Level Security in production depends on a reliable operational pattern. This section defines the canonical approach for setting and managing RLS context across all application layers.

### Core Pattern: SET LOCAL Per Request

RLS relies on a session-scoped variable `app.current_org_id` that must be set at the START of every database request or transaction:

```sql
-- Set at the beginning of every request/transaction
SET LOCAL app.current_org_id = '<organization-id>';

-- SET LOCAL is transaction-scoped and automatically resets on commit/rollback
-- This is the ONLY safe approach with connection pooling
```

**Why SET LOCAL, not SET?**

- `SET LOCAL` is transaction-scoped → automatically resets when transaction commits/rolls back
- `SET` is session-scoped → persists for the entire connection session
- With connection pooling (PgBouncer in transaction mode), session-scoped variables leak state across unrelated requests from different organizations
- **NEVER use SET with connection pooling** for tenant context

### Interactive Transaction Pattern (Safe RLS)

Set `app.current_org_id` using interactive transactions. This is the ONLY safe pattern with connection pooling:

```typescript
// lib/prisma.ts - Tenant-scoped database access
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Execute a callback within a tenant-scoped transaction.
 * SET LOCAL and all subsequent queries share ONE transaction on ONE connection.
 * This is the ONLY safe way to use RLS with Prisma and connection pooling.
 */
export async function withTenantScope<T>(
  organizationId: string,
  callback: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // SET LOCAL is transaction-scoped: guaranteed to share this connection
    await tx.$executeRawUnsafe(`SET LOCAL app.current_org_id = '${organizationId}'`);
    return callback(tx);
  });
}

export default prisma;
```

> **WARNING:** Do NOT use Prisma middleware (`prisma.$use`) for RLS context.
> Middleware does not guarantee that `$executeRawUnsafe` and the subsequent
> query run on the same connection or in the same transaction. Use
> `withTenantScope()` (interactive transactions) exclusively.

**Usage in CoreService:**

```typescript
// services/DocumentService.ts
async function getDocuments(orgId: string) {
  return withTenantScope(orgId, async (tx) => {
    return tx.document.findMany({
      where: { organizationId: orgId }, // Application-level check (primary)
    });
    // RLS is defense-in-depth (secondary) - same transaction guarantees context
  });
}
```

**Usage in API Route:**

```typescript
// app/api/documents/route.ts
export async function GET(req: Request) {
  const session = await getSession(req);
  const documents = await withTenantScope(session.organizationId, async (tx) => {
    return tx.document.findMany({
      where: { organizationId: session.organizationId },
    });
  });
  return Response.json(documents);
}
```

### Connection Pooling & Transaction Modes

**PgBouncer (or equivalent) configuration:**

```ini
; In pgbouncer.ini
[databases]
mydb = host=localhost dbname=mydb

; REQUIRED: Use transaction mode to isolate SET LOCAL
pool_mode = transaction

; Session mode is NOT RECOMMENDED for multi-tenant apps
; pool_mode = session  ; <-- UNSAFE with SET LOCAL
```

In transaction mode:

- Each database transaction gets a fresh connection from the pool
- `SET LOCAL` within that transaction is safely scoped
- When the transaction commits, the connection returns to the pool clean
- No state leaks to the next request

**Why transaction mode is essential:**

- Without it, the RLS context from one tenant's request could bleed into another tenant's request
- This is a critical security issue and must be enforced in production

### Background Workers & Scheduled Jobs

Background workers (job queues, cron jobs) must also set RLS context using `withTenantScope`:

```typescript
// workers/preview/handler.ts - Example preview worker
import { withTenantScope } from '@/lib/prisma';

async function processJob(job) {
  const { organizationId, documentId } = job.data;

  // Validate that the job has the organization context
  if (!organizationId) {
    throw new Error('Job must include organizationId in payload');
  }

  // Use withTenantScope to guarantee SET LOCAL + queries on same connection
  await withTenantScope(organizationId, async (tx) => {
    const document = await tx.document.findFirst({
      where: { id: documentId, organizationId },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    // Process document within the same transaction
    // All queries are automatically RLS-filtered by app.current_org_id
  });
}
```

**Job payload structure:**

```typescript
// When enqueuing a job, ALWAYS include organizationId
await jobQueue.enqueue({
  type: 'process-document-upload',
  organizationId: 'org-123', // REQUIRED
  documentId: 'doc-456',
  fileUrl: 's3://...',
  // ... other data
});
```

### System-Level Jobs (Bypass RLS)

System-level jobs that operate across all organizations (migrations, cleanup, reporting) must use a SUPERUSER role that bypasses RLS:

```typescript
// Use a separate Prisma client with SUPERUSER credentials
const superuserPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_ADMIN_URL, // Admin user with SUPERUSER role
    },
  },
});

async function systemwideCleanup() {
  // This query bypasses RLS because the database user has SUPERUSER
  const expiredDocs = await superuserPrisma.document.findMany({
    where: { expiryDate: { lt: new Date() } },
  });

  // Delete across all organizations
  for (const doc of expiredDocs) {
    await superuserPrisma.document.delete({
      where: { id: doc.id },
    });
  }
}
```

**SUPERUSER role setup (one-time):**

```sql
-- Create an admin user with SUPERUSER privileges
CREATE ROLE admin_user WITH SUPERUSER LOGIN PASSWORD 'strong-password';

-- This user bypasses all RLS policies by design
-- Use sparingly and only for system-level jobs
-- Credentials should be stored securely (e.g., environment variables, secret manager)
```

### Validation Checklist

Before deploying to production:

- [ ] All Prisma middleware sets `app.current_org_id` before queries
- [ ] All RLS policies reference `current_setting('app.current_org_id')`
- [ ] Connection pool is in transaction mode (PgBouncer or equivalent)
- [ ] Background jobs include `organizationId` in payload
- [ ] Background job handlers set RLS context before DB access
- [ ] System-level jobs use SUPERUSER credentials
- [ ] No raw SQL queries bypass organization context
- [ ] Development environment has RLS disabled for debugging convenience
- [ ] Production environment has RLS enabled and enforced

### RLS Policy SQL

Below is production-ready SQL for enabling Row-Level Security on all tenant-scoped tables. This SQL should be added as a Prisma migration file (e.g., `prisma/migrations/002_enable_rls.sql`).

**How to use:**

1. Copy this SQL block into a new migration file: `prisma/migrations/$(date +%s)_enable_rls/migration.sql`
2. Run `npm run db:migrate` to apply to development
3. Deploy to production and apply with the same command

**Key patterns:**

- `ENABLE ROW LEVEL SECURITY;` turns on RLS for the table
- `FORCE ROW LEVEL SECURITY;` ensures even the table owner (postgres role) is subject to policies
- Policies check `current_setting('app.current_org_id')` set via `SET LOCAL` at transaction start
- `USING` clause filters rows on SELECT, UPDATE, DELETE
- `WITH CHECK` clause validates rows on INSERT, UPDATE
- Bypass policy allows the migration/superuser role (postgres) to operate without RLS for system tasks

```sql
-- Enable RLS on all tenant-scoped tables
-- PostgreSQL 15+ supports FORCE ROW LEVEL SECURITY (prevents superuser bypass)

-- ============================================================================
-- Organization Table (Special case: filter by id, not organizationId)
-- ============================================================================

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;

-- Users can SELECT their own organization only (via current_setting)
CREATE POLICY org_select_own ON "Organization"
  FOR SELECT
  USING (
    id = current_setting('app.current_org_id')
  );

-- Only admins can UPDATE (enforced by application layer; RLS is defense-in-depth)
CREATE POLICY org_update_own ON "Organization"
  FOR UPDATE
  USING (
    id = current_setting('app.current_org_id')
  )
  WITH CHECK (
    id = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY org_bypass ON "Organization"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- User Table
-- ============================================================================

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;

-- Users can SELECT other users in their org
CREATE POLICY user_select_own_org ON "User"
  FOR SELECT
  USING (
    id IN (
      SELECT userId FROM "UserOrganization"
      WHERE organizationId = current_setting('app.current_org_id')
    )
  );

-- Users can UPDATE their own profile (name, etc.) within their org
CREATE POLICY user_update_own ON "User"
  FOR UPDATE
  USING (
    id IN (
      SELECT userId FROM "UserOrganization"
      WHERE organizationId = current_setting('app.current_org_id')
    )
  )
  WITH CHECK (
    id IN (
      SELECT userId FROM "UserOrganization"
      WHERE organizationId = current_setting('app.current_org_id')
    )
  );

-- Bypass policy for migrations/superuser
CREATE POLICY user_bypass ON "User"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- UserOrganization (Junction Table)
-- ============================================================================

ALTER TABLE "UserOrganization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserOrganization" FORCE ROW LEVEL SECURITY;

-- Users can SELECT org memberships in their org
CREATE POLICY user_org_select ON "UserOrganization"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can UPDATE membership status (enforced by app layer; RLS is secondary)
CREATE POLICY user_org_update ON "UserOrganization"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY user_org_bypass ON "UserOrganization"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Room Table
-- ============================================================================

ALTER TABLE "Room" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Room" FORCE ROW LEVEL SECURITY;

-- Users can SELECT rooms in their org (permission checks done by application)
CREATE POLICY room_select ON "Room"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT rooms in their org (permission checks done by application)
CREATE POLICY room_insert ON "Room"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE rooms in their org
CREATE POLICY room_update ON "Room"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can DELETE rooms in their org (soft delete via deletedAt)
CREATE POLICY room_delete ON "Room"
  FOR DELETE
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY room_bypass ON "Room"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Folder Table
-- ============================================================================

ALTER TABLE "Folder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Folder" FORCE ROW LEVEL SECURITY;

-- Users can SELECT folders in their org
CREATE POLICY folder_select ON "Folder"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT folders in their org
CREATE POLICY folder_insert ON "Folder"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE folders in their org
CREATE POLICY folder_update ON "Folder"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can DELETE folders in their org
CREATE POLICY folder_delete ON "Folder"
  FOR DELETE
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY folder_bypass ON "Folder"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Document Table
-- ============================================================================

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" FORCE ROW LEVEL SECURITY;

-- Users can SELECT documents in their org
CREATE POLICY document_select ON "Document"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT documents in their org
CREATE POLICY document_insert ON "Document"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE documents in their org
CREATE POLICY document_update ON "Document"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can DELETE documents in their org (soft delete via deletedAt)
CREATE POLICY document_delete ON "Document"
  FOR DELETE
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY document_bypass ON "Document"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- DocumentVersion Table
-- ============================================================================

ALTER TABLE "DocumentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentVersion" FORCE ROW LEVEL SECURITY;

-- Users can SELECT versions of documents in their org
CREATE POLICY document_version_select ON "DocumentVersion"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT versions in their org (during document update)
CREATE POLICY document_version_insert ON "DocumentVersion"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Versions are immutable; UPDATE is restricted to service layer only
-- (versioning is append-only; updates to createdAt, etc. are prevented by application)

-- Bypass policy for migrations/superuser
CREATE POLICY document_version_bypass ON "DocumentVersion"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- FileBlob Table
-- ============================================================================

ALTER TABLE "FileBlob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FileBlob" FORCE ROW LEVEL SECURITY;

-- Users can SELECT file blobs in their org
CREATE POLICY file_blob_select ON "FileBlob"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT file blobs in their org (during upload)
CREATE POLICY file_blob_insert ON "FileBlob"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- File blobs are immutable after creation; UPDATE is restricted to metadata only
CREATE POLICY file_blob_update ON "FileBlob"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY file_blob_bypass ON "FileBlob"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PreviewAsset Table
-- ============================================================================

ALTER TABLE "PreviewAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PreviewAsset" FORCE ROW LEVEL SECURITY;

-- Users can SELECT preview assets in their org
CREATE POLICY preview_asset_select ON "PreviewAsset"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Preview workers can INSERT preview assets
CREATE POLICY preview_asset_insert ON "PreviewAsset"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY preview_asset_bypass ON "PreviewAsset"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- ExtractedText Table
-- ============================================================================

ALTER TABLE "ExtractedText" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExtractedText" FORCE ROW LEVEL SECURITY;

-- Users can SELECT extracted text in their org
CREATE POLICY extracted_text_select ON "ExtractedText"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Workers can INSERT extracted text (from OCR/text extraction jobs)
CREATE POLICY extracted_text_insert ON "ExtractedText"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY extracted_text_bypass ON "ExtractedText"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- SearchIndex Table
-- ============================================================================

ALTER TABLE "SearchIndex" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SearchIndex" FORCE ROW LEVEL SECURITY;

-- Users can SELECT search index entries in their org
CREATE POLICY search_index_select ON "SearchIndex"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Workers can INSERT search index entries (during indexing)
CREATE POLICY search_index_insert ON "SearchIndex"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY search_index_bypass ON "SearchIndex"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Link (Sharing Link) Table
-- ============================================================================

ALTER TABLE "Link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Link" FORCE ROW LEVEL SECURITY;

-- Users can SELECT sharing links in their org
CREATE POLICY link_select ON "Link"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT sharing links for rooms in their org
CREATE POLICY link_insert ON "Link"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE sharing links in their org
CREATE POLICY link_update ON "Link"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can DELETE sharing links in their org
CREATE POLICY link_delete ON "Link"
  FOR DELETE
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY link_bypass ON "Link"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- LinkVisit Table
-- ============================================================================

ALTER TABLE "LinkVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LinkVisit" FORCE ROW LEVEL SECURITY;

-- Users can SELECT link visits for links in their org
CREATE POLICY link_visit_select ON "LinkVisit"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Application can INSERT link visits (audit trail)
CREATE POLICY link_visit_insert ON "LinkVisit"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY link_visit_bypass ON "LinkVisit"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- ViewSession Table
-- ============================================================================

ALTER TABLE "ViewSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ViewSession" FORCE ROW LEVEL SECURITY;

-- Users can SELECT view sessions in their org
CREATE POLICY view_session_select ON "ViewSession"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Application can INSERT view sessions (for document views)
CREATE POLICY view_session_insert ON "ViewSession"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY view_session_bypass ON "ViewSession"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Permission Table
-- ============================================================================

ALTER TABLE "Permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Permission" FORCE ROW LEVEL SECURITY;

-- Users can SELECT permissions in their org
CREATE POLICY permission_select ON "Permission"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT permissions in their org (application enforces who can grant)
CREATE POLICY permission_insert ON "Permission"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE permissions in their org
CREATE POLICY permission_update ON "Permission"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can DELETE permissions in their org
CREATE POLICY permission_delete ON "Permission"
  FOR DELETE
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY permission_bypass ON "Permission"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- RoleAssignment Table
-- ============================================================================

ALTER TABLE "RoleAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleAssignment" FORCE ROW LEVEL SECURITY;

-- Users can SELECT role assignments in their org
CREATE POLICY role_assignment_select ON "RoleAssignment"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can INSERT role assignments in their org
CREATE POLICY role_assignment_insert ON "RoleAssignment"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can UPDATE role assignments in their org
CREATE POLICY role_assignment_update ON "RoleAssignment"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can DELETE role assignments in their org
CREATE POLICY role_assignment_delete ON "RoleAssignment"
  FOR DELETE
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY role_assignment_bypass ON "RoleAssignment"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Group Table
-- ============================================================================

ALTER TABLE "Group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Group" FORCE ROW LEVEL SECURITY;

-- Users can SELECT groups in their org
CREATE POLICY group_select ON "Group"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT groups in their org
CREATE POLICY group_insert ON "Group"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE groups in their org
CREATE POLICY group_update ON "Group"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can DELETE groups in their org
CREATE POLICY group_delete ON "Group"
  FOR DELETE
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY group_bypass ON "Group"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Event (Audit Log) Table
-- ============================================================================

ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" FORCE ROW LEVEL SECURITY;

-- Users can SELECT events in their org (read-only audit log)
CREATE POLICY event_select ON "Event"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Application can INSERT events (immutable append-only log)
CREATE POLICY event_insert ON "Event"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Events are immutable; no UPDATE or DELETE allowed (even by admins)
-- except via superuser role for retention policies

-- Bypass policy for migrations/superuser (needed for retention/cleanup jobs)
CREATE POLICY event_bypass ON "Event"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- WatermarkConfig Table
-- ============================================================================

ALTER TABLE "WatermarkConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WatermarkConfig" FORCE ROW LEVEL SECURITY;

-- Users can SELECT watermark configs in their org
CREATE POLICY watermark_config_select ON "WatermarkConfig"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can INSERT watermark configs in their org
CREATE POLICY watermark_config_insert ON "WatermarkConfig"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can UPDATE watermark configs in their org
CREATE POLICY watermark_config_update ON "WatermarkConfig"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY watermark_config_bypass ON "WatermarkConfig"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- RoomTemplate Table
-- ============================================================================

ALTER TABLE "RoomTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoomTemplate" FORCE ROW LEVEL SECURITY;

-- Users can SELECT room templates in their org
CREATE POLICY room_template_select ON "RoomTemplate"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can INSERT room templates in their org
CREATE POLICY room_template_insert ON "RoomTemplate"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can UPDATE room templates in their org
CREATE POLICY room_template_update ON "RoomTemplate"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY room_template_bypass ON "RoomTemplate"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Notification Table
-- ============================================================================

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;

-- Users can SELECT notifications in their org
CREATE POLICY notification_select ON "Notification"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Application can INSERT notifications
CREATE POLICY notification_insert ON "Notification"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE their own notification status (read/unread)
CREATE POLICY notification_update ON "Notification"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY notification_bypass ON "Notification"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- NotificationPreference Table
-- ============================================================================

ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" FORCE ROW LEVEL SECURITY;

-- Users can SELECT notification preferences in their org
CREATE POLICY notification_preference_select ON "NotificationPreference"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT their own notification preferences
CREATE POLICY notification_preference_insert ON "NotificationPreference"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE their own notification preferences
CREATE POLICY notification_preference_update ON "NotificationPreference"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY notification_preference_bypass ON "NotificationPreference"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- Invitation Table
-- ============================================================================

ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;

-- Users can SELECT invitations in their org
CREATE POLICY invitation_select ON "Invitation"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can INSERT invitations in their org
CREATE POLICY invitation_insert ON "Invitation"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Admins can UPDATE invitations in their org
CREATE POLICY invitation_update ON "Invitation"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY invitation_bypass ON "Invitation"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- NDARecord Table
-- ============================================================================

ALTER TABLE "NDARecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NDARecord" FORCE ROW LEVEL SECURITY;

-- Users can SELECT NDA records in their org
CREATE POLICY nda_record_select ON "NDARecord"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Application can INSERT NDA records (immutable audit trail)
CREATE POLICY nda_record_insert ON "NDARecord"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- NDA records are immutable; no UPDATE or DELETE

-- Bypass policy for migrations/superuser
CREATE POLICY nda_record_bypass ON "NDARecord"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- LegalHold Table
-- ============================================================================

ALTER TABLE "LegalHold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalHold" FORCE ROW LEVEL SECURITY;

-- Compliance officers can SELECT legal holds in their org
CREATE POLICY legal_hold_select ON "LegalHold"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- System can INSERT legal holds
CREATE POLICY legal_hold_insert ON "LegalHold"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- System can UPDATE legal hold status
CREATE POLICY legal_hold_update ON "LegalHold"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY legal_hold_bypass ON "LegalHold"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- DocumentRedaction Table
-- ============================================================================

ALTER TABLE "DocumentRedaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentRedaction" FORCE ROW LEVEL SECURITY;

-- Users can SELECT redactions in their org
CREATE POLICY document_redaction_select ON "DocumentRedaction"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT redactions in their org
CREATE POLICY document_redaction_insert ON "DocumentRedaction"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY document_redaction_bypass ON "DocumentRedaction"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- ApiKey Table
-- ============================================================================

ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;

-- Users can SELECT API keys in their org
CREATE POLICY api_key_select ON "ApiKey"
  FOR SELECT
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can INSERT API keys for their org
CREATE POLICY api_key_insert ON "ApiKey"
  FOR INSERT
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can UPDATE API key status (revoke, rotate)
CREATE POLICY api_key_update ON "ApiKey"
  FOR UPDATE
  USING (
    organizationId = current_setting('app.current_org_id')
  )
  WITH CHECK (
    organizationId = current_setting('app.current_org_id')
  );

-- Users can DELETE (revoke) API keys
CREATE POLICY api_key_delete ON "ApiKey"
  FOR DELETE
  USING (
    organizationId = current_setting('app.current_org_id')
  );

-- Bypass policy for migrations/superuser
CREATE POLICY api_key_bypass ON "ApiKey"
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- System-Level Tables (NO RLS required)
-- ============================================================================

-- The following tables do NOT have organizationId and do NOT require RLS:
-- - migrations (Prisma metadata)
-- - FeatureFlag (global feature toggles, not org-scoped)

-- ============================================================================
-- Summary
-- ============================================================================
-- This RLS configuration ensures:
-- 1. Every organization's data is isolated at the database layer
-- 2. SET LOCAL app.current_org_id at request start filters all queries
-- 3. Even superusers must bypass via explicit bypass policies
-- 4. Immutable tables (Event, NDARecord) are INSERT-only
-- 5. Application-layer permission checks (PermissionEngine) are defense-in-depth
```

---

## Summary

This database schema provides:

✓ **Multi-tenant isolation** from day one
✓ **Immutable audit trail** via Event table with monthly partitioning
✓ **Document versioning** with hash chain integrity
✓ **Flexible permissions** (RBAC + ACLs + link-based)
✓ **Performance** via strategic indexing and denormalization
✓ **Scalability** without schema rewrites
✓ **Compliance** via audit logging, soft deletes, legal hold, and retention policies

All Prisma schema definitions are implementation-ready and follow PostgreSQL 15+ best practices.

---

**Document Version:** 1.0
**Last Updated:** March 14, 2026
**Status:** Ready for Implementation (MVP)
