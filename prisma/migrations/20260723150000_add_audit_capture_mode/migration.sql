-- Organization-scoped audit rollout. Default OFF keeps all existing tenants
-- unchanged until an operator explicitly enables SHADOW or AUTHORITATIVE.
CREATE TYPE "AuditCaptureMode" AS ENUM ('OFF', 'SHADOW', 'AUTHORITATIVE');

ALTER TABLE "organizations"
ADD COLUMN "auditCaptureMode" "AuditCaptureMode" NOT NULL DEFAULT 'OFF';

-- Dedicated denied-access event avoids overloading successful LINK_ACCESSED
-- events and allows rate-limited security monitoring without request bodies.
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'LINK_ACCESS_DENIED';

-- lastActivityAt is now advanced only by explicit viewer interactions. A
-- database default preserves safe creation from any current or older client.
ALTER TABLE "view_sessions"
ALTER COLUMN "lastActivityAt" SET DEFAULT CURRENT_TIMESTAMP;
