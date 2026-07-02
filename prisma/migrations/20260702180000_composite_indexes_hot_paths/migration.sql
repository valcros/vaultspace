-- Composite indexes for the query shapes the dashboard, inbox, and room
-- surfaces actually use (optimization audit 2026-07-02, finding 8).
-- Additive only; no data changes.

-- CreateIndex
CREATE INDEX "page_views_organizationId_userId_createdAt_idx" ON "page_views"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "questions_organizationId_askedByUserId_idx" ON "questions"("organizationId", "askedByUserId");

-- CreateIndex
CREATE INDEX "questions_organizationId_status_idx" ON "questions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "messages_organizationId_recipientUserId_isRead_idx" ON "messages"("organizationId", "recipientUserId", "isRead");

-- CreateIndex
CREATE INDEX "messages_organizationId_isAnnouncement_createdAt_idx" ON "messages"("organizationId", "isAnnouncement", "createdAt");

-- CreateIndex
CREATE INDEX "events_organizationId_createdAt_idx" ON "events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "events_organizationId_eventType_createdAt_idx" ON "events"("organizationId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "rooms_organizationId_status_updatedAt_idx" ON "rooms"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "documents_organizationId_status_createdAt_idx" ON "documents"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "documents_roomId_status_folderId_idx" ON "documents"("roomId", "status", "folderId");

-- CreateIndex
CREATE INDEX "access_requests_organizationId_status_createdAt_idx" ON "access_requests"("organizationId", "status", "createdAt");
