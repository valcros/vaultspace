-- Company Content Library foundation. All customer-facing routes remain disabled.

CREATE TYPE "RoomMode" AS ENUM ('INDEPENDENT', 'COMPANY_VIEW');

CREATE TYPE "LibraryPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LIBRARY_DOCUMENT_CREATED';

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LIBRARY_VERSION_CREATED';

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LIBRARY_VIEW_DRAFTED';

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LIBRARY_VIEW_PUBLISHED';

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LIBRARY_VIEW_UNPUBLISHED';

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LIBRARY_VERSION_PINNED';

ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LIBRARY_ARCHIVE_BLOCKED';

ALTER TABLE "organizations" ADD COLUMN "companyLibraryEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "rooms" ADD COLUMN "mode" "RoomMode" NOT NULL DEFAULT 'INDEPENDENT';

CREATE TABLE "library_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" VARCHAR(255) NOT NULL,
    "path" VARCHAR(1000) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folderId" TEXT,
    "name" VARCHAR(500) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library_document_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileName" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "previewStatus" "PreviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_document_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "library_file_blobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "storageBucket" VARCHAR(100) NOT NULL DEFAULT 'library',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_file_blobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_view_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "libraryFolderId" TEXT NOT NULL,
    "parentId" TEXT,
    "path" VARCHAR(1000) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_view_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_view_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "libraryDocumentId" TEXT NOT NULL,
    "folderId" TEXT,
    "publishedVersionId" TEXT,
    "status" "LibraryPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "unpublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_view_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rooms_organizationId_id_key" ON "rooms"("organizationId", "id");

CREATE INDEX "library_folders_organizationId_parentId_idx" ON "library_folders"("organizationId", "parentId");
CREATE UNIQUE INDEX "library_folders_organizationId_id_key" ON "library_folders"("organizationId", "id");
CREATE UNIQUE INDEX "library_folders_organizationId_path_key" ON "library_folders"("organizationId", "path");
CREATE INDEX "library_documents_organizationId_folderId_idx" ON "library_documents"("organizationId", "folderId");
CREATE INDEX "library_documents_organizationId_archivedAt_idx" ON "library_documents"("organizationId", "archivedAt");
CREATE UNIQUE INDEX "library_documents_organizationId_id_key" ON "library_documents"("organizationId", "id");
CREATE INDEX "library_document_versions_organizationId_scanStatus_idx" ON "library_document_versions"("organizationId", "scanStatus");
CREATE UNIQUE INDEX "library_document_versions_organizationId_id_key" ON "library_document_versions"("organizationId", "id");
CREATE UNIQUE INDEX "library_document_versions_organizationId_documentId_id_key" ON "library_document_versions"("organizationId", "documentId", "id");
CREATE UNIQUE INDEX "library_document_versions_organizationId_documentId_version_key" ON "library_document_versions"("organizationId", "documentId", "versionNumber");
CREATE UNIQUE INDEX "library_file_blobs_versionId_key" ON "library_file_blobs"("versionId");
CREATE INDEX "library_file_blobs_organizationId_idx" ON "library_file_blobs"("organizationId");
CREATE UNIQUE INDEX "library_file_blobs_organizationId_versionId_key" ON "library_file_blobs"("organizationId", "versionId");
CREATE UNIQUE INDEX "library_file_blobs_storageBucket_storageKey_key" ON "library_file_blobs"("storageBucket", "storageKey");
CREATE INDEX "room_view_folders_organizationId_roomId_parentId_idx" ON "room_view_folders"("organizationId", "roomId", "parentId");
CREATE UNIQUE INDEX "room_view_folders_organizationId_id_key" ON "room_view_folders"("organizationId", "id");
CREATE UNIQUE INDEX "room_view_folders_organizationId_roomId_id_key" ON "room_view_folders"("organizationId", "roomId", "id");
CREATE UNIQUE INDEX "room_view_folders_roomId_libraryFolderId_key" ON "room_view_folders"("roomId", "libraryFolderId");
CREATE UNIQUE INDEX "room_view_folders_roomId_path_key" ON "room_view_folders"("roomId", "path");
CREATE INDEX "room_view_documents_organizationId_roomId_status_idx" ON "room_view_documents"("organizationId", "roomId", "status");
CREATE INDEX "room_view_documents_organizationId_libraryDocumentId_idx" ON "room_view_documents"("organizationId", "libraryDocumentId");
CREATE UNIQUE INDEX "room_view_documents_organizationId_id_key" ON "room_view_documents"("organizationId", "id");
CREATE UNIQUE INDEX "room_view_documents_roomId_libraryDocumentId_key" ON "room_view_documents"("roomId", "libraryDocumentId");

ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_organizationId_parentId_fkey" FOREIGN KEY ("organizationId", "parentId") REFERENCES "library_folders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_organizationId_folderId_fkey" FOREIGN KEY ("organizationId", "folderId") REFERENCES "library_folders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_document_versions" ADD CONSTRAINT "library_document_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "library_document_versions" ADD CONSTRAINT "library_document_versions_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "library_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_file_blobs" ADD CONSTRAINT "library_file_blobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "library_file_blobs" ADD CONSTRAINT "library_file_blobs_organizationId_versionId_fkey" FOREIGN KEY ("organizationId", "versionId") REFERENCES "library_document_versions"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_view_folders" ADD CONSTRAINT "room_view_folders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_view_folders" ADD CONSTRAINT "room_view_folders_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "rooms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_view_folders" ADD CONSTRAINT "room_view_folders_organizationId_libraryFolderId_fkey" FOREIGN KEY ("organizationId", "libraryFolderId") REFERENCES "library_folders"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_view_folders" ADD CONSTRAINT "room_view_folders_organizationId_roomId_parentId_fkey" FOREIGN KEY ("organizationId", "roomId", "parentId") REFERENCES "room_view_folders"("organizationId", "roomId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_view_documents" ADD CONSTRAINT "room_view_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_view_documents" ADD CONSTRAINT "room_view_documents_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "rooms"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_view_documents" ADD CONSTRAINT "room_view_documents_organizationId_libraryDocumentId_fkey" FOREIGN KEY ("organizationId", "libraryDocumentId") REFERENCES "library_documents"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_view_documents" ADD CONSTRAINT "room_view_documents_organizationId_libraryDocumentId_publi_fkey" FOREIGN KEY ("organizationId", "libraryDocumentId", "publishedVersionId") REFERENCES "library_document_versions"("organizationId", "documentId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_view_documents" ADD CONSTRAINT "room_view_documents_organizationId_roomId_folderId_fkey" FOREIGN KEY ("organizationId", "roomId", "folderId") REFERENCES "room_view_folders"("organizationId", "roomId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "room_view_documents" ADD CONSTRAINT "room_view_documents_published_version_required" CHECK ("status" <> 'PUBLISHED' OR "publishedVersionId" IS NOT NULL);

CREATE FUNCTION enforce_immutable_room_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."mode" IS DISTINCT FROM NEW."mode" THEN
    RAISE EXCEPTION 'room mode is immutable after creation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER room_mode_immutable BEFORE UPDATE OF "mode" ON "rooms" FOR EACH ROW EXECUTE FUNCTION enforce_immutable_room_mode();

CREATE FUNCTION enforce_company_view_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "rooms" room
    WHERE room."organizationId" = NEW."organizationId"
      AND room."id" = NEW."roomId"
      AND room."mode" = 'COMPANY_VIEW'
  ) THEN
    RAISE EXCEPTION 'company view binding requires a company view room' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER room_view_folder_mode_guard BEFORE INSERT OR UPDATE ON "room_view_folders"
  FOR EACH ROW EXECUTE FUNCTION enforce_company_view_binding();
CREATE TRIGGER room_view_document_mode_guard BEFORE INSERT OR UPDATE ON "room_view_documents"
  FOR EACH ROW EXECUTE FUNCTION enforce_company_view_binding();

CREATE FUNCTION enforce_clean_library_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'PUBLISHED' AND NOT EXISTS (
    SELECT 1
    FROM "library_document_versions" version
    JOIN "library_file_blobs" blob
      ON blob."organizationId" = version."organizationId" AND blob."versionId" = version."id"
    WHERE version."organizationId" = NEW."organizationId"
      AND version."documentId" = NEW."libraryDocumentId"
      AND version."id" = NEW."publishedVersionId"
      AND version."scanStatus" = 'CLEAN'
  ) THEN
    RAISE EXCEPTION 'published library version must be clean and have a file blob' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER room_view_document_clean_publication BEFORE INSERT OR UPDATE ON "room_view_documents"
  FOR EACH ROW EXECUTE FUNCTION enforce_clean_library_publication();

ALTER TABLE "library_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_folders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "library_folders_org_isolation" ON "library_folders" FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "library_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "library_documents_org_isolation" ON "library_documents" FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "library_document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_document_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "library_document_versions_org_isolation" ON "library_document_versions" FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "library_file_blobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "library_file_blobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "library_file_blobs_org_isolation" ON "library_file_blobs" FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "room_view_folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_view_folders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "room_view_folders_org_isolation" ON "room_view_folders" FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "room_view_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_view_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "room_view_documents_org_isolation" ON "room_view_documents" FOR ALL
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

