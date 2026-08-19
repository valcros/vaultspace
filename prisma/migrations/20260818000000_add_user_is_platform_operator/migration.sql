-- AlterTable
-- Explicit, platform-level grant for the cross-tenant SysOp control plane.
-- Defaults to false so no existing user is a platform operator until granted.
ALTER TABLE "users" ADD COLUMN "isPlatformOperator" BOOLEAN NOT NULL DEFAULT false;
