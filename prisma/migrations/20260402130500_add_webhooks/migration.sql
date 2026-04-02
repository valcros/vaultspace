-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "secret" VARCHAR(255) NOT NULL,
    "description" VARCHAR(255),
    "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roomId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhooks_organizationId_idx" ON "webhooks"("organizationId");

-- CreateIndex
CREATE INDEX "webhooks_roomId_idx" ON "webhooks"("roomId");

-- CreateIndex
CREATE INDEX "webhooks_isActive_idx" ON "webhooks"("isActive");

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;

-- RLS Policy: tenant isolation
CREATE POLICY "webhooks_tenant_isolation" ON "webhooks"
    USING ("organizationId" = current_setting('app.current_org_id', true));
