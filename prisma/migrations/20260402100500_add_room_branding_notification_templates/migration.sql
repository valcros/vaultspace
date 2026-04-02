-- Room-level branding fields
ALTER TABLE "rooms" ADD COLUMN "brandColor" VARCHAR(7);
ALTER TABLE "rooms" ADD COLUMN "brandLogoUrl" VARCHAR(500);

-- Notification templates table
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateKey" VARCHAR(100) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "notification_templates_organizationId_idx" ON "notification_templates"("organizationId");

-- Unique constraint
CREATE UNIQUE INDEX "notification_templates_organizationId_templateKey_key" ON "notification_templates"("organizationId", "templateKey");

-- Foreign key
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
