-- CreateTable
CREATE TABLE "user_dashboard_layouts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "desktopLayout" JSONB NOT NULL,
    "collapsedWidgets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "densityMode" VARCHAR(20) NOT NULL DEFAULT 'cozy',
    "welcomeBannerDismissed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_dashboard_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_dashboard_layouts_organizationId_idx" ON "user_dashboard_layouts"("organizationId");

-- CreateIndex
CREATE INDEX "user_dashboard_layouts_userId_idx" ON "user_dashboard_layouts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_dashboard_layouts_organizationId_userId_role_key" ON "user_dashboard_layouts"("organizationId", "userId", "role");

-- AddForeignKey
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dashboard_layouts" ADD CONSTRAINT "user_dashboard_layouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
