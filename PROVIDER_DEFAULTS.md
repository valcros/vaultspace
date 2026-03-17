# VaultSpace Provider Defaults Specification

**Status:** MVP Specification (Feature F149)
**Last Updated:** 2026-03-14
**Version:** 1.0

---

## Overview

This document specifies the default provider implementations for VaultSpace MVP. Each of the 13 providers abstracts critical infrastructure concerns (storage, email, caching, jobs, scanning, etc.) to enable cloud-agnostic deployments.

### Stakeholder Decisions

- **Email:** SMTP with console fallback in dev
- **Storage:** Local disk for dev, S3-compatible for production
- **AI Features:** Not in MVP (AIProvider stub only)
- **E-signatures:** Not in MVP (SignatureProvider stub only)
- **Encryption at Rest:** Not in MVP (NoOp implementation; AES-256 shipping in V1 as F120)

---

## Provider Registration & Factory Pattern

At application startup, all providers are instantiated based on environment variables and registered with the CoreServiceContext.

### Provider Factory

**File:** `src/lib/providers/factory.ts`

```typescript
// src/lib/providers/factory.ts
import { CoreServiceContext } from './core-service-context';
import { StorageProvider } from './providers/storage';
import { EmailProvider } from './providers/email';
import { CacheProvider } from './providers/cache';
import { JobProvider } from './providers/job';
// ... etc

/**
 * Bootstrap all providers at application startup.
 * Each provider selection is controlled by environment variables.
 */
export async function createProviders(): Promise<CoreServiceContext> {
  const storageProvider = createStorageProvider(process.env.STORAGE_PROVIDER || 'local');

  const emailProvider = createEmailProvider(process.env.EMAIL_PROVIDER || 'smtp');

  const cacheProvider = createCacheProvider(process.env.CACHE_PROVIDER || 'redis');

  const jobProvider = createJobProvider(process.env.JOB_PROVIDER || 'bullmq');

  const previewProvider = createPreviewProvider(process.env.PREVIEW_PROVIDER || 'gotenberg');

  const scanProvider = createScanProvider(process.env.SCAN_PROVIDER || 'clamav');

  const searchProvider = createSearchProvider(process.env.SEARCH_PROVIDER || 'postgres-fts');

  const encryptionProvider = createEncryptionProvider(process.env.ENCRYPTION_PROVIDER || 'noop');

  const cdnProvider = createCdnProvider(process.env.CDN_PROVIDER || 'direct');

  const monitoringProvider = createMonitoringProvider(process.env.MONITORING_PROVIDER || 'console');

  const authSSOProvider = createAuthSSOProvider(process.env.AUTH_SSO_PROVIDER || 'noop');

  const aiProvider = createAIProvider(process.env.AI_PROVIDER || 'noop');

  const signatureProvider = createSignatureProvider(process.env.SIGNATURE_PROVIDER || 'noop');

  return new CoreServiceContext({
    storageProvider,
    emailProvider,
    cacheProvider,
    jobProvider,
    previewProvider,
    scanProvider,
    searchProvider,
    encryptionProvider,
    cdnProvider,
    monitoringProvider,
    authSSOProvider,
    aiProvider,
    signatureProvider,
  });
}

/**
 * Helper: Create StorageProvider based on environment variable.
 */
function createStorageProvider(providerName: string): StorageProvider {
  if (providerName === 's3') {
    return new S3StorageProvider({
      bucket: process.env.STORAGE_BUCKET!,
      region: process.env.STORAGE_REGION || 'us-east-1',
      accessKeyId: process.env.STORAGE_KEY_ID!,
      secretAccessKey: process.env.STORAGE_SECRET_KEY!,
      endpoint: process.env.STORAGE_ENDPOINT, // For S3-compatible services
    });
  } else if (providerName === 'azure') {
    return new AzureBlobProvider({
      accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME!,
      accountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY!,
      containerName: process.env.STORAGE_BUCKET || 'vaultspace',
    });
  } else {
    // Default to local storage
    return new LocalStorageProvider({
      basePath: process.env.STORAGE_LOCAL_PATH || './data/storage',
    });
  }
}

// ... similar factory functions for each provider type
```

---

## The 13 Provider Implementations

### 1. StorageProvider

**Purpose:** Abstract file storage (upload, download, delete, sign temporary URLs).

**Interface:**

```typescript
interface StorageProvider {
  uploadFile(
    key: string,
    data: Buffer | Stream,
    metadata?: Record<string, string>
  ): Promise<UploadResult>;

  downloadFile(key: string): Promise<Buffer>;

  deleteFile(key: string): Promise<void>;

  getSignedUrl(key: string, expiresIn: number): Promise<string>;

  exists(key: string): Promise<boolean>;

  copyFile(sourceKey: string, destKey: string): Promise<void>;
}

interface UploadResult {
  key: string;
  url?: string;
  size: number;
  etag?: string;
}
```

#### MVP Default Implementation: LocalStorageProvider

**File:** `src/providers/storage/local-storage-provider.ts`

```typescript
/**
 * LocalStorageProvider: Store files on local filesystem.
 * MVP default for development and single-machine deployments.
 *
 * Behavior:
 * - Files stored in `./data/storage/` (configurable)
 * - Keys are used as file paths (with sanitization)
 * - Atomic writes: write to .tmp, then rename
 * - Signed URLs use HMAC tokens with embedded expiry (default: 5 min for previews, 1 hour for downloads)
 *
 * Production Note: Use S3StorageProvider instead; local storage
 * does not scale to multiple instances.
 */
export class LocalStorageProvider implements StorageProvider {
  private basePath: string;

  constructor(options: { basePath?: string }) {
    this.basePath = options.basePath || './data/storage';
    // Ensure directory exists
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  async uploadFile(
    key: string,
    data: Buffer | Stream,
    metadata?: Record<string, string>
  ): Promise<UploadResult> {
    const filepath = this.getFilePath(key);
    const tmpFilepath = filepath + '.tmp';

    try {
      // Write to temporary file
      const buffer = data instanceof Buffer ? data : await streamToBuffer(data);
      fs.writeFileSync(tmpFilepath, buffer);

      // Atomic rename
      fs.renameSync(tmpFilepath, filepath);

      // Store metadata in adjacent .json file
      if (metadata) {
        fs.writeFileSync(filepath + '.meta.json', JSON.stringify(metadata));
      }

      return {
        key,
        size: buffer.length,
        etag: this.computeEtag(buffer),
      };
    } catch (error) {
      // Clean up temp file if it exists
      if (fs.existsSync(tmpFilepath)) {
        fs.unlinkSync(tmpFilepath);
      }
      throw new StorageError(`Failed to upload ${key}: ${error.message}`);
    }
  }

  async downloadFile(key: string): Promise<Buffer> {
    const filepath = this.getFilePath(key);
    if (!fs.existsSync(filepath)) {
      throw new StorageError(`File not found: ${key}`);
    }
    try {
      return fs.readFileSync(filepath);
    } catch (error) {
      throw new StorageError(`Failed to download ${key}: ${error.message}`);
    }
  }

  async deleteFile(key: string): Promise<void> {
    const filepath = this.getFilePath(key);
    if (!fs.existsSync(filepath)) {
      throw new StorageError(`File not found: ${key}`);
    }
    try {
      fs.unlinkSync(filepath);
      // Also delete metadata if it exists
      const metaFilepath = filepath + '.meta.json';
      if (fs.existsSync(metaFilepath)) {
        fs.unlinkSync(metaFilepath);
      }
    } catch (error) {
      throw new StorageError(`Failed to delete ${key}: ${error.message}`);
    }
  }

  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    // Local storage: generates HMAC token with embedded expiry
    // Token format: signed(key + timestamp + expiryTime)
    // Served via authenticated API endpoint that verifies token + expiry before serving file
    // The app checks permission at token generation time and enforces expiry on every request
    // Expiry contract matches cloud providers: 5 minutes for previews, 1 hour for downloads
    const token = this.generateHmacToken(key, expiresIn);
    return `/api/storage/${encodeURIComponent(token)}`;
  }

  private generateHmacToken(key: string, expiresIn: number): string {
    const expiresAt = Date.now() + expiresIn;
    const payload = `${key}:${expiresAt}`;
    const signature = crypto
      .createHmac('sha256', this.getSigningKey())
      .update(payload)
      .digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64');
  }

  private getSigningKey(): string {
    // In production, this would be a secure key from environment
    // For dev/local, use a static key (not cryptographically secure)
    return process.env.SIGNED_URL_KEY || 'dev-key-not-for-production';
  }

  async exists(key: string): Promise<boolean> {
    const filepath = this.getFilePath(key);
    return fs.existsSync(filepath);
  }

  async copyFile(sourceKey: string, destKey: string): Promise<void> {
    const sourceFilepath = this.getFilePath(sourceKey);
    const destFilepath = this.getFilePath(destKey);

    if (!fs.existsSync(sourceFilepath)) {
      throw new StorageError(`Source file not found: ${sourceKey}`);
    }

    try {
      fs.copyFileSync(sourceFilepath, destFilepath);
      // Copy metadata if it exists
      const sourceMeta = sourceFilepath + '.meta.json';
      if (fs.existsSync(sourceMeta)) {
        fs.copyFileSync(sourceMeta, destFilepath + '.meta.json');
      }
    } catch (error) {
      throw new StorageError(`Failed to copy ${sourceKey} to ${destKey}: ${error.message}`);
    }
  }

  private getFilePath(key: string): string {
    // Sanitize key to prevent path traversal
    const safe = key.replace(/\.\./g, '').replace(/^\//g, '');
    return path.join(this.basePath, safe);
  }

  private computeEtag(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }
}
```

**Environment Variables:**

```bash
STORAGE_PROVIDER=local              # (default)
STORAGE_LOCAL_PATH=./data/storage   # Base directory for files
```

**Dev Mode Behavior:**

- Logs all file operations to console
- Files persisted to local disk for inspection
- No cleanup on process exit

**Error Handling:**

- `StorageError` if directory doesn't exist and cannot be created
- `StorageError` if file I/O fails (permissions, disk full)
- `StorageError` if key sanitization fails

**Alternative Implementations (V1+):**

- **S3StorageProvider:** AWS S3 or S3-compatible (MinIO, Backblaze)
- **AzureBlobProvider:** Azure Blob Storage
- **GcpStorageProvider:** Google Cloud Storage

---

### 2. EmailProvider

**Purpose:** Abstract email dispatch (send emails via SMTP, cloud services, etc.).

**Interface:**

```typescript
interface EmailProvider {
  send(request: SendEmailRequest): Promise<SendEmailResult>;

  sendTemplate(
    to: string,
    templateId: string,
    data: Record<string, string>
  ): Promise<SendEmailResult>;

  verifyEmail(email: string): Promise<boolean>;
}

interface SendEmailRequest {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

interface SendEmailResult {
  id: string;
  status: 'sent' | 'failed' | 'queued';
  error?: string;
}
```

#### MVP Default Implementation: SmtpEmailProvider (with ConsoleEmailProvider Fallback)

**File:** `src/providers/email/smtp-email-provider.ts`

```typescript
/**
 * SmtpEmailProvider: Send emails via SMTP server.
 * MVP default for production self-hosted deployments.
 *
 * In development (NODE_ENV=development), falls back to ConsoleEmailProvider.
 *
 * Behavior:
 * - Connects to SMTP server using nodemailer
 * - Supports TLS/STARTTLS
 * - Retries with exponential backoff on transient failures
 * - Queues failed emails for retry via BullMQ job queue
 */
export class SmtpEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor(options: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
    from: string;
  }) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      auth: options.auth,
    });
    this.fromAddress = options.from;
  }

  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to: request.to,
        cc: request.cc,
        bcc: request.bcc,
        subject: request.subject,
        text: request.body,
        html: request.html,
        replyTo: request.replyTo,
        attachments: request.attachments?.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType,
        })),
      });

      return {
        id: info.messageId || crypto.randomUUID(),
        status: 'sent',
      };
    } catch (error) {
      // Log for retry
      console.error(`Email send failed for ${request.to}:`, error.message);

      // Queue for retry
      // (details in JobProvider section)

      return {
        id: crypto.randomUUID(),
        status: 'failed',
        error: error.message,
      };
    }
  }

  async sendTemplate(
    to: string,
    templateId: string,
    data: Record<string, string>
  ): Promise<SendEmailResult> {
    // Resolve template and render with data
    const template = this.loadTemplate(templateId);
    const html = this.renderTemplate(template.html, data);
    const text = this.renderTemplate(template.text, data);

    return this.send({
      to,
      subject: template.subject,
      body: text,
      html,
    });
  }

  async verifyEmail(email: string): Promise<boolean> {
    // Simple validation; full verification would be async via service
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private loadTemplate(templateId: string): EmailTemplate {
    // Load from src/templates/emails/{templateId}.mjml or similar
    // Return { subject, html, text }
  }

  private renderTemplate(template: string, data: Record<string, string>): string {
    // Simple string interpolation or Handlebars rendering
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || '');
  }
}
```

**File:** `src/providers/email/console-email-provider.ts`

```typescript
/**
 * ConsoleEmailProvider: Log emails to stdout.
 * Development-only fallback; used when NODE_ENV=development.
 *
 * Behavior:
 * - Logs full email content (to, subject, body) as JSON
 * - Does not send actual emails
 * - Useful for testing workflows without email infrastructure
 * - Can inspect logs to verify email content
 */
export class ConsoleEmailProvider implements EmailProvider {
  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    const id = crypto.randomUUID();
    console.log(
      JSON.stringify(
        {
          type: 'EMAIL',
          timestamp: new Date().toISOString(),
          id,
          to: request.to,
          cc: request.cc,
          bcc: request.bcc,
          subject: request.subject,
          body: request.body,
          html: request.html,
        },
        null,
        2
      )
    );

    return {
      id,
      status: 'sent',
    };
  }

  async sendTemplate(
    to: string,
    templateId: string,
    data: Record<string, string>
  ): Promise<SendEmailResult> {
    const id = crypto.randomUUID();
    console.log(
      JSON.stringify(
        {
          type: 'EMAIL_TEMPLATE',
          timestamp: new Date().toISOString(),
          id,
          to,
          templateId,
          data,
        },
        null,
        2
      )
    );

    return {
      id,
      status: 'sent',
    };
  }

  async verifyEmail(email: string): Promise<boolean> {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}
```

**Environment Variables (SMTP):**

```bash
EMAIL_PROVIDER=smtp              # (default for non-dev)
SMTP_HOST=mail.example.com       # SMTP server hostname
SMTP_PORT=587                    # SMTP port (usually 587 for TLS)
SMTP_TLS=true                    # Require TLS (true for 465, false for 587 STARTTLS)
SMTP_USER=noreply@example.com    # SMTP authentication username
SMTP_PASSWORD=***                # SMTP authentication password
SMTP_FROM=noreply@example.com    # From address
```

**Dev Mode Behavior:**

- Automatically falls back to ConsoleEmailProvider if `NODE_ENV=development`
- Logs all email content to stdout as JSON
- No real emails sent
- Useful for testing user flows without mail server

**Error Handling:**

- Network errors: Queue for retry via JobProvider (exponential backoff)
- SMTP authentication errors: Log once, then fail permanently
- Invalid email address: Fail immediately with validation error
- Template not found: Return error status with message

**Alternative Implementations (V1+):**

- **SendGridEmailProvider:** SendGrid API (high volume, reliability)
- **AzureCommsProvider:** Azure Communication Services
- **AwsSesProvider:** AWS SES

---

### 3. AuthSSOProvider

**Purpose:** Abstract authentication and SSO (login, token validation, user provisioning).

**Interface:**

```typescript
interface AuthSSOProvider {
  authenticate(username: string, password: string): Promise<AuthResult>;

  validateToken(token: string): Promise<ValidateTokenResult>;

  getUserInfo(token: string): Promise<UserInfo>;

  refreshToken(token: string): Promise<string>;

  getAuthorizationUrl?(redirectUri: string): Promise<string>;

  exchangeCode?(code: string, redirectUri: string): Promise<AuthResult>;

  listUsers?(): Promise<UserInfo[]>;

  syncUser?(externalId: string): Promise<UserInfo>;
}

interface AuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user: UserInfo;
}

interface UserInfo {
  id: string;
  email: string;
  name: string;
  groups?: string[];
}
```

#### MVP Default Implementation: NoOpSSOProvider

**File:** `src/providers/auth/noop-sso-provider.ts`

```typescript
/**
 * NoOpSSOProvider: Stub for SSO.
 * MVP default. All SSO methods return "not configured" error.
 *
 * Behavior:
 * - All methods throw AuthNotConfiguredError
 * - Authentication happens via BuiltInAuthProvider (email + password)
 * - No external SSO in MVP
 * - Error message clearly indicates SSO is not available
 *
 * Note: BuiltInAuthProvider is not a separate provider;
 * it's integrated directly into AuthService/CoreService.
 */
export class NoOpSSOProvider implements AuthSSOProvider {
  async authenticate(username: string, password: string): Promise<AuthResult> {
    throw new AuthNotConfiguredError('SSO is not configured. Use email/password authentication.');
  }

  async validateToken(token: string): Promise<ValidateTokenResult> {
    throw new AuthNotConfiguredError('SSO is not configured. Use email/password authentication.');
  }

  async getUserInfo(token: string): Promise<UserInfo> {
    throw new AuthNotConfiguredError('SSO is not configured. Use email/password authentication.');
  }

  async refreshToken(token: string): Promise<string> {
    throw new AuthNotConfiguredError('SSO is not configured. Use email/password authentication.');
  }

  async getAuthorizationUrl(redirectUri: string): Promise<string> {
    throw new AuthNotConfiguredError('SSO is not configured. Use email/password authentication.');
  }

  async exchangeCode(code: string, redirectUri: string): Promise<AuthResult> {
    throw new AuthNotConfiguredError('SSO is not configured. Use email/password authentication.');
  }

  async listUsers(): Promise<UserInfo[]> {
    throw new AuthNotConfiguredError('SSO is not configured. Use email/password authentication.');
  }

  async syncUser(externalId: string): Promise<UserInfo> {
    throw new AuthNotConfiguredError('SSO is not configured. Use email/password authentication.');
  }
}

class AuthNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthNotConfiguredError';
  }
}
```

**Environment Variables:**

```bash
AUTH_SSO_PROVIDER=noop            # (always noop for MVP)
```

**Dev Mode Behavior:**

- Same as production (stub)
- Test accounts can be seeded in PostgreSQL via seed script

**Error Handling:**

- All methods throw `AuthNotConfiguredError` with clear message
- HTTP endpoints catch and return 501 Not Implemented

**Alternative Implementations (V1+):**

- **OidcAuthProvider:** Generic OIDC/OAuth2 (Okta, Auth0)
- **LdapAuthProvider:** LDAP/Active Directory sync (F073, V2)
- **SamlAuthProvider:** SAML 2.0 for enterprise (F140, V2)
- **AzureEntraProvider:** Azure Entra ID (F081, V3)

---

### 4. MonitoringProvider

**Purpose:** Abstract observability (logging, metrics, tracing).

**Interface:**

```typescript
interface MonitoringProvider {
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, any>
  ): Promise<void>;

  metric(name: string, value: number, tags?: Record<string, string>): Promise<void>;

  startTrace(name: string): Span;

  trackEvent(name: string, properties?: Record<string, any>): Promise<void>;

  setUserContext(userId: string, email: string): Promise<void>;
}

interface Span {
  end(): void;
  setAttribute(key: string, value: string | number): void;
}
```

#### MVP Default Implementation: ConsoleMonitoringProvider

**File:** `src/providers/monitoring/console-monitoring-provider.ts`

```typescript
/**
 * ConsoleMonitoringProvider: Structured logging to stdout.
 * MVP default. No external APM.
 *
 * Behavior:
 * - Logs as JSON to stdout (compatible with log aggregators)
 * - Each log entry includes timestamp, level, message, context
 * - Metrics are logged as special log entries
 * - Tracing: No-op span that logs start/end
 * - Events: Logged as JSON
 *
 * Good for:
 * - Local development
 * - Docker container logging (stdout captured by Docker daemon)
 * - Kubernetes/ECS log aggregation
 *
 * For production monitoring, use OtelMonitoringProvider or Azure Insights.
 */
export class ConsoleMonitoringProvider implements MonitoringProvider {
  private currentUserId?: string;
  private currentUserEmail?: string;

  async log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, any>
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      context: context || {},
      userId: this.currentUserId,
      userEmail: this.currentUserEmail,
    };

    // Log to console based on level
    const logFunction = console[level] || console.log;
    logFunction(JSON.stringify(logEntry));
  }

  async metric(name: string, value: number, tags?: Record<string, string>): Promise<void> {
    const metricEntry = {
      timestamp: new Date().toISOString(),
      type: 'METRIC',
      metric: name,
      value,
      tags: tags || {},
    };

    console.log(JSON.stringify(metricEntry));
  }

  startTrace(name: string): Span {
    const startTime = Date.now();
    const traceId = crypto.randomUUID();

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'TRACE_START',
        traceId,
        name,
      })
    );

    return {
      attributes: {},

      setAttribute(key: string, value: string | number): void {
        this.attributes[key] = value;
      },

      end(): void {
        const duration = Date.now() - startTime;
        console.log(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            type: 'TRACE_END',
            traceId,
            name,
            duration: `${duration}ms`,
            attributes: this.attributes,
          })
        );
      },
    };
  }

  async trackEvent(name: string, properties?: Record<string, any>): Promise<void> {
    const eventEntry = {
      timestamp: new Date().toISOString(),
      type: 'EVENT',
      event: name,
      properties: properties || {},
      userId: this.currentUserId,
    };

    console.log(JSON.stringify(eventEntry));
  }

  async setUserContext(userId: string, email: string): Promise<void> {
    this.currentUserId = userId;
    this.currentUserEmail = email;
  }
}
```

**Environment Variables:**

```bash
MONITORING_PROVIDER=console       # (default for MVP)
LOG_LEVEL=info                    # Minimum log level (debug, info, warn, error)
```

**Dev Mode Behavior:**

- Same as production
- Logs to stdout in JSON format
- Can pipe to tools like `jq` for filtering

**Error Handling:**

- Logging errors are caught and ignored (fail-safe)
- No blocking on monitoring failures

**Alternative Implementations (V1+):**

- **OtelMonitoringProvider:** OpenTelemetry (vendor-agnostic, standards-based)
- **AzureInsightsProvider:** Azure Application Insights (F085, V3)

---

### 5. CDNProvider

**Purpose:** Abstract content delivery for previews and assets.

**Interface:**

```typescript
interface CDNProvider {
  publishAsset(key: string, content: Buffer | Stream): Promise<PublishResult>;

  getAssetUrl(key: string, expiresIn?: number): Promise<string>;

  invalidateCache(pattern: string): Promise<void>;

  deleteAsset(key: string): Promise<void>;
}

interface PublishResult {
  cdnUrl: string;
  storageKey: string;
}
```

#### MVP Default Implementation: DirectServeCDNProvider

**File:** `src/providers/cdn/direct-cdn-provider.ts`

```typescript
/**
 * DirectServeCDNProvider: Serve preview URLs directly from app.
 * MVP default. No external CDN.
 *
 * Behavior:
 * - Returns signed URL from StorageProvider
 * - App endpoint `/api/storage/{key}` checks permissions and streams file
 * - No CDN caching; every request hits storage
 * - Suitable for development and small deployments
 *
 * For production with many document views, use CDN provider (V1+).
 * Signed URLs: 5-minute expiry, client-side refresh for longer viewing.
 */
export class DirectServeCDNProvider implements CDNProvider {
  constructor(private storageProvider: StorageProvider) {}

  async publishAsset(key: string, content: Buffer | Stream): Promise<PublishResult> {
    // Upload to storage
    const result = await this.storageProvider.uploadFile(key, content);

    // Return storage URL (not a CDN URL)
    return {
      storageKey: result.key,
      cdnUrl: `/api/storage/${encodeURIComponent(key)}`,
    };
  }

  async getAssetUrl(key: string, expiresIn?: number): Promise<string> {
    // Return signed URL from storage with short expiry
    const signedUrl = await this.storageProvider.getSignedUrl(
      key,
      expiresIn || 300 // 5 minutes default
    );
    return signedUrl;
  }

  async invalidateCache(pattern: string): Promise<void> {
    // No-op: no CDN to invalidate
    // In production, would invalidate CDN cache
  }

  async deleteAsset(key: string): Promise<void> {
    await this.storageProvider.deleteFile(key);
  }
}
```

**Environment Variables:**

```bash
CDN_PROVIDER=direct               # (default for MVP)
SIGNED_URL_EXPIRY_SECONDS=300     # 5 minutes
```

**Dev Mode Behavior:**

- Same as production
- Uses app API endpoint for file serving
- Depends on permission checks in API endpoint

**Error Handling:**

- If StorageProvider fails, propagate error to caller
- Signed URL expiry: client handles refresh automatically (F116, V1)

**Alternative Implementations (V1+):**

- **CloudFrontCdnProvider:** AWS CloudFront (F092, V3)
- **AzureCdnProvider:** Azure CDN (F083, V3)
- **GcpCdnProvider:** Google Cloud CDN (F094, V3)

---

### 6. JobProvider

**Purpose:** Abstract background job queue (enqueue, process, retry, schedule).

**Interface:**

```typescript
interface JobProvider {
  enqueueJob<T>(queueName: string, jobType: string, payload: T, options?: JobOptions): Promise<Job>;

  onJobComplete(
    queueName: string,
    jobType: string,
    handler: (job: Job, result: any) => Promise<void>
  ): void;

  onJobFailed(
    queueName: string,
    jobType: string,
    handler: (job: Job, error: Error) => Promise<void>
  ): void;

  getJobStatus(jobId: string): Promise<JobStatus>;

  cancelJob(jobId: string): Promise<void>;

  scheduleJob(
    queueName: string,
    jobType: string,
    payload: any,
    cronExpression: string
  ): Promise<ScheduledJob>;
}

interface JobOptions {
  priority?: 'high' | 'normal' | 'low';
  attempts?: number;
  backoff?: number;
  delay?: number;
  timeout?: number;
}
```

#### MVP Default Implementation: BullMqJobProvider

**File:** `src/providers/job/bullmq-job-provider.ts`

```typescript
/**
 * BullMqJobProvider: Multi-priority job queue via Redis.
 * MVP default and only real option (InProcessJobProvider is fallback only).
 *
 * Behavior:
 * - Uses BullMQ (Bull on steroids) for job queuing
 * - Redis backend for persistence and horizontal scaling
 * - Multi-priority queues: high, normal, low, scheduled
 * - Automatic retries with exponential backoff
 * - Idempotent by design (safe for redelivery)
 * - Workers configured separately (preview, scan, general, report)
 *
 * Job Priorities:
 * - High: Preview generation, virus scanning (block viewers)
 * - Normal: Email dispatch, notifications, webhooks
 * - Low: Analytics aggregation, report generation
 * - Scheduled: Retention cleanup, expiry checks, daily digests
 *
 * Requirements:
 * - Redis running on REDIS_URL or REDIS_HOST:REDIS_PORT
 * - Worker processes listening on respective queues
 */
export class BullMqJobProvider implements JobProvider {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();

  async enqueueJob<T>(
    queueName: string,
    jobType: string,
    payload: T,
    options?: JobOptions
  ): Promise<Job> {
    const queue = this.getQueue(queueName);

    const bullMqOptions: BullMQJobOptions = {
      attempts: options?.attempts || 3,
      backoff: {
        type: 'exponential',
        delay: options?.backoff || 2000,
      },
      priority: this.priorityToNumeric(options?.priority || 'normal'),
      delay: options?.delay || 0,
      timeout: options?.timeout || 60000,
    };

    const bullJob = await queue.add(jobType, payload, bullMqOptions);

    return {
      id: bullJob.id!,
      queueName,
      jobType,
      payload,
      status: 'pending',
      attempts: 0,
    };
  }

  onJobComplete(
    queueName: string,
    jobType: string,
    handler: (job: Job, result: any) => Promise<void>
  ): void {
    const queue = this.getQueue(queueName);

    queue.on('completed', async (bullJob) => {
      if (bullJob.name === jobType) {
        const job = this.bullJobToJob(bullJob);
        await handler(job, bullJob.returnvalue);
      }
    });
  }

  onJobFailed(
    queueName: string,
    jobType: string,
    handler: (job: Job, error: Error) => Promise<void>
  ): void {
    const queue = this.getQueue(queueName);

    queue.on('failed', async (bullJob, err) => {
      if (bullJob.name === jobType) {
        const job = this.bullJobToJob(bullJob);
        await handler(job, err);
      }
    });
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    // Search all queues for job
    for (const queue of this.queues.values()) {
      const bullJob = await queue.getJob(jobId);
      if (bullJob) {
        if (await bullJob.isCompleted()) return 'completed';
        if (await bullJob.isFailed()) return 'failed';
        if (await bullJob.isActive()) return 'active';
        if (await bullJob.isDelayed()) return 'delayed';
        return 'pending';
      }
    }
    throw new JobNotFoundError(`Job ${jobId} not found`);
  }

  async cancelJob(jobId: string): Promise<void> {
    for (const queue of this.queues.values()) {
      const bullJob = await queue.getJob(jobId);
      if (bullJob) {
        await bullJob.remove();
        return;
      }
    }
    throw new JobNotFoundError(`Job ${jobId} not found`);
  }

  async scheduleJob(
    queueName: string,
    jobType: string,
    payload: any,
    cronExpression: string
  ): Promise<ScheduledJob> {
    const queue = this.getQueue(queueName);

    const repeatConfig = {
      pattern: cronExpression,
    };

    const bullJob = await queue.add(jobType, payload, {
      repeat: repeatConfig,
    });

    return {
      id: bullJob.id!,
      jobType,
      cronExpression,
      nextRun: new Date(bullJob.timestamp + bullJob.nextTimestamp),
    };
  }

  private getQueue(queueName: string): Queue {
    if (!this.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: {
          url: process.env.REDIS_URL || 'redis://localhost:6379',
        },
      });
      this.queues.set(queueName, queue);
    }
    return this.queues.get(queueName)!;
  }

  private priorityToNumeric(priority: 'high' | 'normal' | 'low'): number {
    const map = { high: 1, normal: 5, low: 10 };
    return map[priority];
  }

  private bullJobToJob(bullJob: BullMQJob): Job {
    return {
      id: bullJob.id!,
      queueName: bullJob.queueName,
      jobType: bullJob.name,
      payload: bullJob.data,
      status: 'active',
      attempts: bullJob.attemptsMade,
    };
  }
}
```

**Environment Variables:**

```bash
JOB_PROVIDER=bullmq               # (always bullmq for MVP)
REDIS_URL=redis://localhost:6379  # Redis connection URL (canonical from DEPLOYMENT.md)
```

**Dev Mode Behavior:**

- Same as production
- Uses Redis from docker-compose.yml
- Logs job completions to monitoring provider

**Error Handling:**

- Job fails after max attempts (default 3)
- Exponential backoff between retries
- Job stored in Redis; survives process restart
- Failed jobs accessible via dashboard (V1+)

**Worker Configuration:**

```bash
# Start all workers
npm run worker

# Start specific worker type
npm run worker -- --queue=preview   # Preview generation
npm run worker -- --queue=scan      # Virus scanning
npm run worker -- --queue=general   # Email, webhooks, analytics
npm run worker -- --queue=report    # Binder exports, compliance reports
```

**Alternative Implementations:**

- **InProcessJobProvider:** In-process queue (fallback only, no scale)

---

### 7. CacheProvider

**Purpose:** Abstract caching layer (sessions, rate limits, preview metadata, frequently accessed data).

**Interface:**

```typescript
interface CacheProvider {
  get<T>(key: string): Promise<T | null>;

  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  delete(key: string): Promise<void>;

  clear(): Promise<void>;

  increment(key: string, amount?: number): Promise<number>;

  getAndIncrement(key: string, ttlSeconds?: number, amount?: number): Promise<number>;
}
```

#### MVP Default Implementation: RedisCacheProvider

**File:** `src/providers/cache/redis-cache-provider.ts`

```typescript
/**
 * RedisCacheProvider: Session and rate-limit caching via Redis.
 * MVP default.
 *
 * Behavior:
 * - Uses ioredis client for efficiency
 * - Automatic expiration via Redis TTL
 * - Atomic increment for rate limiting
 * - Optional compression for large values
 * - Shared cache across all app instances (distributed)
 *
 * Use cases:
 * - Session storage (5-minute refresh, 2-hour total lifetime)
 * - Rate limiting (per-user, per-IP)
 * - Preview metadata (temporary, 1 hour)
 * - Permission cache (5-minute TTL, invalidated on change)
 */
export class RedisCacheProvider implements CacheProvider {
  private redis: Redis;
  private keyPrefix: string;

  constructor(options?: { keyPrefix?: string; url?: string }) {
    this.keyPrefix = options?.keyPrefix || 'cache:';
    this.redis = new Redis(
      options?.url ||
        process.env.REDIS_URL || {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        }
    );
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(this.keyPrefix + key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch (error) {
      // Corrupted value; delete and return null
      await this.delete(key);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const json = JSON.stringify(value);
    const redisKey = this.keyPrefix + key;

    if (ttlSeconds) {
      await this.redis.setex(redisKey, ttlSeconds, json);
    } else {
      await this.redis.set(redisKey, json);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.keyPrefix + key);
  }

  async clear(): Promise<void> {
    const pattern = this.keyPrefix + '*';
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async increment(key: string, amount?: number): Promise<number> {
    const redisKey = this.keyPrefix + key;
    const delta = amount || 1;
    return await this.redis.incrby(redisKey, delta);
  }

  async getAndIncrement(key: string, ttlSeconds?: number, amount?: number): Promise<number> {
    const redisKey = this.keyPrefix + key;
    const delta = amount || 1;

    const count = await this.redis.incrby(redisKey, delta);

    if (ttlSeconds && count === delta) {
      // First increment; set expiry
      await this.redis.expire(redisKey, ttlSeconds);
    }

    return count;
  }
}
```

**Environment Variables:**

```bash
CACHE_PROVIDER=redis              # (default for MVP)
REDIS_URL=redis://localhost:6379  # Redis connection URL (canonical from DEPLOYMENT.md)
CACHE_KEY_PREFIX=vaultspace:    # Prefix for cache keys
```

**Dev Mode Behavior:**

- Same as production
- Uses Redis from docker-compose.yml
- Can inspect cache with `redis-cli KEYS 'vaultspace:*'`

**Error Handling:**

- Connection errors: Logged, fail-fast (no fallback cache)
- Corrupted values: Deleted and return null
- Key expiry: Automatic, no cleanup needed

**Cache Invalidation:**

- Permission changes: EventBus invalidates cache (F145)
- Document changes: EventBus invalidates related caches
- Manual: `clear()` method (admin only)

**Alternative Implementations:**

- **InMemoryCacheProvider:** In-memory LRU (single process, no distribution)

---

### 8. PreviewProvider

**Purpose:** Abstract document conversion to preview format (PDF) and thumbnails. Orchestrates OCR as part of the pipeline (F132).

**Interface:**

```typescript
interface PreviewProvider {
  convertToPreview(
    sourceKey: string,
    sourceFormat: string,
    options?: PreviewOptions
  ): Promise<PreviewResult>;

  generateThumbnail(
    pdfKey: string,
    pageNumber: number,
    width: number,
    height: number
  ): Promise<Buffer>;

  extractText(sourceKey: string, sourceFormat: string): Promise<string>;

  applyWatermark(
    pdfKey: string,
    watermarkText: string,
    options?: WatermarkOptions
  ): Promise<Buffer>;

  getSupportedFormats(): Promise<string[]>;
}

interface OCREngine {
  performOCR(sourceKey: string, sourceFormat: string, options?: OCROptions): Promise<string>;

  requiresOCR(sourceKey: string, sourceFormat: string): Promise<boolean>;
}
```

#### MVP Default Implementation: GotenbergPreviewProvider

**File:** `src/providers/preview/gotenberg-preview-provider.ts`

```typescript
/**
 * GotenbergPreviewProvider: Document conversion via Gotenberg microservice.
 * MVP default.
 *
 * Behavior:
 * - Sends documents to Gotenberg service for conversion
 * - Supports Office (Word, Excel, PowerPoint), PDF, images
 * - Integrated OCR via Tesseract for scanned PDFs (F132)
 * - Thumbnail generation via ImageMagick
 * - Watermarking via pdftk or similar
 *
 * OCR Pipeline:
 * 1. Convert source document to PDF (if needed)
 * 2. Detect if PDF is scanned (requires OCR)
 * 3. If scanned, apply Tesseract OCR to extract text
 * 4. Return combined text for search indexing
 *
 * Benefits:
 * - Containerizable (runs in Docker)
 * - Handles many formats reliably
 * - No local LibreOffice/ImageMagick installation needed
 * - Scalable via separate preview workers
 *
 * Deployment:
 * - Gotenberg service in docker-compose.yml
 * - Preview workers in separate containers
 */
export class GotenbergPreviewProvider implements PreviewProvider {
  private gotenbergUrl: string;
  private ocrEngine: OCREngine;

  constructor(options: { gotenbergUrl: string; ocrEngine: OCREngine }) {
    this.gotenbergUrl = options.gotenbergUrl;
    this.ocrEngine = options.ocrEngine;
  }

  async convertToPreview(
    sourceKey: string,
    sourceFormat: string,
    options?: PreviewOptions
  ): Promise<PreviewResult> {
    try {
      // Download source file from storage
      const sourceBuffer = await this.storageProvider.downloadFile(sourceKey);

      // Send to Gotenberg for conversion
      const pdfBuffer = await this.convertViaGotenberg(sourceBuffer, sourceFormat, options);

      // Store PDF
      const pdfKey = `${sourceKey}.preview.pdf`;
      const uploadResult = await this.storageProvider.uploadFile(pdfKey, pdfBuffer);

      // Extract text (including OCR for scanned documents)
      const text = await this.extractText(sourceKey, sourceFormat);

      // Store extracted text for search indexing
      const textKey = `${sourceKey}.extracted-text.txt`;
      await this.storageProvider.uploadFile(textKey, Buffer.from(text));

      // Get page count from PDF
      const pageCount = await this.getPdfPageCount(pdfBuffer);

      return {
        pdfKey,
        pageCount,
        size: pdfBuffer.length,
        textKey,
      };
    } catch (error) {
      throw new PreviewError(`Failed to convert ${sourceKey}: ${error.message}`);
    }
  }

  async generateThumbnail(
    pdfKey: string,
    pageNumber: number,
    width: number,
    height: number
  ): Promise<Buffer> {
    try {
      // Download PDF
      const pdfBuffer = await this.storageProvider.downloadFile(pdfKey);

      // Convert PDF page to image via ImageMagick
      const imageBuffer = await this.pdfPageToImage(pdfBuffer, pageNumber, width, height);

      return imageBuffer;
    } catch (error) {
      throw new PreviewError(
        `Failed to generate thumbnail for ${pdfKey} page ${pageNumber}: ${error.message}`
      );
    }
  }

  async extractText(sourceKey: string, sourceFormat: string): Promise<string> {
    try {
      // Download source file
      const sourceBuffer = await this.storageProvider.downloadFile(sourceKey);

      // Convert to PDF (if not already)
      let pdfBuffer: Buffer;
      if (sourceFormat.toLowerCase() === 'pdf') {
        pdfBuffer = sourceBuffer;
      } else {
        pdfBuffer = await this.convertViaGotenberg(sourceBuffer, sourceFormat);
      }

      // Check if PDF requires OCR (is scanned)
      const requiresOcr = await this.ocrEngine.requiresOCR(sourceKey, sourceFormat);

      if (requiresOcr) {
        // Apply OCR to extract text
        return await this.ocrEngine.performOCR(sourceKey, sourceFormat);
      } else {
        // Extract text from native PDF
        return await this.extractTextFromPdf(pdfBuffer);
      }
    } catch (error) {
      throw new PreviewError(`Failed to extract text from ${sourceKey}: ${error.message}`);
    }
  }

  async applyWatermark(
    pdfKey: string,
    watermarkText: string,
    options?: WatermarkOptions
  ): Promise<Buffer> {
    try {
      // Download PDF
      const pdfBuffer = await this.storageProvider.downloadFile(pdfKey);

      // Apply watermark (via pdftk or Gotenberg)
      const watermarkedBuffer = await this.watermarkPdf(pdfBuffer, watermarkText, options);

      return watermarkedBuffer;
    } catch (error) {
      throw new PreviewError(`Failed to watermark ${pdfKey}: ${error.message}`);
    }
  }

  async getSupportedFormats(): Promise<string[]> {
    return [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'odt',
      'ods',
      'odp',
      'jpg',
      'jpeg',
      'png',
      'gif',
      'tiff',
    ];
  }

  private async convertViaGotenberg(
    buffer: Buffer,
    format: string,
    options?: PreviewOptions
  ): Promise<Buffer> {
    // POST file to Gotenberg API
    // Returns PDF
    const formData = new FormData();
    formData.append('files', buffer, `document.${format}`);

    const response = await fetch(`${this.gotenbergUrl}/forms/libreoffice/convert`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new PreviewError(`Gotenberg conversion failed: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // ... other private methods (extractTextFromPdf, watermarkPdf, etc.)
}
```

**Environment Variables:**

```bash
PREVIEW_PROVIDER=gotenberg       # (default for MVP)
GOTENBERG_URL=http://gotenberg:3000  # Gotenberg service URL
OCR_LANGUAGE=en                  # Default OCR language (ISO 639-1 code)
```

**Dev Mode Behavior:**

- Same as production
- Gotenberg service running in docker-compose.yml
- Can test conversion via curl or web UI

**Error Handling:**

- Gotenberg connection failure: Fail with error
- Unsupported format: Return error
- Corrupted file: Return error
- OCR timeout: Fall back to native text extraction if available

**Alternative Implementations:**

- **LibreOfficePreviewProvider:** Local LibreOffice headless with Tesseract OCR

---

### 9. ScanProvider

**Purpose:** Abstract virus/malware scanning.

**Interface:**

```typescript
interface ScanProvider {
  scan(fileKey: string): Promise<ScanResult>;

  getScanStatus(scanId: string): Promise<ScanStatus>;
}

interface ScanResult {
  scanId: string;
  status: 'clean' | 'infected' | 'error';
  threats?: ThreatInfo[];
  scannedAt: Date;
}

interface ThreatInfo {
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

type ScanStatus = 'pending' | 'scanning' | 'complete' | 'error';
```

#### MVP Default Implementation: ClamAVScanProvider

**File:** `src/providers/scan/clamav-scan-provider.ts`

```typescript
/**
 * ClamAVScanProvider: Virus scanning via ClamAV daemon.
 * MVP default.
 *
 * Behavior:
 * - Scans files immediately after upload (via preview worker job)
 * - Uses ClamAV daemon (clamdscan) for efficiency
 * - Blocks document viewing if scan is pending or file is infected
 * - Quarantines infected files
 * - Logs all scans for audit
 *
 * Integration:
 * - High-priority job: scan-worker picks up immediately
 * - Blocking: Document marked as "scan_required: true" until scan complete
 * - Failure: Admin notified, file flagged
 *
 * Deployment:
 * - ClamAV daemon in docker-compose.yml
 * - Shares storage with app for file access
 */
export class ClamAVScanProvider implements ScanProvider {
  private clamdHost: string;
  private clamdPort: number;

  constructor(options?: { clamdHost?: string; clamdPort?: number }) {
    this.clamdHost = options?.clamdHost || process.env.CLAMAV_HOST || 'localhost';
    this.clamdPort = options?.clamdPort || parseInt(process.env.CLAMAV_PORT || '3310');
  }

  async scan(fileKey: string): Promise<ScanResult> {
    const scanId = crypto.randomUUID();

    try {
      // Download file from storage
      const buffer = await this.storageProvider.downloadFile(fileKey);

      // Connect to ClamAV daemon and scan
      const result = await this.scanViaClam(buffer, scanId);

      // Log scan result to audit trail
      await this.logScanResult(fileKey, result);

      if (result.status === 'infected') {
        // Quarantine file
        await this.quarantineFile(fileKey);
        // Notify admin
        await this.notifyAdmin(fileKey, result.threats!);
      }

      return result;
    } catch (error) {
      throw new ScanError(`Failed to scan ${fileKey}: ${error.message}`);
    }
  }

  async getScanStatus(scanId: string): Promise<ScanStatus> {
    // Query database for scan status
    const record = await db.scanResult.findUnique({ where: { scanId } });
    if (!record) throw new ScanError(`Scan ${scanId} not found`);
    return record.status;
  }

  private async scanViaClam(buffer: Buffer, scanId: string): Promise<ScanResult> {
    // Use clamdscan or TCP/HTTP endpoint
    // Returns ScanResult with status and threats

    // Example: TCP socket to ClamAV daemon
    const client = new clamscan({
      host: this.clamdUrl.split(':')[0],
      port: parseInt(this.clamdUrl.split(':')[1] || '3310'),
    });

    const { isInfected, viruses } = await client.scanBuffer(buffer);

    return {
      scanId,
      status: isInfected ? 'infected' : 'clean',
      threats: viruses?.map((v) => ({
        name: v,
        severity: 'high', // ClamAV doesn't provide severity; assume high
      })),
      scannedAt: new Date(),
    };
  }

  private async quarantineFile(fileKey: string): Promise<void> {
    // Move file to quarantine bucket/path
    const quarantineKey = `quarantine/${new Date().toISOString()}/${fileKey}`;
    await this.storageProvider.copyFile(fileKey, quarantineKey);
    // Original file is deleted via document deletion flow
  }

  private async notifyAdmin(fileKey: string, threats: ThreatInfo[]): Promise<void> {
    // Enqueue email job to notify admins
    const organization = await this.getOrganizationForFile(fileKey);
    const admins = await this.getAdminsForOrganization(organization.id);

    for (const admin of admins) {
      await this.jobProvider.enqueueJob('general', 'send-infected-notification', {
        adminEmail: admin.email,
        fileKey,
        threats,
      });
    }
  }

  // ... helper methods
}
```

**Environment Variables:**

```bash
SCAN_PROVIDER=clamav              # (default for MVP)
CLAMAV_HOST=localhost             # ClamAV daemon hostname (canonical from DEPLOYMENT.md)
CLAMAV_PORT=3310                  # ClamAV daemon port
CLAMAV_SOCKET=/var/run/clamav/clamd.ctl  # (alternative: Unix socket)
```

**Dev Mode Behavior:**

- Same as production
- ClamAV daemon running in docker-compose.yml
- Scans files immediately after upload
- Can inspect quarantine directory

**Error Handling:**

- ClamAV connection failure: Mark scan as error, retry via job queue
- Timeout: Mark scan as error after timeout (30 seconds)
- Corrupted file: Mark scan as error
- If scan never completes: Document remains blocked (admin intervention required)

**Workflow:**

1. User uploads document
2. Document created with `scan_required: true`
3. High-priority scan job enqueued
4. Scan worker picks up job, calls `ClamAVScanProvider.scan()`
5. If clean: `scan_required: false`, document viewable
6. If infected: file quarantined, admins notified, document deleted
7. If error: retry job (up to 3 times), then mark as error

**Alternative Implementations:**

- None (ClamAV is only open-source option for MVP; commercial scanners in V1+)

---

### 10. SearchProvider

**Purpose:** Abstract full-text search indexing and querying.

**Interface:**

```typescript
interface SearchProvider {
  indexDocument(
    documentId: string,
    versionId: string,
    organizationId: string,
    text: string,
    metadata?: SearchMetadata
  ): Promise<void>;

  search(organizationId: string, query: string, options?: SearchOptions): Promise<SearchResult[]>;

  deleteIndex(documentId: string, versionId: string): Promise<void>;

  clearOrganization(organizationId: string): Promise<void>;
}

interface SearchMetadata {
  fileName: string;
  fileType: string;
  tags: string[];
  customFields?: Record<string, string>;
}

interface SearchOptions {
  limit?: number;
  offset?: number;
  fields?: string[];
  filters?: Record<string, any>;
}

interface SearchResult {
  documentId: string;
  versionId: string;
  fileName: string;
  score: number;
  excerpt?: string;
}
```

#### MVP Default Implementation: PostgresFtsSearchProvider

**File:** `src/providers/search/postgres-fts-search-provider.ts`

```typescript
/**
 * PostgresFtsSearchProvider: Full-text search via PostgreSQL tsvector/tsquery.
 * MVP default. Shipped with framework; feature F011 is V1.
 *
 * Behavior:
 * - Uses PostgreSQL built-in full-text search (FTS)
 * - Indexes document text via tsvector column
 * - Queries via tsquery and ranking functions
 * - Single-database solution (no external dependency)
 * - Sufficient for MVP scale (thousands of documents)
 *
 * Limitations:
 * - No fuzzy/typo-tolerance
 * - Limited to single language (English)
 * - Slower than Meilisearch/OpenSearch at scale (10K+ docs)
 *
 * Use cases:
 * - Text search in document content
 * - Metadata search (filename, tags)
 * - Combined search with permissions
 *
 * Database:
 * - Table: document_search_index
 *   - document_id
 *   - version_id
 *   - organization_id
 *   - file_name
 *   - file_type
 *   - text_content (tsvector, indexed)
 *   - tags (array, indexed)
 *   - custom_fields (jsonb)
 *   - created_at
 */
export class PostgresFtsSearchProvider implements SearchProvider {
  async indexDocument(
    documentId: string,
    versionId: string,
    organizationId: string,
    text: string,
    metadata?: SearchMetadata
  ): Promise<void> {
    try {
      // Insert or update search index
      await db.documentSearchIndex.upsert({
        where: { documentId_versionId: { documentId, versionId } },
        create: {
          documentId,
          versionId,
          organizationId,
          fileName: metadata?.fileName || 'unknown',
          fileType: metadata?.fileType || 'unknown',
          textContent: text, // Stored as tsvector by database trigger
          tags: metadata?.tags || [],
          customFields: metadata?.customFields || {},
        },
        update: {
          textContent: text,
          tags: metadata?.tags || [],
          customFields: metadata?.customFields || {},
        },
      });
    } catch (error) {
      throw new SearchError(`Failed to index document: ${error.message}`);
    }
  }

  async search(
    organizationId: string,
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    try {
      // Parse query and build tsquery
      const tsquery = this.buildTsquery(query);

      // Search with ranking
      const results = await db.$queryRaw<SearchResult[]>`
        SELECT
          document_id as "documentId",
          version_id as "versionId",
          file_name as "fileName",
          ts_rank(text_content, ${tsquery}::tsquery) as score,
          ts_headline(text_content, ${tsquery}::tsquery, 'MaxWords=20, MinWords=5') as excerpt
        FROM document_search_index
        WHERE
          organization_id = ${organizationId}
          AND text_content @@ ${tsquery}::tsquery
        ORDER BY score DESC
        LIMIT ${options?.limit || 50}
        OFFSET ${options?.offset || 0}
      `;

      return results;
    } catch (error) {
      throw new SearchError(`Search failed: ${error.message}`);
    }
  }

  async deleteIndex(documentId: string, versionId: string): Promise<void> {
    try {
      await db.documentSearchIndex.delete({
        where: { documentId_versionId: { documentId, versionId } },
      });
    } catch (error) {
      throw new SearchError(`Failed to delete index: ${error.message}`);
    }
  }

  async clearOrganization(organizationId: string): Promise<void> {
    try {
      await db.documentSearchIndex.deleteMany({
        where: { organizationId },
      });
    } catch (error) {
      throw new SearchError(`Failed to clear organization index: ${error.message}`);
    }
  }

  private buildTsquery(query: string): string {
    // Convert user query to PostgreSQL tsquery format
    // Simple: split on spaces, join with AND (&)
    // More complex: support OR (|), NOT (!), phrases

    const terms = query
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/[^a-zA-Z0-9]/g, '')) // Sanitize
      .join(' & ');

    return terms || 'true'; // 'true' matches all if empty query
  }
}
```

**Environment Variables:**

```bash
SEARCH_PROVIDER=postgres-fts      # (default for MVP)
# Uses same DATABASE_URL as app
```

**Dev Mode Behavior:**

- Same as production
- Searches against local PostgreSQL database
- Can inspect index via `SELECT * FROM document_search_index`

**Error Handling:**

- Invalid query: Fail gracefully (invalid tsquery)
- Large result set: Return up to 50 by default
- Database error: Propagate error to caller

**Indexing Workflow:**

1. Document uploaded
2. Preview worker extracts text via PreviewProvider
3. Search provider indexes text via `indexDocument()`
4. Text stored in `document_search_index` table with tsvector
5. Query executes against tsvector column

**Alternative Implementations (V1+):**

- **MeilisearchProvider:** Meilisearch (fast, typo-tolerant, featured)
- **OpenSearchProvider:** OpenSearch/Elasticsearch (enterprise-scale, vector search)

---

### 11. EncryptionProvider

**Purpose:** Abstract document encryption at rest.

**Interface:**

```typescript
interface EncryptionProvider {
  encrypt(plaintext: Buffer): Promise<EncryptedData>;

  decrypt(encrypted: EncryptedData): Promise<Buffer>;

  rotateKey(): Promise<void>;

  getKeyVersion(): Promise<string>;
}

interface EncryptedData {
  ciphertext: Buffer;
  iv: Buffer;
  keyVersion: string;
}
```

#### MVP Default Implementation: NoOpEncryptionProvider

**File:** `src/providers/encryption/noop-encryption-provider.ts`

```typescript
/**
 * NoOpEncryptionProvider: No-op encryption (documents stored plaintext).
 * MVP default. Encryption at rest is Feature F120, implemented in V1.
 *
 * Behavior:
 * - encrypt() returns plaintext directly (with dummy metadata)
 * - decrypt() returns ciphertext directly
 * - No key rotation or versioning
 * - Documents stored unencrypted in storage
 *
 * Security Model:
 * - Transport security: HTTPS/TLS (encryption in transit)
 * - Access control: Permission engine + 404-on-cross-tenant
 * - Physical security: Rely on storage provider (local disk permissions, S3 bucket policy)
 * - Compliance: No document encryption for MVP
 *
 * Note: Production deployments should use AesEncryptionProvider (V1+)
 * or cloud-native key management (Azure Key Vault, AWS KMS).
 *
 * Audit trail:
 * - All document access logged to events table
 * - Can generate compliance reports from audit trail
 */
export class NoOpEncryptionProvider implements EncryptionProvider {
  async encrypt(plaintext: Buffer): Promise<EncryptedData> {
    // No-op: return plaintext with dummy metadata
    return {
      ciphertext: plaintext,
      iv: Buffer.alloc(16), // Dummy IV
      keyVersion: 'noop',
    };
  }

  async decrypt(encrypted: EncryptedData): Promise<Buffer> {
    // No-op: return ciphertext directly
    return encrypted.ciphertext;
  }

  async rotateKey(): Promise<void> {
    // No-op: no key rotation
  }

  async getKeyVersion(): Promise<string> {
    return 'noop';
  }
}
```

**File:** `src/providers/encryption/aes-encryption-provider.ts` (Ready for V1)

```typescript
/**
 * AesEncryptionProvider: AES-256-GCM encryption at rest.
 * Implemented in V1 (Feature F120).
 * Ready-to-use template; shipping documentation for future implementation.
 *
 * Behavior:
 * - Encrypts documents before writing to storage
 * - Decrypts documents after retrieval
 * - Master key from environment variable (simple) or Vault (production)
 * - Automatic key versioning for key rotation
 *
 * Key Management:
 * - Master key in ENCRYPTION_KEY environment variable (simple)
 * - Or: integrate with HashiCorp Vault, Azure Key Vault, AWS KMS
 *
 * Implementation notes:
 * - Use crypto.createCipheriv() for AES-256-GCM
 * - Generate random IV for each encryption
 * - Store IV with ciphertext (IV is not secret)
 * - Key version allows zero-downtime key rotation
 */
export class AesEncryptionProvider implements EncryptionProvider {
  // Implementation in V1
  async encrypt(plaintext: Buffer): Promise<EncryptedData> {
    throw new NotImplementedError('AesEncryptionProvider available in V1+');
  }

  async decrypt(encrypted: EncryptedData): Promise<Buffer> {
    throw new NotImplementedError('AesEncryptionProvider available in V1+');
  }

  async rotateKey(): Promise<void> {
    throw new NotImplementedError('AesEncryptionProvider available in V1+');
  }

  async getKeyVersion(): Promise<string> {
    throw new NotImplementedError('AesEncryptionProvider available in V1+');
  }
}
```

**Environment Variables:**

```bash
ENCRYPTION_PROVIDER=noop          # (default for MVP)
# In V1:
# ENCRYPTION_PROVIDER=aes
# ENCRYPTION_KEY=<base64-encoded-32-byte-key>
```

**Dev Mode Behavior:**

- Same as production (no-op)

**Error Handling:**

- Invalid key format: Fail on startup
- Encryption errors: Return error to caller
- Decryption failures: Propagate error (document unreadable)

**Future Implementation (V1):**

- AesEncryptionProvider with AES-256-GCM
- Key rotation via database trigger (multi-version support)
- Azure Key Vault integration option
- AWS KMS integration option

**Alternative Implementations (V1+):**

- **AesEncryptionProvider:** AES-256-GCM with master key from env/Vault
- **VaultEncryptionProvider:** HashiCorp Vault (centralized key management)
- **AzureKeyVaultProvider:** Azure Key Vault (F082, V3)
- **AwsKmsProvider:** AWS KMS (V3)

---

### 12. AIProvider

**Purpose:** Abstract AI services (categorization, summarization, semantic search, Q&A).

**Interface:**

```typescript
interface AIProvider {
  categorizeDocument(text: string, categories: string[]): Promise<CategorizeResult>;

  summarizeDocument(text: string): Promise<string>;

  embedText(text: string): Promise<number[]>;

  answerQuestion(context: string, question: string): Promise<string>;

  detectSensitiveContent(text: string): Promise<SensitiveContent[]>;
}

interface CategorizeResult {
  category: string;
  confidence: number;
}

interface SensitiveContent {
  type: 'pii' | 'credit_card' | 'ssn' | 'api_key' | 'custom';
  pattern: string;
  position: { start: number; end: number };
}
```

#### MVP Default Implementation: NoOpAIProvider

**File:** `src/providers/ai/noop-ai-provider.ts`

```typescript
/**
 * NoOpAIProvider: Stub for AI features.
 * MVP default. All AI features return "not configured" error.
 *
 * Behavior:
 * - All methods throw AINotConfiguredError
 * - All AI features are V2+
 * - No LLM integration in MVP
 *
 * Note: Future implementations will integrate OpenAI, Anthropic, or local LLMs.
 */
export class NoOpAIProvider implements AIProvider {
  async categorizeDocument(text: string, categories: string[]): Promise<CategorizeResult> {
    throw new AINotConfiguredError('AI features not available in MVP');
  }

  async summarizeDocument(text: string): Promise<string> {
    throw new AINotConfiguredError('AI features not available in MVP');
  }

  async embedText(text: string): Promise<number[]> {
    throw new AINotConfiguredError('AI features not available in MVP');
  }

  async answerQuestion(context: string, question: string): Promise<string> {
    throw new AINotConfiguredError('AI features not available in MVP');
  }

  async detectSensitiveContent(text: string): Promise<SensitiveContent[]> {
    throw new AINotConfiguredError('AI features not available in MVP');
  }
}

class AINotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AINotConfiguredError';
  }
}
```

**Environment Variables:**

```bash
AI_PROVIDER=noop                  # (always noop for MVP)
# In V2:
# AI_PROVIDER=openai
# OPENAI_API_KEY=sk-***
```

**Dev Mode Behavior:**

- Same as production (stub)

**Error Handling:**

- All methods throw `AINotConfiguredError`
- HTTP endpoints return 503 Service Unavailable

**Alternative Implementations (V2+):**

- **OpenAiProvider:** OpenAI GPT-4 API
- **AnthropicProvider:** Anthropic Claude API
- **AzureOpenAiProvider:** Azure OpenAI (V3)
- **LocalLLMProvider:** Local LLM (Ollama, LM Studio)

---

### 13. SignatureProvider

**Purpose:** Abstract e-signature capabilities (built-in or external).

**Interface:**

```typescript
interface SignatureProvider {
  createSignatureRequest(
    documentId: string,
    signerEmail: string,
    signerName: string
  ): Promise<SignatureRequest>;

  getSignatureStatus(requestId: string): Promise<SignatureStatus>;

  verifySignature(documentId: string, signatureData: SignatureData): Promise<boolean>;

  getSignedDocument(requestId: string): Promise<Buffer>;
}

interface SignatureRequest {
  id: string;
  documentId: string;
  signerEmail: string;
  status: 'pending' | 'signed' | 'expired' | 'declined';
  externalId?: string;
}

interface SignatureData {
  requestId: string;
  signature: string;
  timestamp: Date;
  certificateChain?: string[];
}
```

#### MVP Default Implementation: NoOpSignatureProvider

**File:** `src/providers/signature/noop-signature-provider.ts`

```typescript
/**
 * NoOpSignatureProvider: Stub for e-signatures.
 * MVP default. All e-signature features return "not configured" error.
 *
 * Behavior:
 * - All methods throw SignatureNotConfiguredError
 * - All e-signature features are V2+
 * - No signing capability in MVP
 *
 * Note: Future implementations will integrate DocuSign or built-in signatures.
 */
export class NoOpSignatureProvider implements SignatureProvider {
  async createSignatureRequest(
    documentId: string,
    signerEmail: string,
    signerName: string
  ): Promise<SignatureRequest> {
    throw new SignatureNotConfiguredError('E-signatures not available in MVP');
  }

  async getSignatureStatus(requestId: string): Promise<SignatureStatus> {
    throw new SignatureNotConfiguredError('E-signatures not available in MVP');
  }

  async verifySignature(documentId: string, signatureData: SignatureData): Promise<boolean> {
    throw new SignatureNotConfiguredError('E-signatures not available in MVP');
  }

  async getSignedDocument(requestId: string): Promise<Buffer> {
    throw new SignatureNotConfiguredError('E-signatures not available in MVP');
  }
}

class SignatureNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureNotConfiguredError';
  }
}
```

**Environment Variables:**

```bash
SIGNATURE_PROVIDER=noop           # (always noop for MVP)
# In V2:
# SIGNATURE_PROVIDER=docusign
# DOCUSIGN_API_KEY=***
```

**Dev Mode Behavior:**

- Same as production (stub)

**Error Handling:**

- All methods throw `SignatureNotConfiguredError`
- HTTP endpoints return 503 Service Unavailable

**Alternative Implementations (V2+):**

- **BuiltInSignatureProvider:** Simple browser-based draw/type signature
- **DocusignProvider:** DocuSign integration (F048, V2)

---

## Provider Matrix Summary

| Provider       | MVP Default                                     | Dev Behavior                   | Required Env Vars                                | V1 Alternative                                |
| -------------- | ----------------------------------------------- | ------------------------------ | ------------------------------------------------ | --------------------------------------------- |
| **Storage**    | LocalStorageProvider                            | Files to ./data/storage        | `STORAGE_LOCAL_PATH`                             | S3StorageProvider, AzureBlobProvider          |
| **Email**      | SmtpEmailProvider (ConsoleEmailProvider in dev) | Logs to stdout                 | `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD` | SendGridEmailProvider, AwsSesProvider         |
| **Auth SSO**   | NoOpSSOProvider                                 | Returns "not configured"       | None                                             | OidcAuthProvider, LdapAuthProvider            |
| **Monitoring** | ConsoleMonitoringProvider                       | JSON logs to stdout            | `LOG_LEVEL`                                      | OtelMonitoringProvider, AzureInsightsProvider |
| **CDN**        | DirectServeCDNProvider                          | Returns app API URL            | `SIGNED_URL_EXPIRY_SECONDS`                      | CloudFrontCdnProvider, AzureCdnProvider       |
| **Jobs**       | BullMqJobProvider                               | Uses Redis from docker-compose | `REDIS_URL`                                      | InProcessJobProvider (fallback only)          |
| **Cache**      | RedisCacheProvider                              | Uses Redis from docker-compose | `REDIS_URL, CACHE_KEY_PREFIX`                    | InMemoryCacheProvider (fallback)              |
| **Preview**    | GotenbergPreviewProvider                        | Converts via Gotenberg service | `GOTENBERG_URL, OCR_LANGUAGE`                    | LibreOfficePreviewProvider                    |
| **Scan**       | ClamAVScanProvider                              | Scans via ClamAV daemon        | `CLAMAV_HOST, CLAMAV_PORT`                       | None (ClamAV only open-source option)         |
| **Search**     | PostgresFtsSearchProvider                       | Indexes in PostgreSQL FTS      | Uses DATABASE_URL                                | MeilisearchProvider, OpenSearchProvider       |
| **Encryption** | NoOpEncryptionProvider                          | No encryption (plaintext)      | None                                             | AesEncryptionProvider (V1)                    |
| **AI**         | NoOpAIProvider                                  | Returns "not configured"       | None                                             | OpenAiProvider, AnthropicProvider             |
| **Signature**  | NoOpSignatureProvider                           | Returns "not configured"       | None                                             | BuiltInSignatureProvider, DocusignProvider    |

---

## Provider Error Types

All providers should throw typed errors for better error handling:

```typescript
// src/lib/providers/errors.ts

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

export class PreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewError';
  }
}

export class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanError';
  }
}

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchError';
  }
}

export class CacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheError';
  }
}

export class JobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobError';
  }
}

export class AuthNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthNotConfiguredError';
  }
}

export class AINotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AINotConfiguredError';
  }
}

export class SignatureNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureNotConfiguredError';
  }
}
```

---

## Development Startup

**docker-compose.yml** includes all necessary services:

```yaml
version: '3.8'

services:
  # Main application
  app:
    build: .
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://vaultspace:password@postgres:5432/vaultspace
      - REDIS_URL=redis://redis:6379
      - STORAGE_PROVIDER=local
      - STORAGE_LOCAL_PATH=/data/storage
      - EMAIL_PROVIDER=console
      - SMTP_FROM=noreply@vaultspace.local
      - GOTENBERG_URL=http://gotenberg:3000
      - CLAMAV_HOST=clamav
      - CLAMAV_PORT=3310
    ports:
      - '3000:3000'
    depends_on:
      - postgres
      - redis
      - gotenberg
      - clamav

  # PostgreSQL database
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: vaultspace
      POSTGRES_USER: vaultspace
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - '5432:5432'

  # Redis (for jobs, cache, sessions)
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'

  # Gotenberg (document preview conversion)
  gotenberg:
    image: gotenberg/gotenberg:7
    ports:
      - '3000:3000'

  # ClamAV (virus scanning)
  clamav:
    image: clamav/clamav:latest
    ports:
      - '3310:3310'
    environment:
      - FRESHCLAM_CHECKS=1

volumes:
  postgres_data:
```

**Start all services:**

```bash
docker compose up
```

**In another terminal, start the app:**

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

**Start background workers:**

```bash
# Terminal 3
npm run worker

# Or specific queues
npm run worker -- --queue=preview
npm run worker -- --queue=scan
npm run worker -- --queue=general
```

**View console logs:**

```bash
# Watch email logs
tail -f docker-compose logs app | grep EMAIL

# Watch preview jobs
tail -f docker-compose logs app | grep PREVIEW

# Watch scan jobs
tail -f docker-compose logs app | grep SCAN
```

---

## Testing Providers

Each provider should include unit tests:

```typescript
// src/providers/__tests__/local-storage-provider.test.ts

import { LocalStorageProvider } from '../storage/local-storage-provider';
import fs from 'fs';
import path from 'path';

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;
  const testDir = './test-storage';

  beforeEach(() => {
    provider = new LocalStorageProvider({ basePath: testDir });
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('uploadFile stores file atomically', async () => {
    const buffer = Buffer.from('test content');
    const result = await provider.uploadFile('test.txt', buffer);

    expect(result.key).toBe('test.txt');
    expect(result.size).toBe(12);
    expect(fs.existsSync(path.join(testDir, 'test.txt'))).toBe(true);
  });

  test('downloadFile retrieves file', async () => {
    const buffer = Buffer.from('test content');
    await provider.uploadFile('test.txt', buffer);

    const downloaded = await provider.downloadFile('test.txt');
    expect(downloaded).toEqual(buffer);
  });

  test('deleteFile removes file', async () => {
    const buffer = Buffer.from('test content');
    await provider.uploadFile('test.txt', buffer);

    await provider.deleteFile('test.txt');
    expect(fs.existsSync(path.join(testDir, 'test.txt'))).toBe(false);
  });

  test('getSignedUrl returns API endpoint', async () => {
    const url = await provider.getSignedUrl('test.txt', 300);
    expect(url).toMatch(/^\/api\/storage\//);
  });

  test('exists checks file existence', async () => {
    const buffer = Buffer.from('test content');
    await provider.uploadFile('test.txt', buffer);

    expect(await provider.exists('test.txt')).toBe(true);
    expect(await provider.exists('nonexistent.txt')).toBe(false);
  });

  test('copyFile duplicates file', async () => {
    const buffer = Buffer.from('test content');
    await provider.uploadFile('test.txt', buffer);

    await provider.copyFile('test.txt', 'test-copy.txt');
    const copied = await provider.downloadFile('test-copy.txt');
    expect(copied).toEqual(buffer);
  });
});
```

---

## Conclusion

This specification provides:

1. **Interface contracts** for all 13 providers (TypeScript)
2. **MVP implementations** with behavior details
3. **Environment variables** for configuration
4. **Error handling** strategies
5. **Dev vs. production** behavior differences
6. **V1+ alternatives** for each provider
7. **Factory pattern** for provider instantiation
8. **Provider matrix** for quick reference
9. **Testing examples** for validation

All providers are designed to:

- Be **cloud-agnostic** (run on-premises or any cloud)
- Support **multi-tenancy** (organization-scoped)
- Be **stateless** (enabled by Redis/PostgreSQL)
- Follow **dependency injection** pattern (injected into CoreServiceContext)
- Provide **clear error handling** (typed errors)
- Enable **testing** (mockable interfaces)
