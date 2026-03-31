-- Add unique constraint on PreviewAsset for idempotent upserts.
-- Prevents duplicate THUMBNAIL rows when concurrent requests or retries
-- try to generate the same thumbnail.
CREATE UNIQUE INDEX "preview_assets_versionId_assetType_pageNumber_key"
  ON "preview_assets" ("versionId", "assetType", "pageNumber");
