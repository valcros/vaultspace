-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuestionPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'NOT_APPLICABLE');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'QUESTION_SUBMITTED';
ALTER TYPE "EventType" ADD VALUE 'QUESTION_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'QUESTION_CLOSED';
ALTER TYPE "EventType" ADD VALUE 'ANSWER_SUBMITTED';
ALTER TYPE "EventType" ADD VALUE 'CHECKLIST_CREATED';
ALTER TYPE "EventType" ADD VALUE 'CHECKLIST_ITEM_UPDATED';
ALTER TYPE "EventType" ADD VALUE 'CHECKLIST_ITEM_COMPLETED';

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "documentId" TEXT,
    "askedByUserId" TEXT,
    "askedByEmail" VARCHAR(255) NOT NULL,
    "askedByName" VARCHAR(255),
    "viewSessionId" TEXT,
    "subject" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "QuestionPriority" NOT NULL DEFAULT 'NORMAL',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answeredByUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklists" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "documentId" TEXT,
    "assignedToEmail" VARCHAR(255),
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "questions_organizationId_idx" ON "questions"("organizationId");
CREATE INDEX "questions_roomId_idx" ON "questions"("roomId");
CREATE INDEX "questions_documentId_idx" ON "questions"("documentId");
CREATE INDEX "questions_roomId_status_idx" ON "questions"("roomId", "status");
CREATE INDEX "questions_askedByEmail_idx" ON "questions"("askedByEmail");
CREATE INDEX "questions_createdAt_idx" ON "questions"("createdAt");

-- CreateIndex
CREATE INDEX "answers_organizationId_idx" ON "answers"("organizationId");
CREATE INDEX "answers_questionId_idx" ON "answers"("questionId");
CREATE INDEX "answers_createdAt_idx" ON "answers"("createdAt");

-- CreateIndex
CREATE INDEX "checklists_organizationId_idx" ON "checklists"("organizationId");
CREATE INDEX "checklists_roomId_idx" ON "checklists"("roomId");

-- CreateIndex
CREATE INDEX "checklist_items_organizationId_idx" ON "checklist_items"("organizationId");
CREATE INDEX "checklist_items_checklistId_idx" ON "checklist_items"("checklistId");
CREATE INDEX "checklist_items_documentId_idx" ON "checklist_items"("documentId");
CREATE INDEX "checklist_items_status_idx" ON "checklist_items"("status");
CREATE UNIQUE INDEX "checklist_items_checklistId_sortOrder_key" ON "checklist_items"("checklistId", "sortOrder");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_askedByUserId_fkey" FOREIGN KEY ("askedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "questions" ADD CONSTRAINT "questions_viewSessionId_fkey" FOREIGN KEY ("viewSessionId") REFERENCES "view_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "answers" ADD CONSTRAINT "answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "answers" ADD CONSTRAINT "answers_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
