-- Logos/favicons are stored as base64 data URLs, which overflow VarChar(500).
-- Widen the branding URL columns to text.
ALTER TABLE "organizations" ALTER COLUMN "logoUrl" TYPE text;
ALTER TABLE "organizations" ALTER COLUMN "faviconUrl" TYPE text;
ALTER TABLE "rooms" ALTER COLUMN "brandLogoUrl" TYPE text;
