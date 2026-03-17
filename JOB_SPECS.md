# JOB_SPECS.md - VaultSpace Background Job Specification

**Document Version:** 1.0
**Feature ID:** F100 (Job infrastructure), F101-F107 (Job types)
**Last Updated:** 2026-03-14
**Status:** Implementation-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Job Infrastructure](#job-infrastructure)
3. [BullMQ Configuration](#bullmq-configuration)
4. [Job Catalog](#job-catalog)
5. [Retry Policies](#retry-policies)
6. [Dead Letter Queue](#dead-letter-queue)
7. [Job Lifecycle Events](#job-lifecycle-events)
8. [Scheduled Jobs](#scheduled-jobs)
9. [Worker Scaling Guide](#worker-scaling-guide)
10. [TypeScript Interfaces](#typescript-interfaces)
11. [BullMQ Setup Example](#bullmq-setup-example)

---

## Overview

VaultSpace uses **BullMQ + Redis** for reliable background job processing. This enables:

- **Multi-priority queuing** (high, normal, low, scheduled) to ensure time-critical work (virus scanning, preview generation) blocks UI
- **Automatic retry with exponential backoff** to handle transient failures
- **Worker type specialization** (scan, preview, email, reporting) for optimal resource allocation
- **Event-driven architecture** where all job transitions emit EventBus events for audit trail and monitoring
- **Idempotency guarantees** to safely re-run jobs without data corruption
- **Dead letter queue** for manual intervention and admin visibility

**Fallback:** For single-container deployments without Redis, an in-process queue implementation maintains the same interface but without distributed concurrency.

---

## Job Infrastructure

### Queue Topology

VaultSpace maintains **four logical queues** backed by Redis:

| Queue Name    | Priority                   | Use Cases                                       | Processing Order    |
| ------------- | -------------------------- | ----------------------------------------------- | ------------------- |
| **high**      | FIFO (no reprioritization) | document.scan, preview.generate, text.extract   | First-in-first-out  |
| **normal**    | FIFO                       | email.send, notification.dispatch, search.index | First-in-first-out  |
| **low**       | FIFO                       | export.zip, backup.snapshot, analytics          | First-in-first-out  |
| **scheduled** | Cron-based                 | audit.compact, cleanup.expired, cleanup.trash   | Time-based triggers |

**Key Design:**

- Within each queue, jobs are processed in **FIFO order** (arrival time)
- BullMQ concurrency settings determine how many jobs per queue/worker run simultaneously
- Scheduled queue jobs are triggered by cron expressions (Redis triggers via BullMQ's native repeat API)
- No job preemption: once a job starts, it runs to completion (or timeout)

### Worker Types

Four dedicated worker processes handle different job classes:

```
┌─────────────────────────────────────────────────────────┐
│                  Job Queues (Redis)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────┐  ┌──────────────┐
│  │  High Q  │  │ Normal Q │  │Low Q │  │ Scheduled Q  │
│  └──────────┘  └──────────┘  └──────┘  └──────────────┘
└─────────────────────────────────────────────────────────┘
        │              │           │            │
        ▼              ▼           ▼            ▼
    ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐
    │   Scan      │ │ General  │ │ Report   │ │  Scheduled  │
    │   Worker    │ │ Worker   │ │ Worker   │ │  Processor  │
    │ (CPU bound) │ │ (I/O)    │ │ (I/O)    │ │ (Triggers)  │
    │ Concur: 2   │ │ Concur: 4│ │ Concur:1 │ │ Concur: N/A │
    └─────────────┘ └──────────┘ └──────────┘ └─────────────┘
           │              │           │            │
           └──────────────┴───────────┴────────────┘
             All emit job lifecycle events
             to EventBus for audit trail
```

#### Worker Responsibilities

**Preview Worker** (preview-worker)

- Processes `preview.generate` and `text.extract` jobs
- Invokes Gotenberg or LibreOffice for format conversion
- Orchestrates OCR for scanned documents
- Computes page count and text extraction
- I/O-heavy, runs preview pipeline sequentially per document
- Recommended concurrency: 2-3 concurrent jobs (Docker memory: 2-4GB)

**Scan Worker** (scan-worker)

- Processes `document.scan` jobs
- Interfaces with ClamAV daemon for virus scanning
- Returns scan status (clean/infected/error)
- CPU/I/O-bound, low concurrency to avoid overwhelming ClamAV
- Recommended concurrency: 2 concurrent jobs (Docker memory: 1-2GB)

**General Worker** (general-worker)

- Processes `email.send`, `notification.dispatch`, `search.index`, `hash.compute` jobs
- Also handles scheduled jobs: `audit.compact`, `cleanup.expired`, `cleanup.trash`
- Network I/O-heavy (email, database, search API)
- Recommended concurrency: 4-6 concurrent jobs (Docker memory: 1-2GB)

**Report Worker** (report-worker)

- Processes `export.zip`, `backup.snapshot` jobs
- Long-running, memory-intensive operations
- Generates ZIP files, database snapshots
- Recommended concurrency: 1 concurrent job (Docker memory: 4-8GB)

### Redis Configuration

```typescript
// Connection pooling: shared Redis instance
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  // Connection pool
  maxRetriesPerRequest: null, // Unlimited retries for blocking ops
  enableReadyCheck: false,
  enableOfflineQueue: true,

  // Timeouts
  connectTimeout: 10000,
  commandTimeout: 60000, // Long jobs may take time

  // Reconnection
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

// BullMQ queues use same Redis connection
const queueOptions = {
  connection: redis,
  settings: {
    maxStalledInterval: 5000, // Check for stalled jobs every 5s
    maxStalledCount: 2, // Move to failed after 2 staleness detections
    lockDuration: 30000, // Lock job for 30s during processing
    lockRenewTime: 15000, // Renew lock every 15s
  },
};
```

**Fallback (No Redis):**

```typescript
// Single-instance in-process queue (no distributed concurrency)
class InProcessJobProvider implements JobProvider {
  private queue = new Map<string, Job[]>();
  private activeJobs = new Map<string, Job>();

  async enqueueJob<T>(
    queueName: string,
    jobType: string,
    payload: T,
    options?: JobOptions
  ): Promise<Job> {
    const job = {
      id: generateId(),
      queueName,
      jobType,
      payload,
      status: 'pending' as const,
      attempts: 0,
    };

    if (!this.queue.has(queueName)) {
      this.queue.set(queueName, []);
    }
    this.queue.get(queueName)!.push(job);
    return job;
  }

  // Process jobs sequentially from queue
  // No parallel execution, no Redis persistence
}
```

---

## BullMQ Configuration

### Queue Setup

Each worker type requires initialization of its queues:

```typescript
// src/lib/providers/job/BullMqJobProvider.ts

interface QueueConfig {
  name: string;
  concurrency: number;
  workerType: 'general' | 'preview' | 'scan' | 'report' | 'scheduled';
  timeout: number; // milliseconds
}

const QUEUE_CONFIGS: QueueConfig[] = [
  {
    name: 'high',
    concurrency: 6,
    workerType: 'scan', // scan-worker + preview-worker
    timeout: 600000, // 10 minutes
  },
  {
    name: 'normal',
    concurrency: 8,
    workerType: 'general',
    timeout: 300000, // 5 minutes
  },
  {
    name: 'low',
    concurrency: 4,
    workerType: 'report',
    timeout: 900000, // 15 minutes
  },
  {
    name: 'scheduled',
    concurrency: 2, // Cron processor, not worker concurrency
    workerType: 'scheduled',
    timeout: 3600000, // 1 hour for long-running scheduled tasks
  },
];

export class BullMqJobProvider implements JobProvider {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private connection: Redis;

  constructor(redisConnection: Redis) {
    this.connection = redisConnection;
    this.initializeQueues();
  }

  private initializeQueues() {
    for (const config of QUEUE_CONFIGS) {
      const queue = new Queue(config.name, {
        connection: this.connection,
        settings: {
          maxStalledInterval: 5000,
          maxStalledCount: 2,
          lockDuration: 30000,
          lockRenewTime: 15000,
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: true,
            removeOnFail: false, // Keep failed jobs for debugging
          },
        },
      });

      queue.on('error', (err) => {
        console.error(`Queue ${config.name} error:`, err);
      });

      this.queues.set(config.name, queue);
    }
  }

  async enqueueJob<T>(
    queueName: string,
    jobType: string,
    payload: T,
    options?: JobOptions
  ): Promise<Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Unknown queue: ${queueName}`);
    }

    const bullMqJob = await queue.add(jobType, payload, {
      priority: options?.priority ? this.getPriority(options.priority) : 0,
      attempts: options?.attempts || 3,
      backoff: options?.backoff || { type: 'exponential', delay: 2000 },
      delay: options?.delay || 0,
      timeout: options?.timeout || 300000,
      jobId: `${jobType}-${generateId()}`, // Enables idempotency
      removeOnComplete: true,
      removeOnFail: false,
    });

    return {
      id: bullMqJob.id!,
      queueName,
      jobType,
      payload,
      status: 'pending',
      attempts: 0,
    };
  }

  private getPriority(level: 'high' | 'normal' | 'low'): number {
    // BullMQ: lower number = higher priority
    switch (level) {
      case 'high':
        return 10;
      case 'normal':
        return 50;
      case 'low':
        return 100;
      default:
        return 50;
    }
  }

  async onJobComplete(
    queueName: string,
    jobType: string,
    handler: (job: Job, result: any) => Promise<void>
  ): void {
    const queue = this.queues.get(queueName);
    if (!queue) return;

    const worker = new Worker(
      queueName,
      async (bullMqJob) => {
        if (bullMqJob.name === jobType) {
          // Process job
          const result = await this.processJob(bullMqJob);

          // Emit event
          await handler(
            {
              id: bullMqJob.id!,
              queueName,
              jobType,
              payload: bullMqJob.data,
              status: 'completed',
              attempts: bullMqJob.attemptsMade,
              result,
            },
            result
          );
        }
      },
      { connection: this.connection }
    );

    worker.on('failed', async (job, err) => {
      if (job?.name === jobType) {
        // Check if job exceeded max retries
        if (job.attemptsMade >= job.opts.attempts!) {
          // Move to dead letter queue
          await this.moveToDeadLetter(job);
        }
      }
    });

    this.workers.set(`${queueName}:${jobType}`, worker);
  }

  private async moveToDeadLetter(job: BullMQ.Job): Promise<void> {
    const deadQueue = this.queues.get('dead') || new Queue('dead', { connection: this.connection });

    await deadQueue.add(
      `dead:${job.name}`,
      {
        originalJobId: job.id,
        originalQueue: job.queueName,
        originalJobType: job.name,
        payload: job.data,
        error: job.failedReason,
        attempts: job.attemptsMade,
        failedAt: new Date(),
      },
      {
        removeOnComplete: false,
        removeOnFail: false,
      }
    );

    // Emit event for monitoring
    await this.eventBus.emit('job.dead_lettered', {
      jobId: job.id,
      jobType: job.name,
      queue: job.queueName,
      error: job.failedReason,
      attempts: job.attemptsMade,
    });
  }
}
```

---

## Job Catalog

### Document Processing

#### document.scan

**Purpose:** Scan uploaded document for viruses using ClamAV before allowing access.

**Queue:** high
**Worker Type:** scan-worker
**Priority:** CRITICAL - blocks document viewership until complete
**Payload:**

```typescript
interface ScanJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string; // Path in storage (e.g., s3://bucket/docs/doc-123/v1.pdf)
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
}
```

**Retry Policy:**

- Max Attempts: 3
- Backoff: Exponential (30s initial, 5m max)
- Timeout: 300s (5 minutes)

**Idempotency:**

- Job ID: `document.scan-{documentId}-{versionId}`
- Detect duplicate: Check if `document.scanStatus` already contains this versionId
- Safe retry: Re-scan returns same result; updates idempotent record

**Events Emitted:**

- `job.queued` → `{ jobId, jobType: 'document.scan', documentId }`
- `job.started` → `{ jobId, documentId }`
- `job.completed` → `{ jobId, documentId, versionId, scanStatus: 'clean' | 'infected', threats?: [] }`
- `job.failed` → `{ jobId, documentId, error, attemptsMade }`

**Dead Letter Behavior:**
If scan fails after 3 attempts, document remains in `SCAN_PENDING` state. Admin notified via dashboard. Manual retry available.

**Implementation Notes:**

- Calls `ScanProvider.scan(storageKey)` → ClamAV daemon
- Updates `Document.scanStatus` to `CLEAN` or `INFECTED`
- If infected, emits `document.flagged_infected` event (blocks viewing, notifies room admin)
- If error, remains in `SCAN_PENDING` until manual retry

---

#### preview.generate

**Purpose:** Convert document to PDF, extract page count, generate first-page thumbnail.

**Queue:** high
**Worker Type:** preview-worker
**Priority:** HIGH - blocks document viewing
**Payload:**

```typescript
interface PreviewGenerateJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string; // Original document
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  isScanned: boolean; // Hint: if true, OCR may be needed
}
```

**Retry Policy:**

- Max Attempts: 3
- Backoff: Exponential (60s initial, 10m max)
- Timeout: 600s (10 minutes) for large documents

**Idempotency:**

- Job ID: `preview.generate-{documentId}-{versionId}`
- Detect duplicate: Check if `DocumentVersion.previewKey` is already set
- Safe retry: Re-run preview generation overwrites existing preview

**Events Emitted:**

- `job.queued` → `{ jobId, documentId }`
- `job.started` → `{ jobId, documentId }`
- `job.completed` → `{ jobId, documentId, versionId, pageCount, previewKey, textKey }`
- `job.failed` → `{ jobId, documentId, error }`

**Dead Letter Behavior:**
Document remains `PREVIEW_PENDING`. Admin dashboard shows failed preview job. Manual retry or skip (view original file only) available.

**Implementation Notes:**

- Calls `PreviewProvider.convertToPreview()` via Gotenberg
- Stores PDF at `storage://{organizationId}/previews/{documentId}/{versionId}.pdf`
- Generates thumbnail: `preview.generate_thumbnail-{documentId}` (triggered by completion event)
- If OCR needed (scanned doc), calls `PreviewProvider.extractText()` internally

---

#### text.extract

**Purpose:** Extract full text from document for search indexing. Part of preview pipeline; can run standalone if needed.

**Queue:** high
**Worker Type:** preview-worker
**Priority:** HIGH - blocks search indexing
**Payload:**

```typescript
interface TextExtractJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string; // Original or preview PDF
  contentType: string;
  fileName: string;
  pageCount?: number; // If available from preview
  language?: string; // ISO language code for OCR, default 'en'
}
```

**Retry Policy:**

- Max Attempts: 3
- Backoff: Exponential (60s initial, 10m max)
- Timeout: 600s

**Idempotency:**

- Job ID: `text.extract-{documentId}-{versionId}`
- Detect duplicate: Check if `DocumentVersion.textKey` is already set
- Safe retry: Re-extraction overwrites text

**Events Emitted:**

- `job.completed` → `{ jobId, documentId, versionId, textLength, textKey, ocrApplied }`
- `job.failed` → `{ jobId, documentId, error }`

**Dead Letter Behavior:**
Document searchable only by filename/metadata. Manual retry triggers re-extraction.

**Implementation Notes:**

- Calls `PreviewProvider.extractText()` (orchestrates OCR for scanned documents)
- Stores extracted text at `storage://{organizationId}/text/{documentId}/{versionId}.txt`
- Emits `text.extracted` event with text length for analytics
- Triggers `search.index` job on completion

---

### Search & Analytics

#### search.index

**Purpose:** Index extracted document text in search engine (PostgreSQL FTS, Meilisearch, etc.).

**Queue:** normal
**Worker Type:** general-worker
**Priority:** NORMAL - async indexing, non-blocking
**Payload:**

```typescript
interface SearchIndexJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  roomId: string;
  fileName: string;
  text: string; // Extracted text from text.extract job
  metadata?: {
    author?: string;
    uploadedAt?: string;
    pageCount?: number;
  };
}
```

**Retry Policy:**

- Max Attempts: 3
- Backoff: Exponential (60s initial, 10m max)
- Timeout: 120s

**Idempotency:**

- Job ID: `search.index-{documentId}-{versionId}`
- Detect duplicate: Check if `SearchIndex.version` matches versionId
- Safe retry: Re-indexing updates search engine index

**Events Emitted:**

- `job.completed` → `{ jobId, documentId, indexed: true }`
- `job.failed` → `{ jobId, documentId, error }`

**Dead Letter Behavior:**
Document not searchable. Retrigger from admin dashboard or wait for next text.extract completion.

**Implementation Notes:**

- Calls `SearchProvider.indexDocument()`
- If SearchProvider is PostgreSQL FTS: UPDATE search_index table
- If Meilisearch: POST /documents with documentId as key
- Upsert semantics: update existing index entry if versionId exists

---

#### hash.compute

**Purpose:** Compute SHA-256 hash of document version for integrity verification and deduplication.

**Queue:** normal
**Worker Type:** general-worker
**Priority:** NORMAL
**Payload:**

```typescript
interface HashComputeJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string; // Original document
}
```

**Retry Policy:**

- Max Attempts: 2
- Backoff: Exponential (30s initial, 5m max)
- Timeout: 60s

**Idempotency:**

- Job ID: `hash.compute-{documentId}-{versionId}`
- Detect duplicate: Check if `DocumentVersion.sha256` is already set
- Safe retry: Re-computing hash is deterministic

**Events Emitted:**

- `job.completed` → `{ jobId, documentId, versionId, sha256Hash }`

**Implementation Notes:**

- Stream file from storage, compute SHA-256
- Store hash in `DocumentVersion.sha256`
- Used for: duplicate detection, integrity verification, legal holds

---

### Communications

#### email.send

**Purpose:** Send transactional emails (invitations, activity summaries, alerts).

**Queue:** normal
**Worker Type:** general-worker
**Priority:** NORMAL - async delivery
**Payload:**

```typescript
interface EmailSendJobPayload {
  jobId: string;
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  template?: string; // e.g., 'invitation', 'activity_digest'
  templateData?: Record<string, any>;
  bodyText?: string; // Fallback if no template
  htmlBody?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
  organizationId: string; // For audit trail
}
```

**Retry Policy:**

- Max Attempts: 5 (transient network failures)
- Backoff: Exponential (60s initial, 30m max)
- Timeout: 120s per attempt

**Idempotency:**

- Job ID: `email.send-{uuid}` (set by caller)
- Detect duplicate: Check `Email.jobId` in database before sending
- Safe retry: Email provider should deduplicate by jobId (idempotency key)

**Events Emitted:**

- `job.completed` → `{ jobId, to, status: 'sent', messageId }`
- `job.failed` → `{ jobId, to, error, attempts }`

**Dead Letter Behavior:**
Email moved to dead letter after 5 failures. Admin can retry manually or dismiss. Alert operator.

**Implementation Notes:**

- Calls `EmailProvider.send()` (SMTP, SendGrid, etc.)
- Logs email in `Email` table for audit trail
- Handles template rendering (Handlebars, etc.)
- Sets `X-Idempotency-Key: {jobId}` header for provider deduplication

---

#### notification.dispatch

**Purpose:** Process user notification preferences and dispatch alerts (email, in-app, webhook).

**Queue:** normal
**Worker Type:** general-worker
**Priority:** NORMAL
**Payload:**

```typescript
interface NotificationDispatchJobPayload {
  organizationId: string;
  eventType: string; // e.g., 'document.uploaded', 'room.archived'
  eventId: string; // Event ID from EventBus
  targetUserIds?: string[]; // Specific users, or null for broadcast to room
  roomId?: string;
  documentId?: string;
  metadata: Record<string, any>;
}
```

**Retry Policy:**

- Max Attempts: 3
- Backoff: Exponential (60s initial, 10m max)
- Timeout: 180s

**Idempotency:**

- Job ID: `notification.dispatch-{eventId}`
- Detect duplicate: Check if `Notification` record exists for this event
- Safe retry: Update existing notification (mark read/unread idempotent)

**Events Emitted:**

- `job.completed` → `{ jobId, eventId, notificationsSent: number }`
- `job.failed` → `{ jobId, eventId, error }`

**Implementation Notes:**

- Queries user notification preferences (email, in-app, do-not-disturb)
- Sends email via `email.send` job if user opted in
- Creates `InAppNotification` record for dashboard
- Triggers webhook dispatch if webhook subscriptions exist

---

### Export & Reporting

#### export.zip

**Purpose:** Generate ZIP file containing selected documents or entire room for download.

**Queue:** low
**Worker Type:** report-worker
**Priority:** LOW - can wait, user initiates
**Payload:**

```typescript
interface ExportZipJobPayload {
  exportId: string;
  organizationId: string;
  roomId: string;
  documentIds?: string[]; // Null = export entire room
  includeMetadata: boolean;
  format: 'pdf' | 'original';
  requestedByUserId: string;
}
```

**Retry Policy:**

- Max Attempts: 2
- Backoff: Exponential (120s initial, 15m max)
- Timeout: 1800s (30 minutes) for large rooms

**Idempotency:**

- Job ID: `export.zip-{exportId}`
- Detect duplicate: Check if `Export.storageKey` is already set
- Safe retry: Delete partial ZIP and regenerate

**Events Emitted:**

- `job.queued` → `{ jobId, exportId, roomId }`
- `job.started` → `{ jobId, exportId }`
- `job.completed` → `{ jobId, exportId, zipKey, zipSize }`
- `job.failed` → `{ jobId, exportId, error }`

**Dead Letter Behavior:**
Export remains in `PENDING` state. User sees error in UI. Can retry manually.

**Implementation Notes:**

- Creates in-memory ZIP stream or temp file
- Iterates selected documents, adds to ZIP:
  - If format='pdf': use preview PDF
  - If format='original': use original file
- Includes manifest.json (metadata)
- Stores ZIP at `storage://{organizationId}/exports/{exportId}.zip`
- Generates signed download URL (5min expiry)
- Emits `export.completed` event (triggers email with download link)

---

#### backup.snapshot

**Purpose:** Snapshot database for backup/restore (scheduled nightly).

**Queue:** low
**Worker Type:** report-worker
**Priority:** LOW - scheduled maintenance
**Payload:**

```typescript
interface BackupSnapshotJobPayload {
  organizationId?: string; // Null = full system backup
  backupType: 'full' | 'incremental';
  retentionDays: number;
}
```

**Retry Policy:**

- Max Attempts: 1 (no retry; will run again tomorrow)
- Timeout: 3600s (1 hour)

**Idempotency:**

- Job ID: `backup.snapshot-{date}-{backupType}`
- Detect duplicate: Check if backup already exists for this date
- Safe retry: Scheduled jobs automatically re-run on next cron tick

**Events Emitted:**

- `job.completed` → `{ jobId, backupId, backupKey, backupSize }`
- `job.failed` → `{ jobId, error }`

**Implementation Notes:**

- Calls database provider (PostgreSQL `pg_dump`)
- Compresses backup (gzip)
- Stores at `storage://{organizationId}/backups/{date}-{backupType}.sql.gz`
- Updates `Backup` table with size, hash, retention deadline
- Triggers `cleanup.trash` job to remove old backups (older than retentionDays)

---

### Maintenance & Cleanup

#### audit.compact

**Purpose:** Nightly compaction of event log. Aggregate events by type/date, remove duplicates, compute analytics.

**Queue:** scheduled
**Worker Type:** general-worker
**Priority:** SCHEDULED - runs nightly at 2am UTC
**Payload:**

```typescript
interface AuditCompactJobPayload {
  organizationId?: string; // Null = system-wide
  compactionDate: string; // ISO date for previous day
}
```

**Retry Policy:**

- No retry (scheduled jobs auto-trigger next day if failed)
- Timeout: 1800s (30 minutes)

**Idempotency:**

- Job ID: `audit.compact-{compactionDate}`
- Detect duplicate: Check if `EventCompaction` record exists for this date
- Safe retry: Upsert compaction data (idempotent aggregation)

**Events Emitted:**

- `job.completed` → `{ jobId, compactionDate, eventsProcessed, aggregates }`

**Implementation Notes:**

- Queries `Event` table for previous day
- Groups events by `event_type`, `actor_type`, `status`
- Computes counts, min/max timestamps
- Stores aggregates in `EventCompaction` table (for analytics dashboard)
- Deletes raw events older than 90 days (configurable)
- Used by: Activity reports, audit dashboard, compliance exports

---

#### cleanup.expired

**Purpose:** Hourly cleanup of expired sessions, tokens, temporary uploads, share links.

**Queue:** scheduled
**Worker Type:** general-worker
**Priority:** SCHEDULED - runs hourly
**Payload:**

```typescript
interface CleanupExpiredJobPayload {
  organizationId?: string;
  cleanupTypes: Array<'sessions' | 'tokens' | 'uploads' | 'sharelinks'>;
}
```

**Retry Policy:**

- No retry
- Timeout: 600s (10 minutes)

**Idempotency:**

- Job ID: `cleanup.expired-{hour}`
- Detect duplicate: Last run timestamp prevents duplicate processing

**Events Emitted:**

- `job.completed` → `{ jobId, sessionsDeleted, tokensDeleted, uploadsDeleted }`

**Implementation Notes:**

- Delete `Session` records where `expiresAt < now()`
- Delete `ApiToken` records where `expiresAt < now()` and not `permanent`
- Delete `Upload` records where `createdAt < now() - 24h` and `status = 'abandoned'`
- Delete `ShareLink` records where `expiresAt < now()`
- Also deletes associated files in storage
- Emits `cleanup.completed` event with counts

---

#### cleanup.trash

**Purpose:** Daily permanent deletion of soft-deleted items past retention window (30 days by default).

**Queue:** scheduled
**Worker Type:** general-worker
**Priority:** SCHEDULED - runs daily at 3am UTC
**Payload:**

```typescript
interface CleanupTrashJobPayload {
  organizationId?: string;
  retentionDays: number; // Default 30
}
```

**Retry Policy:**

- No retry
- Timeout: 1800s (30 minutes) for large deletions

**Idempotency:**

- Job ID: `cleanup.trash-{date}`
- Detect duplicate: Tracks last run to prevent duplicate processing

**Events Emitted:**

- `job.completed` → `{ jobId, deletedDocuments, deletedRooms, deletedBytes }`

**Implementation Notes:**

- Finds `Document` records where `deletedAt < now() - 30 days`
- Cascade deletes: associated `DocumentVersion`, preview files, text, thumbnails
- Deletes storage files: `storage://{organizationId}/originals/*`, `previews/*`, `text/*`
- Updates `Document` with final deletion timestamp and reason='retention'
- Emits `document.hard_deleted` events for audit trail
- Does NOT restore; GDPR retention periods enforced

---

---

## Retry Policies

Retry behavior is consistent across job types. Policy table:

| Job Category                                 | Max Attempts | Backoff     | Initial Delay | Max Delay | Notes                       |
| -------------------------------------------- | ------------ | ----------- | ------------- | --------- | --------------------------- |
| **Scan** (document.scan)                     | 3            | Exponential | 30s           | 5m        | ClamAV often transient      |
| **Preview** (preview.generate, text.extract) | 3            | Exponential | 60s           | 10m       | I/O intensive               |
| **Email** (email.send)                       | 5            | Exponential | 60s           | 30m       | Network failures            |
| **Export** (export.zip, backup.snapshot)     | 2            | Exponential | 120s          | 15m       | Resource limits             |
| **Hash/Search** (hash.compute, search.index) | 3            | Exponential | 60s           | 10m       | Database/API flaky          |
| **Notification** (notification.dispatch)     | 3            | Exponential | 60s           | 10m       | Normal latency              |
| **Scheduled** (audit.compact, cleanup.\*)    | 1 (no retry) | —           | —             | —         | Runs again on next schedule |

**Backoff Strategy:**

Exponential backoff with jitter prevents thundering herd:

```typescript
// Exponential backoff: delay = min(initialDelay * 2^attempt, maxDelay) + random(0, 1s)
function computeBackoff(attempt: number, config: BackoffConfig): number {
  const exponential = Math.min(config.initialDelayMs * Math.pow(2, attempt), config.maxDelayMs);
  const jitter = Math.random() * 1000; // 0-1s random jitter
  return exponential + jitter;
}

// Example:
// Attempt 1: delay = min(30s * 2^0, 5m) + jitter = 30s + jitter
// Attempt 2: delay = min(30s * 2^1, 5m) + jitter = 60s + jitter
// Attempt 3: delay = min(30s * 2^2, 5m) + jitter = 120s (capped) + jitter
```

---

## Dead Letter Queue

### Overview

When a job exceeds max retry attempts, BullMQ moves it to the **dead letter queue** ("dead"). Dead jobs are immutable, visible in admin dashboard, and can be manually retried or dismissed.

### Storage & Visibility

**Dead Letter Table:**

```sql
CREATE TABLE dead_letter_jobs (
  id              STRING PRIMARY KEY,
  job_id          STRING UNIQUE,
  queue_name      STRING,
  job_type        STRING,
  payload         JSONB,
  error_message   TEXT,
  attempts_made   INT,
  failed_at       TIMESTAMP DEFAULT NOW(),
  dismissed_at    TIMESTAMP,
  dismissed_by    STRING,
  created_at      TIMESTAMP DEFAULT NOW(),

  CONSTRAINT dismissed_by_fk FOREIGN KEY (dismissed_by) REFERENCES users(id)
);

CREATE INDEX dead_letter_jobs_queue_type ON dead_letter_jobs(queue_name, job_type);
CREATE INDEX dead_letter_jobs_failed_at ON dead_letter_jobs(failed_at DESC);
```

**Admin Dashboard (Feature F040 - Admin Dashboard):**

Dead jobs visible in Admin UI under **Jobs** → **Dead Letter**:

```
┌─────────────────────────────────────────────────────────┐
│  Dead Letter Jobs                                        │
├─────────────────────────────────────────────────────────┤
│ Job ID      │ Type          │ Failed       │ Attempts   │
├─────────────────────────────────────────────────────────┤
│ email.send-xxx │ email.send    │ 2min ago     │ 5/5       │
│ preview.gen-yyy│ preview.gen   │ 5min ago     │ 3/3       │
│ export.zip-zzz │ export.zip    │ 1h ago       │ 2/2       │
└─────────────────────────────────────────────────────────┘

Details panel (click job):
  Job ID: email.send-xxx
  Queue: normal
  Attempts: 5 / 5
  Error: "Connection timeout to mail.example.com"
  Payload: { to: "user@example.com", subject: "..." }

  Actions:
    [Retry Now]  [View Logs]  [Dismiss]
```

### Admin Actions

**Retry Dead Job:**

```typescript
// Admin clicks [Retry Now]
async function retryDeadLetter(jobId: string, adminId: string) {
  const deadJob = await db.deadLetterJob.findUnique({
    where: { job_id: jobId },
  });

  if (!deadJob) throw new NotFoundError();

  // Re-enqueue to original queue
  const job = await jobQueue.enqueueJob(
    deadJob.queue_name,
    deadJob.job_type,
    deadJob.payload,
    { attempts: 1 } // Single retry
  );

  // Remove from dead letter
  await db.deadLetterJob.delete({ where: { job_id: jobId } });

  // Audit event
  await eventBus.emit('job.retried_from_dead_letter', {
    originalJobId: jobId,
    newJobId: job.id,
    adminId,
    jobType: deadJob.job_type,
  });
}
```

**Dismiss Dead Job:**

```typescript
// Admin clicks [Dismiss]
async function dismissDeadLetter(jobId: string, adminId: string) {
  await db.deadLetterJob.update({
    where: { job_id: jobId },
    data: {
      dismissed_at: new Date(),
      dismissed_by: adminId,
    },
  });

  await eventBus.emit('job.dead_letter_dismissed', {
    jobId,
    dismissedBy: adminId,
  });
}
```

### Dead Letter Retention

Dead letter jobs retained for **30 days**, then auto-deleted:

```typescript
// Scheduled cleanup job (daily)
async function cleanupDeadLetters() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const deleted = await db.deadLetterJob.deleteMany({
    where: {
      created_at: { lt: cutoff },
      dismissed_at: { not: null }, // Only delete dismissed jobs
    },
  });

  console.log(`Deleted ${deleted.count} old dead letter jobs`);
}
```

### Dead Letter Alerting

When a job enters dead letter queue, emit event for monitoring:

```typescript
// BullMqJobProvider.ts
worker.on('failed', async (job, err) => {
  if (job.attemptsMade >= job.opts.attempts!) {
    // Move to dead letter
    const deadJob = await moveToDeadLetter(job, err);

    // Alert
    await eventBus.emit('job.dead_lettered', {
      jobId: job.id,
      jobType: job.name,
      queue: job.queueName,
      error: err.message,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      severity: classifySeverity(job.name), // high/normal/low
    });
  }
});

function classifySeverity(jobType: string): 'high' | 'normal' | 'low' {
  if (['document.scan', 'preview.generate'].includes(jobType)) {
    return 'high'; // Block users from viewing
  }
  if (['email.send', 'notification.dispatch'].includes(jobType)) {
    return 'normal'; // Missed communication, but non-critical
  }
  return 'low'; // Analytics, cleanup
}
```

Monitoring systems can subscribe to `job.dead_lettered` events and:

- Trigger PagerDuty alert if severity='high'
- Log to centralized logging (ELK, Datadog)
- Send Slack notification to ops channel

---

## Job Lifecycle Events

Every job transition emits an EventBus event for audit trail and monitoring. Events follow the pattern:

```
job.queued → job.started → (job.completed | job.failed → job.dead_lettered)
```

### Event Details

**job.queued**

```typescript
{
  eventType: 'job.queued',
  jobId: string;
  jobType: 'document.scan' | 'preview.generate' | ...;
  queue: 'high' | 'normal' | 'low' | 'scheduled';
  payload: Record<string, any>;
  priority: 'high' | 'normal' | 'low';
  maxAttempts: number;
  createdAt: Date;
}
```

**job.started**

```typescript
{
  eventType: 'job.started',
  jobId: string;
  jobType: string;
  queue: string;
  workerType: 'scan' | 'preview' | 'general' | 'report';
  startedAt: Date;
}
```

**job.completed**

```typescript
{
  eventType: 'job.completed',
  jobId: string;
  jobType: string;
  queue: string;
  result: Record<string, any>;      // Job-specific result
  duration: number;                  // milliseconds
  completedAt: Date;
}
```

**job.failed**

```typescript
{
  eventType: 'job.failed',
  jobId: string;
  jobType: string;
  queue: string;
  error: string;
  attemptsMade: number;
  nextRetryAt?: Date;                // If retrying
  failedAt: Date;
}
```

**job.dead_lettered**

```typescript
{
  eventType: 'job.dead_lettered',
  jobId: string;
  jobType: string;
  queue: string;
  error: string;
  attempts: number;
  maxAttempts: number;
  severity: 'high' | 'normal' | 'low';
  movedToDLQAt: Date;
}
```

### EventBus Integration

```typescript
// Emit events from BullMQ worker
const worker = new Worker(
  queueName,
  async (bullMqJob) => {
    try {
      // Emit job.started
      await eventBus.emit('job.started', {
        eventType: 'job.started',
        jobId: bullMqJob.id,
        jobType: bullMqJob.name,
        queue: queueName,
        workerType: getCurrentWorkerType(),
        startedAt: new Date(),
      });

      // Execute job
      const result = await processJobHandler(bullMqJob);

      // Emit job.completed
      const duration = Date.now() - bullMqJob.processedOn!;
      await eventBus.emit('job.completed', {
        eventType: 'job.completed',
        jobId: bullMqJob.id,
        jobType: bullMqJob.name,
        queue: queueName,
        result,
        duration,
        completedAt: new Date(),
      });
    } catch (err) {
      // Emit job.failed
      await eventBus.emit('job.failed', {
        eventType: 'job.failed',
        jobId: bullMqJob.id,
        jobType: bullMqJob.name,
        queue: queueName,
        error: err.message,
        attemptsMade: bullMqJob.attemptsMade,
        nextRetryAt: bullMqJob.nextRetryTime,
        failedAt: new Date(),
      });

      throw err; // Let BullMQ handle retry
    }
  },
  { connection }
);
```

---

## Scheduled Jobs

Scheduled jobs are triggered by cron expressions, running on a specified schedule independent of queue depth or user actions.

### Cron Configuration

Jobs use **standard 5-field cron syntax**, evaluated in **UTC** (production) or **local timezone** (dev).

| Job                 | Cron Expression | Timezone | Interval  | Purpose                                 |
| ------------------- | --------------- | -------- | --------- | --------------------------------------- |
| **audit.compact**   | `0 2 * * *`     | UTC      | Daily 2am | Compact previous day's events           |
| **cleanup.expired** | `0 * * * *`     | UTC      | Hourly    | Remove expired sessions, tokens         |
| **cleanup.trash**   | `0 3 * * *`     | UTC      | Daily 3am | Hard-delete soft-deleted items past 30d |
| **backup.snapshot** | `0 4 * * *`     | UTC      | Daily 4am | Full database backup                    |

### Scheduled Job Implementation

```typescript
// src/services/ScheduledJobService.ts
import { Queue } from 'bullmq';

export class ScheduledJobService {
  constructor(
    private generalWorkerQueue: Queue,
    private reportWorkerQueue: Queue,
    private eventBus: EventBus
  ) {}

  async initializeScheduledJobs() {
    // Audit compaction: daily 2am UTC
    await this.scheduleJob(
      this.generalWorkerQueue,
      'audit.compact',
      { compactionDate: new Date().toISOString().split('T')[0] },
      '0 2 * * *'
    );

    // Cleanup expired: hourly
    await this.scheduleJob(
      this.generalWorkerQueue,
      'cleanup.expired',
      { cleanupTypes: ['sessions', 'tokens', 'uploads', 'sharelinks'] },
      '0 * * * *'
    );

    // Cleanup trash: daily 3am UTC
    await this.scheduleJob(
      this.generalWorkerQueue,
      'cleanup.trash',
      { retentionDays: 30 },
      '0 3 * * *'
    );

    // Backup: daily 4am UTC
    await this.scheduleJob(
      this.reportWorkerQueue,
      'backup.snapshot',
      { backupType: 'full', retentionDays: 30 },
      '0 4 * * *'
    );
  }

  private async scheduleJob(
    queue: Queue,
    jobType: string,
    payload: Record<string, any>,
    cronExpression: string
  ) {
    await queue.add(jobType, payload, {
      repeat: {
        pattern: cronExpression, // Standard cron
        tz: process.env.TZ || 'UTC',
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    console.log(`Scheduled job: ${jobType} at "${cronExpression}"`);
  }
}
```

### Scheduled Job Monitoring

Scheduled jobs may not run if worker is down. Include health check:

```typescript
// Health check: ensure scheduled jobs have run recently
async function checkScheduledJobHealth(): Promise<HealthStatus> {
  const lastCompaction = await db.eventCompaction.findFirst({
    orderBy: { compactionDate: 'desc' },
  });

  const lastCleanup = await db.deadLetterJob.findFirst({
    where: { dismissedAt: { not: null } },
    orderBy: { dismissed_at: 'desc' },
  });

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  if (!lastCompaction || lastCompaction.compactionDate < oneDayAgo) {
    return { status: 'degraded', message: 'Audit compaction overdue' };
  }

  if (!lastCleanup || lastCleanup.dismissed_at! < oneDayAgo) {
    // Cleanup not explicitly run, but safe to assume scheduled job ran
  }

  return { status: 'healthy' };
}
```

---

## Worker Scaling Guide

### Recommended Concurrency

Each worker type processes jobs with recommended concurrency settings based on resource constraints:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Worker Type        │ Queue    │ Concurrency │ CPU  │ Memory │ Notes   │
├──────────────────────────────────────────────────────────────────────┤
│ preview-worker     │ high     │ 2-3         │ 2-4  │ 2-4GB  │ I/O     │
│                    │          │             │ core │        │ + CPU   │
│ scan-worker        │ high     │ 2           │ 1-2  │ 1-2GB  │ ClamAV  │
│                    │          │             │ core │        │ bound   │
│ general-worker     │ normal   │ 4-6         │ 2-4  │ 1-2GB  │ Network │
│                    │ low      │             │ core │        │ I/O     │
│ report-worker      │ low      │ 1           │ 2-4  │ 4-8GB  │ Memory  │
│                    │          │             │ core │        │ intensive
└──────────────────────────────────────────────────────────────────────┘
```

### Deployment Scenarios

**Single-Server (Small Install - <50 users):**

```yaml
# docker-compose.yml
services:
  worker-general:
    image: vaultspace:latest
    command: npm run worker -- --queue=normal,low,scheduled
    environment:
      WORKER_CONCURRENCY_NORMAL: 2
      WORKER_CONCURRENCY_LOW: 1
      WORKER_CONCURRENCY_SCHEDULED: 1
    mem_limit: 2g
    cpus: '2'
```

**Multi-Server (Medium Install - 50-500 users):**

```yaml
# Kubernetes deployment (example)
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-scan
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: scan-worker
          image: vaultspace:latest
          command: ['npm', 'run', 'worker', '--', '--queue=high']
          env:
            - name: WORKER_CONCURRENCY_HIGH
              value: '2'
          resources:
            requests:
              memory: '1.5Gi'
              cpu: '1'
            limits:
              memory: '2Gi'
              cpu: '2'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-preview
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: preview-worker
          image: vaultspace:latest
          command: ['npm', 'run', 'worker', '--', '--queue=high']
          env:
            - name: WORKER_CONCURRENCY_HIGH
              value: '3'
          resources:
            requests:
              memory: '3Gi'
              cpu: '2'
            limits:
              memory: '4Gi'
              cpu: '3'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-general
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: general-worker
          image: vaultspace:latest
          command: ['npm', 'run', 'worker', '--', '--queue=normal,low']
          env:
            - name: WORKER_CONCURRENCY_NORMAL
              value: '4'
            - name: WORKER_CONCURRENCY_LOW
              value: '2'
          resources:
            requests:
              memory: '1.5Gi'
              cpu: '1'
            limits:
              memory: '2Gi'
              cpu: '2'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker-report
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: report-worker
          image: vaultspace:latest
          command: ['npm', 'run', 'worker', '--', '--queue=low']
          env:
            - name: WORKER_CONCURRENCY_LOW
              value: '1'
          resources:
            requests:
              memory: '4Gi'
              cpu: '2'
            limits:
              memory: '6Gi'
              cpu: '3'
```

### Queue Depth Monitoring

Monitor queue depths to decide when to add workers:

```typescript
// Health check endpoint
async function getQueueHealth() {
  const queueStats = {
    high: {
      waitingCount: await highQueue.getWaitingCount(),
      activeCount: await highQueue.getActiveCount(),
      delayedCount: await highQueue.getDelayedCount(),
      failedCount: await highQueue.getFailedCount(),
    },
    normal: {
      /* ... */
    },
    low: {
      /* ... */
    },
  };

  return {
    status: 'healthy',
    queues: queueStats,
    recommendation:
      queueStats.high.waitingCount > 100 ? 'Add more preview workers' : 'Adequate capacity',
  };
}
```

**Auto-scaling thresholds:**

| Metric                    | Threshold | Action                                  |
| ------------------------- | --------- | --------------------------------------- |
| High queue waiting jobs   | > 100     | Spin up additional preview-worker       |
| Normal queue waiting jobs | > 200     | Spin up additional general-worker       |
| Low queue waiting jobs    | > 500     | Spin up additional report-worker (rare) |
| Job failure rate          | > 5%      | Page on-call; investigate DLQ           |
| Job timeout rate          | > 2%      | Increase timeout or worker concurrency  |

---

## TypeScript Interfaces

Complete TypeScript type definitions for all job payloads, options, and results:

```typescript
// src/lib/jobs/types.ts

/**
 * Base job types
 */

export interface JobOptions {
  priority?: 'high' | 'normal' | 'low';
  attempts?: number;
  backoff?: BackoffOptions;
  delay?: number; // Milliseconds before job becomes eligible
  timeout?: number; // Milliseconds before job is killed
  jobId?: string; // Unique ID for idempotency
}

export interface BackoffOptions {
  type: 'fixed' | 'exponential';
  delay: number; // Initial delay in milliseconds
}

export interface Job<T = any> {
  id: string;
  queueName: string;
  jobType: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  progress?: number;
  result?: any;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export type JobStatus = 'pending' | 'active' | 'delayed' | 'completed' | 'failed';

/**
 * Document Processing Jobs
 */

export interface ScanJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
}

export interface ScanJobResult {
  jobId: string;
  documentId: string;
  versionId: string;
  scanStatus: 'clean' | 'infected' | 'error';
  threats?: Array<{
    name: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  scannedAt: Date;
  duration: number;
}

export interface PreviewGenerateJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  isScanned: boolean;
}

export interface PreviewGenerateJobResult {
  jobId: string;
  documentId: string;
  versionId: string;
  pageCount: number;
  previewKey: string; // Storage path to PDF
  textKey?: string; // Storage path to extracted text
  duration: number;
}

export interface TextExtractJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string;
  contentType: string;
  fileName: string;
  pageCount?: number;
  language?: string;
}

export interface TextExtractJobResult {
  jobId: string;
  documentId: string;
  versionId: string;
  textLength: number;
  textKey: string;
  ocrApplied: boolean;
  duration: number;
}

/**
 * Search & Analytics Jobs
 */

export interface SearchIndexJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  roomId: string;
  fileName: string;
  text: string;
  metadata?: {
    author?: string;
    uploadedAt?: string;
    pageCount?: number;
  };
}

export interface SearchIndexJobResult {
  jobId: string;
  documentId: string;
  indexed: boolean;
  duration: number;
}

export interface HashComputeJobPayload {
  documentId: string;
  versionId: string;
  organizationId: string;
  storageKey: string;
}

export interface HashComputeJobResult {
  jobId: string;
  documentId: string;
  versionId: string;
  sha256Hash: string;
  duration: number;
}

/**
 * Communication Jobs
 */

export interface EmailSendJobPayload {
  jobId: string;
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  template?: string;
  templateData?: Record<string, any>;
  bodyText?: string;
  htmlBody?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
  organizationId: string;
}

export interface EmailSendJobResult {
  jobId: string;
  to: string | string[];
  status: 'sent' | 'failed' | 'queued';
  messageId?: string;
  error?: string;
  duration: number;
}

export interface NotificationDispatchJobPayload {
  organizationId: string;
  eventType: string;
  eventId: string;
  targetUserIds?: string[];
  roomId?: string;
  documentId?: string;
  metadata: Record<string, any>;
}

export interface NotificationDispatchJobResult {
  jobId: string;
  eventId: string;
  notificationsSent: number;
  emailsSent: number;
  inAppNotificationsCreated: number;
  duration: number;
}

/**
 * Export & Reporting Jobs
 */

export interface ExportZipJobPayload {
  exportId: string;
  organizationId: string;
  roomId: string;
  documentIds?: string[];
  includeMetadata: boolean;
  format: 'pdf' | 'original';
  requestedByUserId: string;
}

export interface ExportZipJobResult {
  jobId: string;
  exportId: string;
  zipKey: string;
  zipSize: number;
  documentCount: number;
  duration: number;
}

export interface BackupSnapshotJobPayload {
  organizationId?: string;
  backupType: 'full' | 'incremental';
  retentionDays: number;
}

export interface BackupSnapshotJobResult {
  jobId: string;
  backupId: string;
  backupKey: string;
  backupSize: number;
  backupType: 'full' | 'incremental';
  duration: number;
}

/**
 * Maintenance & Cleanup Jobs
 */

export interface AuditCompactJobPayload {
  organizationId?: string;
  compactionDate: string; // ISO date
}

export interface AuditCompactJobResult {
  jobId: string;
  compactionDate: string;
  eventsProcessed: number;
  eventsDeleted: number;
  aggregates: Record<string, number>;
  duration: number;
}

export interface CleanupExpiredJobPayload {
  organizationId?: string;
  cleanupTypes: Array<'sessions' | 'tokens' | 'uploads' | 'sharelinks'>;
}

export interface CleanupExpiredJobResult {
  jobId: string;
  sessionsDeleted: number;
  toketsDeleted: number;
  uploadsDeleted: number;
  shareLinksDeleted: number;
  duration: number;
}

export interface CleanupTrashJobPayload {
  organizationId?: string;
  retentionDays: number;
}

export interface CleanupTrashJobResult {
  jobId: string;
  deletedDocuments: number;
  deletedRooms: number;
  deletedBytes: number;
  duration: number;
}

/**
 * Job Type Union for job handlers
 */

export type JobPayload =
  | ScanJobPayload
  | PreviewGenerateJobPayload
  | TextExtractJobPayload
  | SearchIndexJobPayload
  | HashComputeJobPayload
  | EmailSendJobPayload
  | NotificationDispatchJobPayload
  | ExportZipJobPayload
  | BackupSnapshotJobPayload
  | AuditCompactJobPayload
  | CleanupExpiredJobPayload
  | CleanupTrashJobPayload;

export type JobResult =
  | ScanJobResult
  | PreviewGenerateJobResult
  | TextExtractJobResult
  | SearchIndexJobResult
  | HashComputeJobResult
  | EmailSendJobResult
  | NotificationDispatchJobResult
  | ExportZipJobResult
  | BackupSnapshotJobResult
  | AuditCompactJobResult
  | CleanupExpiredJobResult
  | CleanupTrashJobResult;

/**
 * Dead Letter Queue
 */

export interface DeadLetterJob {
  id: string;
  jobId: string;
  queueName: string;
  jobType: string;
  payload: JobPayload;
  errorMessage: string;
  attemptsMade: number;
  failedAt: Date;
  dismissedAt?: Date;
  dismissedBy?: string;
  createdAt: Date;
}
```

---

## BullMQ Setup Example

Complete working example for BullMQ initialization and job processing:

```typescript
// src/lib/providers/job/BullMqJobProvider.ts

import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { EventBus } from '../EventBus';
import { JobProvider, Job, JobOptions } from './JobProvider';
import {
  ScanJobPayload,
  PreviewGenerateJobPayload,
  EmailSendJobPayload,
  // ... other payload types
} from './types';

export class BullMqJobProvider implements JobProvider {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();
  private redis: Redis;
  private eventBus: EventBus;

  constructor(redisConnection: Redis, eventBus: EventBus) {
    this.redis = redisConnection;
    this.eventBus = eventBus;
  }

  /**
   * Initialize all queues and start workers
   */
  async initialize(): Promise<void> {
    const queueNames = ['high', 'normal', 'low', 'scheduled'];

    for (const queueName of queueNames) {
      // Create queue
      const queue = new Queue(queueName, {
        connection: this.redis,
        settings: {
          maxStalledInterval: 5000,
          maxStalledCount: 2,
          lockDuration: 30000,
          lockRenewTime: 15000,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: false,
          },
        },
      });

      this.queues.set(queueName, queue);

      // Create queue events listener
      const queueEvents = new QueueEvents(queueName, {
        connection: this.redis,
      });

      queueEvents.on('completed', ({ jobId }) => {
        console.log(`Job ${jobId} completed`);
      });

      queueEvents.on('failed', ({ jobId, err }) => {
        console.error(`Job ${jobId} failed: ${err}`);
      });

      this.queueEvents.set(queueName, queueEvents);
    }

    console.log('BullMQ initialized with 4 queues');
  }

  /**
   * Enqueue a job
   */
  async enqueueJob<T>(
    queueName: string,
    jobType: string,
    payload: T,
    options?: JobOptions
  ): Promise<Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Unknown queue: ${queueName}`);
    }

    const bullMqJob = await queue.add(jobType, payload, {
      priority: this.getPriority(options?.priority || 'normal'),
      attempts: options?.attempts || this.getDefaultRetries(jobType),
      backoff: {
        type: 'exponential',
        delay: options?.backoff?.delay || this.getInitialDelay(jobType),
      },
      delay: options?.delay,
      timeout: options?.timeout || this.getDefaultTimeout(jobType),
      jobId: options?.jobId || `${jobType}-${Date.now()}-${Math.random()}`,
      removeOnComplete: true,
      removeOnFail: false,
    });

    // Emit job.queued event
    await this.eventBus.emit('job.queued', {
      eventType: 'job.queued',
      jobId: bullMqJob.id,
      jobType,
      queue: queueName,
      payload,
      priority: options?.priority || 'normal',
      maxAttempts: bullMqJob.opts.attempts,
      createdAt: new Date(),
    });

    return {
      id: bullMqJob.id!,
      queueName,
      jobType,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: bullMqJob.opts.attempts!,
      createdAt: new Date(),
    };
  }

  /**
   * Start worker for a queue
   */
  async startWorker(
    queueName: string,
    concurrency: number,
    handler: (job: any) => Promise<any>
  ): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Unknown queue: ${queueName}`);
    }

    const worker = new Worker(queueName, handler, {
      connection: this.redis,
      concurrency,
    });

    // Emit job.started
    worker.on('active', async (job) => {
      await this.eventBus.emit('job.started', {
        eventType: 'job.started',
        jobId: job.id,
        jobType: job.name,
        queue: queueName,
        workerType: this.getWorkerType(queueName),
        startedAt: new Date(),
      });
    });

    // Emit job.completed
    worker.on('completed', async (job, result) => {
      await this.eventBus.emit('job.completed', {
        eventType: 'job.completed',
        jobId: job.id,
        jobType: job.name,
        queue: queueName,
        result,
        duration: Date.now() - job.processedOn!,
        completedAt: new Date(),
      });
    });

    // Emit job.failed and check for DLQ
    worker.on('failed', async (job, err) => {
      await this.eventBus.emit('job.failed', {
        eventType: 'job.failed',
        jobId: job.id,
        jobType: job.name,
        queue: queueName,
        error: err.message,
        attemptsMade: job.attemptsMade,
        failedAt: new Date(),
      });

      // Move to DLQ if exceeded max retries
      if (job.attemptsMade >= job.opts.attempts!) {
        await this.moveToDeadLetter(job, err);
      }
    });

    this.workers.set(queueName, worker);
    console.log(`Started worker for queue "${queueName}" (concurrency: ${concurrency})`);
  }

  /**
   * Move failed job to dead letter queue
   */
  private async moveToDeadLetter(job: any, err: Error): Promise<void> {
    let deadQueue = this.queues.get('dead');
    if (!deadQueue) {
      deadQueue = new Queue('dead', { connection: this.redis });
      this.queues.set('dead', deadQueue);
    }

    await deadQueue.add(
      `dead:${job.name}`,
      {
        originalJobId: job.id,
        originalQueue: job.queueName,
        originalJobType: job.name,
        payload: job.data,
        error: err.message,
        attempts: job.attemptsMade,
        failedAt: new Date(),
      },
      {
        removeOnComplete: false,
        removeOnFail: false,
      }
    );

    await this.eventBus.emit('job.dead_lettered', {
      eventType: 'job.dead_lettered',
      jobId: job.id,
      jobType: job.name,
      queue: job.queueName,
      error: err.message,
      attempts: job.attemptsMade,
      severity: this.classifySeverity(job.name),
      movedToDLQAt: new Date(),
    });
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<string> {
    for (const queue of this.queues.values()) {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        return state;
      }
    }
    return 'unknown';
  }

  /**
   * Utility methods
   */

  private getPriority(level: 'high' | 'normal' | 'low'): number {
    switch (level) {
      case 'high':
        return 10;
      case 'normal':
        return 50;
      case 'low':
        return 100;
      default:
        return 50;
    }
  }

  private getDefaultRetries(jobType: string): number {
    if (['document.scan', 'preview.generate', 'text.extract'].includes(jobType)) {
      return 3;
    }
    if (['email.send'].includes(jobType)) {
      return 5;
    }
    if (['export.zip', 'backup.snapshot'].includes(jobType)) {
      return 2;
    }
    return 3;
  }

  private getInitialDelay(jobType: string): number {
    if (['document.scan'].includes(jobType)) {
      return 30000; // 30s
    }
    if (['preview.generate', 'text.extract', 'email.send'].includes(jobType)) {
      return 60000; // 60s
    }
    if (['export.zip'].includes(jobType)) {
      return 120000; // 120s
    }
    return 60000;
  }

  private getDefaultTimeout(jobType: string): number {
    if (['preview.generate', 'text.extract'].includes(jobType)) {
      return 600000; // 10m
    }
    if (['export.zip'].includes(jobType)) {
      return 1800000; // 30m
    }
    if (['backup.snapshot'].includes(jobType)) {
      return 3600000; // 1h
    }
    return 300000; // 5m default
  }

  private getWorkerType(queueName: string): string {
    const mapping: Record<string, string> = {
      high: 'scan-worker|preview-worker',
      normal: 'general-worker',
      low: 'report-worker',
      scheduled: 'general-worker',
    };
    return mapping[queueName] || 'unknown';
  }

  private classifySeverity(jobType: string): 'high' | 'normal' | 'low' {
    if (['document.scan', 'preview.generate'].includes(jobType)) {
      return 'high';
    }
    if (['email.send', 'notification.dispatch'].includes(jobType)) {
      return 'normal';
    }
    return 'low';
  }

  /**
   * Cleanup
   */
  async shutdown(): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    for (const queueEvents of this.queueEvents.values()) {
      await queueEvents.close();
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    console.log('BullMQ provider shut down');
  }
}
```

### Usage in Worker Entry Point

```typescript
// src/workers/general-worker.ts

import { BullMqJobProvider } from '../lib/providers/job/BullMqJobProvider';
import { Redis } from 'ioredis';
import { EventBus } from '../lib/EventBus';
import { CoreServiceContext } from '../services/CoreServiceContext';

async function startGeneralWorker() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  const eventBus = new EventBus();
  const jobProvider = new BullMqJobProvider(redis, eventBus);

  const services = new CoreServiceContext({
    jobQueue: jobProvider,
    eventBus,
    // ... other dependencies
  });

  await jobProvider.initialize();

  // Start processing
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '4');

  await jobProvider.startWorker('normal', concurrency, async (job) => {
    console.log(`Processing job: ${job.name} [${job.id}]`);

    switch (job.name) {
      case 'email.send':
        return await services.email.sendEmail(job.data);

      case 'notification.dispatch':
        return await services.notification.dispatch(job.data);

      case 'search.index':
        return await services.search.indexDocument(job.data);

      case 'hash.compute':
        return await services.document.computeHash(job.data);

      case 'audit.compact':
        return await services.audit.compact(job.data);

      case 'cleanup.expired':
        return await services.cleanup.cleanupExpired(job.data);

      case 'cleanup.trash':
        return await services.cleanup.cleanupTrash(job.data);

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  });

  console.log('General worker started');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await jobProvider.shutdown();
    process.exit(0);
  });
}

startGeneralWorker().catch((err) => {
  console.error('Failed to start general worker:', err);
  process.exit(1);
});
```

---

## Appendix: Environment Variables

BullMQ and job configuration via environment:

```bash
# Redis connection (canonical variable from DEPLOYMENT.md)
REDIS_URL=redis://localhost:6379

# Worker concurrency
WORKER_CONCURRENCY_HIGH=3        # preview + scan workers share high queue
WORKER_CONCURRENCY_NORMAL=4      # general worker
WORKER_CONCURRENCY_LOW=2         # report worker
WORKER_CONCURRENCY_SCHEDULED=1   # scheduled processor

# Timeouts (milliseconds)
JOB_TIMEOUT_SCAN=300000          # 5min
JOB_TIMEOUT_PREVIEW=600000       # 10min
JOB_TIMEOUT_EMAIL=120000         # 2min
JOB_TIMEOUT_EXPORT=1800000       # 30min

# Retry configuration
JOB_MAX_ATTEMPTS_SCAN=3
JOB_MAX_ATTEMPTS_PREVIEW=3
JOB_MAX_ATTEMPTS_EMAIL=5
JOB_MAX_ATTEMPTS_EXPORT=2

# Dead letter retention (days)
DEAD_LETTER_RETENTION=30

# Scheduled job timezone
TZ=UTC

# Queue event logging
QUEUE_DEBUG=false               # Enable detailed queue logging
```

---

**End of JOB_SPECS.md**
