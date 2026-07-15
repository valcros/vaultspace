-- Room-gated viewer version history. When enabled, viewers may see and download
-- a document's prior versions (download still subject to the link's permission).
ALTER TABLE "rooms" ADD COLUMN "allowViewerVersionHistory" BOOLEAN NOT NULL DEFAULT false;
