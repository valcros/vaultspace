-- Add ADMIN_MESSAGE_SENT to EventType enum for admin message audit trail.
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ADMIN_MESSAGE_SENT';
