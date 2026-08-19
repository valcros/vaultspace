-- SysOp organization lifecycle audit event types.
-- Separate migration from the function below because ALTER TYPE ... ADD VALUE
-- cannot be used in the same transaction that later references the value, and
-- this mirrors the existing sysop-audit event-type migration (20260819000000).
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ORG_DISABLED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ORG_ENABLED';
