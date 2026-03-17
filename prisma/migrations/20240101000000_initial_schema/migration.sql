-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('ORGANIZATION_CREATED', 'ORGANIZATION_UPDATED', 'ORGANIZATION_DELETED', 'USER_CREATED', 'USER_INVITED', 'USER_ACCEPTED_INVITATION', 'USER_LOGIN', 'USER_LOGOUT', 'USER_UPDATED', 'USER_DELETED', 'USER_2FA_ENABLED', 'USER_2FA_DISABLED', 'USER_PASSWORD_CHANGED', 'USER_PASSWORD_RESET', 'ROOM_CREATED', 'ROOM_UPDATED', 'ROOM_STATUS_CHANGED', 'ROOM_ARCHIVED', 'ROOM_CLOSED', 'ROOM_DUPLICATED', 'ROOM_DELETED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERSION_CREATED', 'DOCUMENT_UPDATED', 'DOCUMENT_METADATA_UPDATED', 'DOCUMENT_MOVED', 'DOCUMENT_TAGGED', 'DOCUMENT_ARCHIVED', 'DOCUMENT_DELETED', 'DOCUMENT_RESTORED', 'DOCUMENT_SCANNED', 'PERMISSION_GRANTED', 'PERMISSION_REVOKED', 'PERMISSION_UPDATED', 'LINK_CREATED', 'LINK_REVOKED', 'LINK_ACCESSED', 'LINK_PASSWORD_VERIFIED', 'DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED', 'DOCUMENT_PRINTED', 'PAGE_VIEWED', 'ADMIN_SETTING_CHANGED', 'ADMIN_EXPORT_INITIATED', 'SYSTEM_BACKUP_STARTED', 'SYSTEM_BACKUP_COMPLETED', 'SYSTEM_JOB_FAILED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('ADMIN', 'VIEWER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LinkPermission" AS ENUM ('VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "LinkScope" AS ENUM ('ENTIRE_ROOM', 'FOLDER', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "PreviewStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "PreviewAssetType" AS ENUM ('PDF', 'THUMBNAIL', 'RENDER');

-- CreateEnum
CREATE TYPE "PermissionResourceType" AS ENUM ('ROOM', 'FOLDER', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "PermissionGranteeType" AS ENUM ('USER', 'GROUP', 'ROLE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('NONE', 'VIEW', 'DOWNLOAD', 'ADMIN');

-- CreateEnum
CREATE TYPE "RoleScopeType" AS ENUM ('ORGANIZATION', 'ROOM');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('VIEW_ACTIVITY', 'UPLOAD_COMPLETE', 'LINK_ACCESSED', 'ADMIN_ACTION', 'DIGEST');

-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "logoUrl" VARCHAR(500),
    "primaryColor" VARCHAR(7) NOT NULL DEFAULT '#2563eb',
    "faviconUrl" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "allowSelfSignup" BOOLEAN NOT NULL DEFAULT false,
    "customDomain" VARCHAR(255),
    "eventRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "trashRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "maxStorageBytes" BIGINT,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_organizations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canManageUsers" BOOLEAN NOT NULL DEFAULT false,
    "canManageRooms" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "token" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" VARCHAR(50),
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "slug" VARCHAR(100) NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'DRAFT',
    "requiresPassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" VARCHAR(255),
    "requiresEmailVerification" BOOLEAN NOT NULL DEFAULT true,
    "allowDownloads" BOOLEAN NOT NULL DEFAULT true,
    "defaultExpiryDays" INTEGER,
    "requiresNda" BOOLEAN NOT NULL DEFAULT false,
    "ndaContent" TEXT,
    "enableWatermark" BOOLEAN NOT NULL DEFAULT false,
    "watermarkTemplate" VARCHAR(500),
    "archivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "totalDocuments" INTEGER NOT NULL DEFAULT 0,
    "totalFolders" INTEGER NOT NULL DEFAULT 0,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "totalViewers" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "templateId" TEXT,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" VARCHAR(255) NOT NULL,
    "path" VARCHAR(1000) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" VARCHAR(500) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "originalFileName" VARCHAR(500) NOT NULL,
    "currentVersionId" TEXT,
    "totalVersions" INTEGER NOT NULL DEFAULT 0,
    "batesNumber" VARCHAR(20),
    "batesStartNumber" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customMetadata" JSONB,
    "allowDownload" BOOLEAN NOT NULL DEFAULT true,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueViewerCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedByEmail" VARCHAR(255),
    "changeDescription" TEXT,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "fileName" VARCHAR(500) NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "versionHash" VARCHAR(64) NOT NULL,
    "parentVersionHash" VARCHAR(64),
    "previewStatus" "PreviewStatus" NOT NULL DEFAULT 'PENDING',
    "previewError" TEXT,
    "previewGeneratedAt" TIMESTAMP(3),
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanError" TEXT,
    "scannedAt" TIMESTAMP(3),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_blobs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "storageBucket" VARCHAR(100) NOT NULL DEFAULT 'documents',
    "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
    "encryptionKey" VARCHAR(500),
    "encryptionAlgorithm" VARCHAR(50),

    CONSTRAINT "file_blobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preview_assets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "assetType" "PreviewAssetType" NOT NULL DEFAULT 'PDF',
    "pageNumber" INTEGER,
    "variantDpi" INTEGER NOT NULL DEFAULT 96,
    "storageKey" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,

    CONSTRAINT "preview_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_texts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "plainText" TEXT NOT NULL,
    "detectedLanguage" VARCHAR(10),
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "extracted_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_indexes" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "documentTitle" VARCHAR(500) NOT NULL,
    "extractedText" TEXT NOT NULL,
    "fileName" VARCHAR(500) NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customMetadata" JSONB,
    "mimeType" VARCHAR(100) NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "links" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "slug" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255),
    "description" TEXT,
    "permission" "LinkPermission" NOT NULL DEFAULT 'VIEW',
    "requiresPassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" VARCHAR(255),
    "requiresEmailVerification" BOOLEAN NOT NULL DEFAULT false,
    "allowedEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "maxViews" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "scope" "LinkScope" NOT NULL DEFAULT 'ENTIRE_ROOM',
    "scopedFolderId" TEXT,
    "scopedDocumentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastAccessedAt" TIMESTAMP(3),

    CONSTRAINT "links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_visits" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "documentId" TEXT,
    "visitorEmail" VARCHAR(255),
    "visitorIdentifier" VARCHAR(100),
    "viewSessionId" TEXT,
    "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
    "pagesViewed" INTEGER NOT NULL DEFAULT 1,
    "ipAddress" VARCHAR(50),
    "userAgent" TEXT,
    "countryCode" VARCHAR(2),

    CONSTRAINT "link_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "view_sessions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT,
    "linkId" TEXT,
    "sessionToken" VARCHAR(255) NOT NULL,
    "visitorEmail" VARCHAR(255),
    "visitorName" VARCHAR(255),
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "totalTimeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" VARCHAR(50),
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "view_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceType" "PermissionResourceType" NOT NULL,
    "roomId" TEXT,
    "folderId" TEXT,
    "documentId" TEXT,
    "granteeType" "PermissionGranteeType" NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "permissionLevel" "PermissionLevel" NOT NULL,
    "inheritFromParent" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "grantedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "scopeType" "RoleScopeType" NOT NULL,
    "roomId" TEXT,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "externalOrganization" VARCHAR(255),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_memberships" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "actorEmail" VARCHAR(255),
    "roomId" TEXT,
    "folderId" TEXT,
    "documentId" TEXT,
    "requestId" VARCHAR(100),
    "sessionId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "ipAddress" VARCHAR(50),
    "userAgent" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_templates" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100) NOT NULL,
    "isSystemTemplate" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "folderStructure" JSONB NOT NULL,
    "defaultPermissions" JSONB,
    "defaultSettings" JSONB,

    CONSTRAINT "room_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "userOrganizationId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "roomId" TEXT,
    "documentId" TEXT,
    "linkId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userOrganizationId" TEXT NOT NULL,
    "emailOnDocumentViewed" BOOLEAN NOT NULL DEFAULT true,
    "emailOnDocumentUploaded" BOOLEAN NOT NULL DEFAULT true,
    "emailOnAccessRevoked" BOOLEAN NOT NULL DEFAULT true,
    "emailDailyDigest" BOOLEAN NOT NULL DEFAULT false,
    "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'DAILY',
    "quietHoursStart" VARCHAR(5),
    "quietHoursEnd" VARCHAR(5),

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitationToken" VARCHAR(255) NOT NULL,
    "invitationUrl" VARCHAR(500) NOT NULL,
    "invitedByUserId" TEXT,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_DocumentToViewSession" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_customDomain_key" ON "organizations"("customDomain");

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_isActive_idx" ON "organizations"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- CreateIndex
CREATE INDEX "user_organizations_organizationId_idx" ON "user_organizations"("organizationId");

-- CreateIndex
CREATE INDEX "user_organizations_userId_idx" ON "user_organizations"("userId");

-- CreateIndex
CREATE INDEX "user_organizations_role_idx" ON "user_organizations"("role");

-- CreateIndex
CREATE UNIQUE INDEX "user_organizations_organizationId_userId_key" ON "user_organizations"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "sessions_isActive_idx" ON "sessions"("isActive");

-- CreateIndex
CREATE INDEX "rooms_organizationId_idx" ON "rooms"("organizationId");

-- CreateIndex
CREATE INDEX "rooms_status_idx" ON "rooms"("status");

-- CreateIndex
CREATE INDEX "rooms_createdAt_idx" ON "rooms"("createdAt");

-- CreateIndex
CREATE INDEX "rooms_archivedAt_idx" ON "rooms"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_organizationId_slug_key" ON "rooms"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "folders_organizationId_idx" ON "folders"("organizationId");

-- CreateIndex
CREATE INDEX "folders_roomId_idx" ON "folders"("roomId");

-- CreateIndex
CREATE INDEX "folders_parentId_idx" ON "folders"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "folders_roomId_path_key" ON "folders"("roomId", "path");

-- CreateIndex
CREATE INDEX "documents_organizationId_idx" ON "documents"("organizationId");

-- CreateIndex
CREATE INDEX "documents_roomId_idx" ON "documents"("roomId");

-- CreateIndex
CREATE INDEX "documents_folderId_idx" ON "documents"("folderId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_batesNumber_idx" ON "documents"("batesNumber");

-- CreateIndex
CREATE INDEX "documents_deletedAt_idx" ON "documents"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "documents_organizationId_id_key" ON "documents"("organizationId", "id");

-- CreateIndex
CREATE INDEX "document_versions_organizationId_idx" ON "document_versions"("organizationId");

-- CreateIndex
CREATE INDEX "document_versions_documentId_idx" ON "document_versions"("documentId");

-- CreateIndex
CREATE INDEX "document_versions_previewStatus_idx" ON "document_versions"("previewStatus");

-- CreateIndex
CREATE INDEX "document_versions_scanStatus_idx" ON "document_versions"("scanStatus");

-- CreateIndex
CREATE INDEX "document_versions_createdAt_idx" ON "document_versions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "file_blobs_versionId_key" ON "file_blobs"("versionId");

-- CreateIndex
CREATE INDEX "file_blobs_organizationId_idx" ON "file_blobs"("organizationId");

-- CreateIndex
CREATE INDEX "file_blobs_storageKey_idx" ON "file_blobs"("storageKey");

-- CreateIndex
CREATE INDEX "preview_assets_organizationId_idx" ON "preview_assets"("organizationId");

-- CreateIndex
CREATE INDEX "preview_assets_versionId_idx" ON "preview_assets"("versionId");

-- CreateIndex
CREATE INDEX "preview_assets_assetType_idx" ON "preview_assets"("assetType");

-- CreateIndex
CREATE INDEX "preview_assets_pageNumber_idx" ON "preview_assets"("pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_texts_versionId_key" ON "extracted_texts"("versionId");

-- CreateIndex
CREATE INDEX "extracted_texts_organizationId_idx" ON "extracted_texts"("organizationId");

-- CreateIndex
CREATE INDEX "extracted_texts_versionId_idx" ON "extracted_texts"("versionId");

-- CreateIndex
CREATE INDEX "extracted_texts_detectedLanguage_idx" ON "extracted_texts"("detectedLanguage");

-- CreateIndex
CREATE INDEX "search_indexes_organizationId_idx" ON "search_indexes"("organizationId");

-- CreateIndex
CREATE INDEX "search_indexes_documentId_idx" ON "search_indexes"("documentId");

-- CreateIndex
CREATE INDEX "search_indexes_versionId_idx" ON "search_indexes"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "search_indexes_organizationId_versionId_key" ON "search_indexes"("organizationId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "links_slug_key" ON "links"("slug");

-- CreateIndex
CREATE INDEX "links_organizationId_idx" ON "links"("organizationId");

-- CreateIndex
CREATE INDEX "links_roomId_idx" ON "links"("roomId");

-- CreateIndex
CREATE INDEX "links_expiresAt_idx" ON "links"("expiresAt");

-- CreateIndex
CREATE INDEX "links_viewCount_idx" ON "links"("viewCount");

-- CreateIndex
CREATE INDEX "links_isActive_idx" ON "links"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "links_organizationId_slug_key" ON "links"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "link_visits_organizationId_idx" ON "link_visits"("organizationId");

-- CreateIndex
CREATE INDEX "link_visits_linkId_idx" ON "link_visits"("linkId");

-- CreateIndex
CREATE INDEX "link_visits_roomId_idx" ON "link_visits"("roomId");

-- CreateIndex
CREATE INDEX "link_visits_documentId_idx" ON "link_visits"("documentId");

-- CreateIndex
CREATE INDEX "link_visits_visitorEmail_idx" ON "link_visits"("visitorEmail");

-- CreateIndex
CREATE INDEX "link_visits_createdAt_idx" ON "link_visits"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "view_sessions_sessionToken_key" ON "view_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "view_sessions_organizationId_idx" ON "view_sessions"("organizationId");

-- CreateIndex
CREATE INDEX "view_sessions_roomId_idx" ON "view_sessions"("roomId");

-- CreateIndex
CREATE INDEX "view_sessions_userId_idx" ON "view_sessions"("userId");

-- CreateIndex
CREATE INDEX "view_sessions_linkId_idx" ON "view_sessions"("linkId");

-- CreateIndex
CREATE INDEX "view_sessions_lastActivityAt_idx" ON "view_sessions"("lastActivityAt");

-- CreateIndex
CREATE INDEX "view_sessions_isActive_idx" ON "view_sessions"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "view_sessions_organizationId_sessionToken_key" ON "view_sessions"("organizationId", "sessionToken");

-- CreateIndex
CREATE INDEX "permissions_organizationId_idx" ON "permissions"("organizationId");

-- CreateIndex
CREATE INDEX "permissions_resourceType_idx" ON "permissions"("resourceType");

-- CreateIndex
CREATE INDEX "permissions_userId_idx" ON "permissions"("userId");

-- CreateIndex
CREATE INDEX "permissions_groupId_idx" ON "permissions"("groupId");

-- CreateIndex
CREATE INDEX "permissions_expiresAt_idx" ON "permissions"("expiresAt");

-- CreateIndex
CREATE INDEX "permissions_isActive_idx" ON "permissions"("isActive");

-- CreateIndex
CREATE INDEX "role_assignments_organizationId_idx" ON "role_assignments"("organizationId");

-- CreateIndex
CREATE INDEX "role_assignments_userId_idx" ON "role_assignments"("userId");

-- CreateIndex
CREATE INDEX "role_assignments_role_idx" ON "role_assignments"("role");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignments_organizationId_userId_scopeType_roomId_key" ON "role_assignments"("organizationId", "userId", "scopeType", "roomId");

-- CreateIndex
CREATE INDEX "groups_organizationId_idx" ON "groups"("organizationId");

-- CreateIndex
CREATE INDEX "groups_externalOrganization_idx" ON "groups"("externalOrganization");

-- CreateIndex
CREATE UNIQUE INDEX "groups_organizationId_name_key" ON "groups"("organizationId", "name");

-- CreateIndex
CREATE INDEX "group_memberships_groupId_idx" ON "group_memberships"("groupId");

-- CreateIndex
CREATE INDEX "group_memberships_userId_idx" ON "group_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_groupId_userId_key" ON "group_memberships"("groupId", "userId");

-- CreateIndex
CREATE INDEX "events_organizationId_idx" ON "events"("organizationId");

-- CreateIndex
CREATE INDEX "events_eventType_idx" ON "events"("eventType");

-- CreateIndex
CREATE INDEX "events_actorId_idx" ON "events"("actorId");

-- CreateIndex
CREATE INDEX "events_roomId_idx" ON "events"("roomId");

-- CreateIndex
CREATE INDEX "events_documentId_idx" ON "events"("documentId");

-- CreateIndex
CREATE INDEX "events_createdAt_idx" ON "events"("createdAt");

-- CreateIndex
CREATE INDEX "events_requestId_idx" ON "events"("requestId");

-- CreateIndex
CREATE INDEX "events_sessionId_idx" ON "events"("sessionId");

-- CreateIndex
CREATE INDEX "room_templates_organizationId_idx" ON "room_templates"("organizationId");

-- CreateIndex
CREATE INDEX "room_templates_category_idx" ON "room_templates"("category");

-- CreateIndex
CREATE INDEX "room_templates_isSystemTemplate_idx" ON "room_templates"("isSystemTemplate");

-- CreateIndex
CREATE INDEX "notifications_organizationId_idx" ON "notifications"("organizationId");

-- CreateIndex
CREATE INDEX "notifications_userOrganizationId_idx" ON "notifications"("userOrganizationId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userOrganizationId_key" ON "notification_preferences"("userOrganizationId");

-- CreateIndex
CREATE INDEX "notification_preferences_userOrganizationId_idx" ON "notification_preferences"("userOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_invitationToken_key" ON "invitations"("invitationToken");

-- CreateIndex
CREATE INDEX "invitations_organizationId_idx" ON "invitations"("organizationId");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_status_idx" ON "invitations"("status");

-- CreateIndex
CREATE INDEX "invitations_expiresAt_idx" ON "invitations"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_key" ON "email_verification_tokens"("token");

-- CreateIndex
CREATE INDEX "email_verification_tokens_token_idx" ON "email_verification_tokens"("token");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expiresAt_idx" ON "email_verification_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "_DocumentToViewSession_AB_unique" ON "_DocumentToViewSession"("A", "B");

-- CreateIndex
CREATE INDEX "_DocumentToViewSession_B_index" ON "_DocumentToViewSession"("B");

-- AddForeignKey
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_blobs" ADD CONSTRAINT "file_blobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_blobs" ADD CONSTRAINT "file_blobs_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_assets" ADD CONSTRAINT "preview_assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_assets" ADD CONSTRAINT "preview_assets_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_texts" ADD CONSTRAINT "extracted_texts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_texts" ADD CONSTRAINT "extracted_texts_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_indexes" ADD CONSTRAINT "search_indexes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_indexes" ADD CONSTRAINT "search_indexes_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_indexes" ADD CONSTRAINT "search_indexes_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links" ADD CONSTRAINT "links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links" ADD CONSTRAINT "links_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "links" ADD CONSTRAINT "links_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_visits" ADD CONSTRAINT "link_visits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_visits" ADD CONSTRAINT "link_visits_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_visits" ADD CONSTRAINT "link_visits_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_visits" ADD CONSTRAINT "link_visits_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_visits" ADD CONSTRAINT "link_visits_viewSessionId_fkey" FOREIGN KEY ("viewSessionId") REFERENCES "view_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "view_sessions" ADD CONSTRAINT "view_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "view_sessions" ADD CONSTRAINT "view_sessions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "view_sessions" ADD CONSTRAINT "view_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "view_sessions" ADD CONSTRAINT "view_sessions_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "view_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_templates" ADD CONSTRAINT "room_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userOrganizationId_fkey" FOREIGN KEY ("userOrganizationId") REFERENCES "user_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userOrganizationId_fkey" FOREIGN KEY ("userOrganizationId") REFERENCES "user_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DocumentToViewSession" ADD CONSTRAINT "_DocumentToViewSession_A_fkey" FOREIGN KEY ("A") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DocumentToViewSession" ADD CONSTRAINT "_DocumentToViewSession_B_fkey" FOREIGN KEY ("B") REFERENCES "view_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

