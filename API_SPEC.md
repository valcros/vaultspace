# VaultSpace REST API Specification v1.0

**Document Status:** MVP + V1 Reference Specification
**Last Updated:** 2026-03-14
**Version:** 1.0

> **Scope note:** This document covers MVP endpoints (used during MVP build) and V1 reference endpoints (marked with `[V1]`). During MVP, implement ONLY endpoints not tagged `[V1]`.

---

## Table of Contents

1. [API Conventions](#api-conventions)
2. [Error Handling](#error-handling)
3. [Rate Limiting](#rate-limiting)
4. [Authentication & Authorization](#authentication--authorization)
5. [Endpoint Groups](#endpoint-groups)
   - [Auth Endpoints](#auth-endpoints)
   - [Rooms Endpoints](#rooms-endpoints)
   - [Documents Endpoints](#documents-endpoints)
   - [Folders Endpoints](#folders-endpoints)
   - [Links Endpoints](#links-endpoints)
   - [Users & Teams Endpoints](#users--teams-endpoints)
   - [Groups Endpoints](#groups-endpoints)
   - [Permissions Endpoints](#permissions-endpoints)
   - [Activity/Audit Endpoints](#activityaudit-endpoints)
   - [Admin Endpoints](#admin-endpoints)
   - [Setup Endpoints](#setup-endpoints)
   - [Health Endpoints](#health-endpoints)
6. [Request/Response Examples](#requestresponse-examples)
7. [Webhook Events [V1]](#webhook-events-v1)

---

## API Conventions

### Base URL

All MVP endpoints are prefixed with `/api/`. Example: `POST /api/auth/login`

> MVP routes use `/api/*` with no version prefix. The versioned `/api/v1/*` prefix is reserved for V1 (public API with API keys).

### Content-Type

- **Request:** `application/json` for all endpoints except file uploads, which use `multipart/form-data`
- **Response:** Always `application/json`

### Authentication

- **Method:** Session token stored in HttpOnly, Secure, SameSite=Lax cookie named `vaultspace-session`
- **Unauthenticated Requests:** Return `401 Unauthorized` with error response
- **Tenant Scoping:** Organization context is extracted from the session token; never from request parameters or headers
- **Cookie Handling:** Automatically set on login and cleared on logout; frontend must not manually manage this cookie

### Tenant Scoping

- Every database query is implicitly scoped to the authenticated user's `organizationId` from their session
- Request paths never include organization context; it is derived from the authenticated session
- Cross-organization access attempts return `404 Not Found` (not `403` Forbidden) to prevent organization existence disclosure

### Pagination

**Cursor-based pagination** for all list endpoints:

```typescript
// Request query parameters
cursor?: string              // Optional cursor token from previous response
limit?: number              // Default: 50, Max: 100
sort?: string               // Field name to sort by (default: createdAt)
order?: 'asc' | 'desc'      // Sort direction (default: desc)

// Response structure
{
  "data": [/* items */],
  "pagination": {
    "cursor": "abc123xyz",          // Next cursor token (null if no more items)
    "hasMore": boolean,             // true if more items exist
    "limit": number,
    "count": number                 // Items in this response
  }
}
```

### Filtering

**Query parameters per resource** (documented per endpoint):

```typescript
// Example for documents
GET /api/rooms/{roomId}/documents?status=active&createdAfter=2026-01-01
```

### Standard Response Format

**Success response (2xx):**

```typescript
{
  "data": {
    // Response body per endpoint spec
  },
  "meta": {
    "requestId": string,            // UUID for tracking
    "timestamp": string              // ISO 8601 timestamp
  }
}
```

**Error response (4xx/5xx):**

```typescript
{
  "error": {
    "code": string,                 // Machine-readable error code (e.g., "DOCUMENT_NOT_FOUND")
    "message": string,              // Human-readable error message
    "status": number,               // HTTP status code
    "requestId": string,            // UUID for support tracking
    "details": {                    // Optional; additional context
      [key: string]: any
    }
  }
}
```

### Standard Error Codes

| Code                    | Status | Description                                                       |
| ----------------------- | ------ | ----------------------------------------------------------------- |
| `INVALID_REQUEST`       | 400    | Malformed request body or missing required fields                 |
| `INVALID_INPUT`         | 400    | Input validation failed (e.g., invalid email format)              |
| `FILE_TOO_LARGE`        | 400    | Upload exceeds 500MB limit                                        |
| `UNSUPPORTED_FILE_TYPE` | 400    | Document format not supported                                     |
| `MALFORMED_JSON`        | 400    | Request body is not valid JSON                                    |
| `UNAUTHORIZED`          | 401    | Missing or invalid authentication token                           |
| `FORBIDDEN`             | 403    | Authenticated user lacks permission for this action               |
| `NOT_FOUND`             | 404    | Resource does not exist (includes cross-org access attempts)      |
| `CONFLICT`              | 409    | Resource already exists or state conflict (e.g., duplicate email) |
| `DUPLICATE_EMAIL`       | 409    | Email address is already registered                               |
| `INVALID_PASSWORD`      | 401    | Password does not match (login failure)                           |
| `EMAIL_NOT_VERIFIED`    | 403    | Email verification required before access                         |
| `ROOM_NOT_FOUND`        | 404    | Specified room does not exist                                     |
| `DOCUMENT_NOT_FOUND`    | 404    | Specified document does not exist                                 |
| `FOLDER_NOT_FOUND`      | 404    | Specified folder does not exist                                   |
| `LINK_NOT_FOUND`        | 404    | Specified share link does not exist                               |
| `LINK_EXPIRED`          | 410    | Share link has expired                                            |
| `LINK_ACCESS_DENIED`    | 403    | Access restrictions prevent viewing (password, IP, NDA)           |
| `USER_NOT_FOUND`        | 404    | Specified user does not exist                                     |
| `GROUP_NOT_FOUND`       | 404    | Specified group does not exist                                    |
| `PERMISSION_DENIED`     | 403    | User lacks required permission                                    |
| `RATE_LIMIT_EXCEEDED`   | 429    | Too many requests; see Retry-After header                         |
| `VIRUS_DETECTED`        | 400    | File failed malware scan; upload rejected                         |
| `PREVIEW_NOT_READY`     | 202    | Preview generation in progress; retry later                       |
| `INTERNAL_SERVER_ERROR` | 500    | Unexpected server error                                           |
| `SERVICE_UNAVAILABLE`   | 503    | Service temporarily unavailable                                   |
| `DATABASE_ERROR`        | 500    | Database operation failed                                         |
| `STORAGE_ERROR`         | 500    | Storage provider error                                            |
| `EMAIL_ERROR`           | 500    | Email service failed                                              |

---

## Rate Limiting

Rate limits are enforced per endpoint category. When limit is exceeded, response includes `Retry-After` header (seconds).

| Category                                         | Limit    | Scope             | Response          |
| ------------------------------------------------ | -------- | ----------------- | ----------------- |
| Auth endpoints (login, register, password reset) | 5/min    | Per email address | 429 + Retry-After |
| Auth endpoints                                   | 20/min   | Per IP address    | 429 + Retry-After |
| Document upload                                  | 10/min   | Per user          | 429 + Retry-After |
| General API calls                                | 100/min  | Per user          | 429 + Retry-After |
| General API calls                                | 1000/min | Per organization  | 429 + Retry-After |
| Public link access (viewer)                      | 30/min   | Per IP address    | 429 + Retry-After |

**Rate limit response:**

```typescript
HTTP/1.1 429 Too Many Requests
Retry-After: 45

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please wait before trying again.",
    "status": 429,
    "requestId": "req_xyz789"
  }
}
```

---

## Authentication & Authorization

### Login Flow

1. Client calls `POST /api/auth/login` with email and password
2. Server validates credentials, creates session
3. Server returns session cookie (HttpOnly, Secure, SameSite=Lax)
4. Client is now authenticated; all subsequent requests automatically include cookie
5. Frontend can call `GET /api/auth/session` to verify authentication

### Logout Flow

1. Client calls `POST /api/auth/logout`
2. Server invalidates session
3. Server clears session cookie
4. Client is no longer authenticated

### Permission Checks

All endpoints that access tenant-scoped resources (rooms, documents, etc.) perform:

1. **Authentication check:** Verify session token is valid
2. **Organization membership:** Verify user belongs to the organization
3. **Resource access:** Use PermissionEngine to check if user has required permission
4. **Operation check:** Verify the requested action is allowed for that resource

Invalid permission checks return `404 Not Found` (not `403 Forbidden`) to prevent existence disclosure.

---

## Endpoint Groups

### Auth Endpoints

#### 1. Register User

**POST** `/api/auth/register`

**Description:** Create a new user account. Email must be unique per organization (on-premise) or globally (future SaaS).

**Request:**

```typescript
{
  "email": string,          // Valid email address
  "password": string,       // Min 12 chars, must include uppercase, lowercase, number, symbol
  "organizationName"?: string  // For first user; if omitted uses default org (self-hosted)
  "firstName"?: string,     // Optional
  "lastName"?: string       // Optional
}
```

**Response (201):**

```typescript
{
  "data": {
    "userId": string,       // UUID
    "email": string,
    "firstName": string | null,
    "lastName": string | null,
    "organizationId": string,
    "role": "Owner",        // First user is Owner
    "emailVerified": false,
    "createdAt": string     // ISO 8601
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `INVALID_INPUT`, `DUPLICATE_EMAIL`, `MALFORMED_JSON`, `RATE_LIMIT_EXCEEDED`

**Feature ID:** F105 (Session Management), F016 (Email Verification)
**Permission:** None (unauthenticated)

---

#### 2. Login

**POST** `/api/auth/login`

**Description:** Authenticate with email and password. Sets HttpOnly session cookie.

**Request:**

```typescript
{
  "email": string,
  "password": string
}
```

**Response (200):**

```typescript
{
  "data": {
    "userId": string,
    "email": string,
    "organizationId": string,
    "role": "Owner" | "Admin" | "Member",
    "emailVerified": boolean
  },
  "meta": { "requestId": string, "timestamp": string }
}
// + Sets cookie: vaultspace-session=...; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400
```

**Error Codes:** `INVALID_PASSWORD`, `INVALID_INPUT`, `RATE_LIMIT_EXCEEDED`, `EMAIL_NOT_VERIFIED`

**Feature ID:** F105 (Session Management)
**Permission:** None (unauthenticated)

---

#### 3. Logout

**POST** `/api/auth/logout`

**Description:** Invalidate session and clear session cookie.

**Request:** None (body empty)

**Response (200):**

```typescript
{
  "data": { "success": true },
  "meta": { "requestId": string, "timestamp": string }
}
// + Clears cookie: vaultspace-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0
```

**Error Codes:** None

**Feature ID:** F105 (Session Management)
**Permission:** Authenticated user

---

#### 4. Get Session

**GET** `/api/auth/session`

**Description:** Retrieve current session details. Useful for frontend to verify login state.

**Request:** None

**Response (200):**

```typescript
{
  "data": {
    "userId": string,
    "email": string,
    "organizationId": string,
    "role": "Owner" | "Admin" | "Member",
    "firstName": string | null,
    "lastName": string | null,
    "emailVerified": boolean,
    "createdAt": string,
    "expiresAt": string     // When session cookie expires
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `UNAUTHORIZED`

**Feature ID:** F105 (Session Management)
**Permission:** Authenticated user

---

#### 5. Verify Email

**POST** `/api/auth/verify-email`

**Description:** Verify email address using token sent in email.

**Request:**

```typescript
{
  "token": string  // Token from email link
}
```

**Response (200):**

```typescript
{
  "data": {
    "emailVerified": true,
    "email": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `INVALID_INPUT`, `NOT_FOUND`

**Feature ID:** F016 (Email Verification)
**Permission:** None (unauthenticated; token embedded in link)

---

#### 6. Forgot Password

**POST** `/api/auth/forgot-password`

**Description:** Request password reset token (sent via email).

**Request:**

```typescript
{
  "email": string
}
```

**Response (200):**

```typescript
{
  "data": {
    "success": true,
    "message": "Password reset email sent to [email]"
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Note:** Returns 200 even if email doesn't exist (for security; no enumeration).

**Error Codes:** `INVALID_INPUT`, `RATE_LIMIT_EXCEEDED`

**Feature ID:** F016 (Email Verification)
**Permission:** None (unauthenticated)

---

#### 7. Reset Password

**POST** `/api/auth/reset-password`

**Description:** Reset password using token from forgot-password email.

**Request:**

```typescript
{
  "token": string,  // From email
  "password": string  // New password (12+ chars, complexity rules)
}
```

**Response (200):**

```typescript
{
  "data": {
    "success": true,
    "message": "Password reset successful. Please log in."
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `INVALID_INPUT`, `NOT_FOUND`

**Feature ID:** F016 (Email Verification)
**Permission:** None (unauthenticated; token embedded in link)

---

### Rooms Endpoints

#### 1. List Rooms

**GET** `/api/rooms`

**Description:** List all rooms in the organization. Scoped to authenticated user's organization.

**Query Parameters:**

```typescript
cursor?: string         // Pagination cursor
limit?: number         // 1-100, default 50
sort?: string          // 'name', 'createdAt', 'updatedAt', 'status' (default: 'updatedAt')
order?: 'asc' | 'desc' // Sort direction (default: 'desc')
status?: string        // Filter: 'draft', 'active', 'archived', 'closed'
templateType?: string  // Filter: 'investor', 'ma', 'board', 'compliance', 'custom'
```

**Response (200):**

```typescript
{
  "data": [
    {
      "roomId": string,
      "name": string,
      "description": string | null,
      "organizationId": string,
      "status": "draft" | "active" | "archived" | "closed",
      "templateType": "investor" | "ma" | "board" | "compliance" | "custom",
      "createdBy": string,          // userId
      "createdAt": string,
      "updatedAt": string,
      "memberCount": number,
      "documentCount": number,
      "isAdmin": boolean            // Does current user have Admin role in this room?
    }
  ],
  "pagination": {
    "cursor": string | null,
    "hasMore": boolean,
    "limit": number,
    "count": number
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `UNAUTHORIZED`

**Feature ID:** F108 (Room Lifecycle)
**Permission:** Member of organization

---

#### 2. Create Room

**POST** `/api/rooms`

**Description:** Create a new room with initial members and settings. User becomes Admin.

**Request:**

```typescript
{
  "name": string,                           // 1-255 chars, unique per org
  "description"?: string,                   // Optional description
  "templateType": "investor" | "ma" | "board" | "compliance" | "custom",  // F109
  "status"?: "draft" | "active",            // Default: draft
  "initialMembers"?: [                      // Optional; can be empty
    {
      "email": string,
      "role": "Admin" | "Viewer"            // Room-level role
    }
  ],
  "settings"?: {
    "passwordProtected"?: boolean,          // F017
    "password"?: string,                    // If passwordProtected=true
    "requireEmailVerification"?: boolean,   // F016, default: true
    "enableDownload"?: boolean,             // F014, default: true
    "enableNotifications"?: boolean,        // F003, default: true
    "expiresAt"?: string                    // ISO 8601 datetime, optional
  }
}
```

**Response (201):**

```typescript
{
  "data": {
    "roomId": string,
    "name": string,
    "description": string | null,
    "organizationId": string,
    "status": "draft" | "active",
    "templateType": string,
    "createdBy": string,
    "createdAt": string,
    "settings": {
      "passwordProtected": boolean,
      "requireEmailVerification": boolean,
      "enableDownload": boolean,
      "enableNotifications": boolean,
      "expiresAt": string | null
    },
    "members": [
      {
        "userId": string,
        "email": string,
        "role": "Admin" | "Viewer",
        "joinedAt": string
      }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `INVALID_INPUT`, `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F108 (Room Lifecycle), F109 (Room Templates), F017 (Password Protection)
**Permission:** Member of organization (can create rooms)

---

#### 3. Get Room

**GET** `/api/rooms/{roomId}`

**Description:** Retrieve room details, members, and settings.

**Path Parameters:**

```typescript
roomId: string; // UUID
```

**Response (200):**

```typescript
{
  "data": {
    "roomId": string,
    "name": string,
    "description": string | null,
    "organizationId": string,
    "status": "draft" | "active" | "archived" | "closed",
    "templateType": string,
    "createdBy": string,
    "createdAt": string,
    "updatedAt": string,
    "members": [
      {
        "userId": string,
        "email": string,
        "firstName": string | null,
        "lastName": string | null,
        "role": "Admin" | "Viewer",
        "joinedAt": string,
        "lastAccessAt": string | null
      }
    ],
    "documentCount": number,
    "folderCount": number,
    "settings": {
      "passwordProtected": boolean,
      "requireEmailVerification": boolean,
      "enableDownload": boolean,
      "enableNotifications": boolean,
      "expiresAt": string | null
    }
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F108 (Room Lifecycle)
**Permission:** Member of room (any role)

---

#### 4. Update Room

**PATCH** `/api/rooms/{roomId}`

**Description:** Update room metadata and settings.

**Path Parameters:**

```typescript
roomId: string; // UUID
```

**Request:**

```typescript
{
  "name"?: string,
  "description"?: string,
  "status"?: "draft" | "active" | "archived" | "closed",  // F108
  "settings"?: {
    "passwordProtected"?: boolean,
    "password"?: string,                    // New password if changing
    "requireEmailVerification"?: boolean,
    "enableDownload"?: boolean,
    "enableNotifications"?: boolean,
    "expiresAt"?: string | null
  }
}
```

**Response (200):**

```typescript
{
  "data": {
    "roomId": string,
    "name": string,
    "description": string | null,
    "status": "draft" | "active" | "archived" | "closed",
    "updatedAt": string,
    "settings": { /* updated settings */ }
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F108 (Room Lifecycle), F130 (Configurable Room Settings)
**Permission:** Admin of room

---

#### 5. Delete Room

**DELETE** `/api/rooms/{roomId}`

**Description:** Soft-delete room (move to trash; recoverable with restore endpoint or hard-delete after retention period).

**Path Parameters:**

```typescript
roomId: string; // UUID
```

**Query Parameters:**

```typescript
permanent?: boolean  // If true, permanently delete (bypass trash)
```

**Response (204):**

```
No content
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F114 (Trash/Soft Delete)
**Permission:** Admin of room

---

#### 6. Room Settings

**GET** `/api/rooms/{roomId}/settings`
**PATCH** `/api/rooms/{roomId}/settings`

**Description:** Get or update room-level settings (password, notifications, expiry, etc.).

**(GET) Response (200):**

```typescript
{
  "data": {
    "roomId": string,
    "passwordProtected": boolean,
    "requireEmailVerification": boolean,
    "enableDownload": boolean,
    "enableNotifications": boolean,
    "enableBranding": boolean,              // F033
    "brandLogo"?: string,                   // URL to logo
    "brandColors"?: {
      "primary": string,                    // Hex color
      "secondary": string
    },
    "expiresAt": string | null,
    "customDomain"?: string,                // F001
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**(PATCH) Request:**

```typescript
{
  "passwordProtected"?: boolean,
  "password"?: string,
  "requireEmailVerification"?: boolean,
  "enableDownload"?: boolean,
  "enableNotifications"?: boolean,
  "enableBranding"?: boolean,
  "brandLogo"?: string,                    // URL
  "brandColors"?: { "primary": string, "secondary": string },
  "expiresAt"?: string | null,
  "customDomain"?: string
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F130 (Configurable Room Settings), F033 (Branded Viewer), F001 (Custom Domain)
**Permission:** Admin of room (GET: Member of room)

---

#### 7. Room Members

**GET** `/api/rooms/{roomId}/members`

**Description:** List all members of a room with their roles and access info.

**Response (200):**

```typescript
{
  "data": [
    {
      "userId": string,
      "email": string,
      "firstName": string | null,
      "lastName": string | null,
      "role": "Admin" | "Viewer",
      "joinedAt": string,
      "lastAccessAt": string | null,
      "viewCount": number,
      "downloadCount": number
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": 100, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F044 (Team Member Invite)
**Permission:** Member of room

---

#### 8. Export Room

**POST** `/api/rooms/{roomId}/export`

**Description:** Export room as ZIP file (async job; returns immediately with job ID).

**Request:**

```typescript
{
  "includeAudit"?: boolean,  // Include audit log in export? Default: true
  "format": "zip" | "pdf"    // Zip (F113) or PDF export
}
```

**Response (202 Accepted):**

```typescript
{
  "data": {
    "exportId": string,       // Job ID for polling
    "status": "queued",       // or "processing", "completed", "failed"
    "progress": 0,            // 0-100%
    "downloadUrl"?: string    // Present when status="completed"
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F113 (Archive/Export Entire Room as ZIP)
**Permission:** Admin of room

---

### Documents Endpoints

#### 1. List Documents

**GET** `/api/rooms/{roomId}/documents`

**Description:** List documents in a room, optionally filtered by folder or status.

**Query Parameters:**

```typescript
cursor?: string              // Pagination cursor
limit?: number              // 1-100, default 50
folderId?: string           // Filter by folder
status?: string             // 'active', 'archived', 'deleted'
sort?: string               // 'name', 'createdAt', 'updatedAt', 'size'
order?: 'asc' | 'desc'
tags?: string[]             // Filter by tags (F110)
```

**Response (200):**

```typescript
{
  "data": [
    {
      "documentId": string,
      "roomId": string,
      "folderId": string | null,
      "name": string,
      "size": number,           // Bytes
      "mimeType": string,       // e.g., 'application/pdf'
      "status": "active" | "archived" | "deleted",
      "index": number,          // Auto-numbering (F010)
      "tags": string[],         // Custom tags (F110)
      "metadata": {
        [key: string]: string   // Custom metadata (F110)
      },
      "createdBy": string,      // userId
      "createdAt": string,
      "updatedAt": string,
      "currentVersionId": string,  // UUID of latest version
      "versionCount": number,
      "downloadEnabled": boolean,   // F014
      "previewStatus": "pending" | "processing" | "ready" | "failed",  // F101
      "hasPreview": boolean,
      "textExtracted": boolean,
      "virusScanStatus": "pending" | "passed" | "failed"  // F107
    }
  ],
  "pagination": { "cursor": string | null, "hasMore": boolean, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F002 (Version Control), F010 (Indexing), F110 (Tagging)
**Permission:** Member of room

---

#### 2. Upload Document

**POST** `/api/rooms/{roomId}/documents`

**Description:** Upload a single document or multiple files with folder preservation (multipart/form-data).

**Request (multipart/form-data):**

```typescript
{
  "file": File,                          // Required; max 500MB (F006)
  "folderId"?: string,                   // Target folder (creates path if needed)
  "tags"?: string,                       // Comma-separated or JSON array
  "metadata"?: object,                   // Custom metadata object (F110)
  "downloadEnabled"?: boolean            // Inherit from room if not specified
}
```

**Response (201):**

```typescript
{
  "data": {
    "documentId": string,
    "versionId": string,                 // Initial version
    "name": string,
    "size": number,
    "mimeType": string,
    "status": "active",
    "index": number,
    "createdAt": string,
    "previewStatus": "pending",          // Preview generation queued
    "virusScanStatus": "pending"         // Scan queued (F107)
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `RATE_LIMIT_EXCEEDED`, `VIRUS_DETECTED`

**Feature ID:** F006 (Bulk Upload), F007 (Drag-and-Drop), F009 (Multi-Format), F107 (Virus Scanning), F014 (Download Control)
**Permission:** Admin of room

---

#### 3. Get Document

**GET** `/api/rooms/{roomId}/documents/{documentId}`

**Description:** Retrieve document metadata and version info.

**Response (200):**

```typescript
{
  "data": {
    "documentId": string,
    "roomId": string,
    "folderId": string | null,
    "name": string,
    "size": number,
    "mimeType": string,
    "status": "active" | "archived" | "deleted",
    "index": number,
    "tags": string[],
    "metadata": { [key: string]: string },
    "createdBy": string,
    "createdAt": string,
    "updatedAt": string,
    "currentVersion": {
      "versionId": string,
      "number": number,
      "hash": string,                    // SHA-256 (F106)
      "createdAt": string,
      "createdBy": string,
      "changeNote"?: string              // For document updates
    },
    "downloadEnabled": boolean,
    "previewStatus": "pending" | "processing" | "ready" | "failed",
    "previewUrl"?: string,               // If ready and viewing allowed
    "textExtracted": boolean,
    "extractedText"?: string,            // First 5000 chars if extracted
    "virusScanStatus": "pending" | "passed" | "failed",
    "breadcrumbs": [                     // F124
      {
        "folderId": string | null,
        "name": string
      }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F002 (Version Control), F010 (Indexing), F124 (Breadcrumb Navigation)
**Permission:** Member of room (Viewer can view if download not restricted)

---

#### 4. Update Document

**PATCH** `/api/rooms/{roomId}/documents/{documentId}`

**Description:** Update document metadata (name, tags, metadata, status).

**Request:**

```typescript
{
  "name"?: string,
  "tags"?: string[],
  "metadata"?: { [key: string]: string },
  "status"?: "active" | "archived",
  "downloadEnabled"?: boolean,
  "folderId"?: string                    // Move to folder
}
```

**Response (200):**

```typescript
{
  "data": {
    "documentId": string,
    "name": string,
    "tags": string[],
    "metadata": { [key: string]: string },
    "status": "active" | "archived",
    "downloadEnabled": boolean,
    "folderId": string | null,
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F110 (Tagging and Metadata)
**Permission:** Admin of room

---

#### 5. Delete Document

**DELETE** `/api/rooms/{roomId}/documents/{documentId}`

**Description:** Soft-delete document (move to trash).

**Query Parameters:**

```typescript
permanent?: boolean  // If true, permanently delete; default: false
```

**Response (204):** No content

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F114 (Trash/Soft Delete)
**Permission:** Admin of room

---

#### 6. Download Document

**GET** `/api/rooms/{roomId}/documents/{documentId}/download`

**Description:** Download document file. Respects download permissions.

**Query Parameters:**

```typescript
versionId?: string  // Specific version; default: latest
```

**Response (200):**

```
Content-Type: [document MIME type]
Content-Disposition: attachment; filename="[name]"
Content-Length: [size]

[binary file content]
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `PERMISSION_DENIED`

**Feature ID:** F014 (Download Enable/Disable)
**Permission:** Member of room with download access

---

#### 7. Preview Document

**GET** `/api/rooms/{roomId}/documents/{documentId}/preview`

**Description:** Get document preview (in-browser viewer; uses PDF.js wrapper). Returns URL to preview assets.

**Query Parameters:**

```typescript
page?: number      // For multi-page documents; default: 1
width?: number     // Thumbnail width in pixels
height?: number    // Thumbnail height in pixels
```

**Response (200):**

```typescript
{
  "data": {
    "documentId": string,
    "status": "pending" | "processing" | "ready" | "failed",
    "previewUrl": string,                // Signed URL (F008, F033)
    "pdfUrl"?: string,                   // If PDF-native or converted
    "thumbnailUrl"?: string,             // Thumbnail image
    "pageCount"?: number,                // If multi-page
    "format": "pdf" | "image" | "native",
    "brandedLayout": boolean,            // Branded viewer enabled (F033)
    "watermark"?: string,                // If watermarking enabled (V1)
    "expiresAt": string                  // Signed URL expiry (5 min)
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `PREVIEW_NOT_READY`

**Feature ID:** F008 (In-Browser Viewer), F101 (Preview Pipeline), F033 (Branded Viewer)
**Permission:** Member of room

---

#### 8. Document Versions

**GET** `/api/rooms/{roomId}/documents/{documentId}/versions`

**Description:** List all versions of a document with hashes and metadata.

**Query Parameters:**

```typescript
cursor?: string
limit?: number  // Default: 50
```

**Response (200):**

```typescript
{
  "data": [
    {
      "versionId": string,
      "number": number,                  // 1, 2, 3, ...
      "hash": string,                    // SHA-256 (F106)
      "size": number,
      "createdBy": string,
      "createdAt": string,
      "changeNote"?: string,
      "previewStatus": "ready" | "pending" | "failed"
    }
  ],
  "pagination": { "cursor": string | null, "hasMore": boolean, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F002 (Version Control)
**Permission:** Member of room

---

#### 9. Move Document

**POST** `/api/rooms/{roomId}/documents/{documentId}/move`

**Description:** Move document to a different folder (or room, in bulk scenarios).

**Request:**

```typescript
{
  "folderId"?: string,     // Target folder (null = root)
  "roomId"?: string        // For future cross-room moves
}
```

**Response (200):**

```typescript
{
  "data": {
    "documentId": string,
    "folderId": string | null,
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F114 (Soft Delete context; folder moves)
**Permission:** Admin of room

---

#### 10. Restore Document

**POST** `/api/rooms/{roomId}/documents/{documentId}/archive`

**Description:** Archive or restore document from trash.

**Request:**

```typescript
{
  "action": "archive" | "restore",  // archive: soft-delete; restore: undelete
  "reason"?: string
}
```

**Response (200):**

```typescript
{
  "data": {
    "documentId": string,
    "status": "archived" | "active",
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F114 (Trash/Soft Delete)
**Permission:** Admin of room

---

### Folders Endpoints

#### 1. List Folders

**GET** `/api/rooms/{roomId}/folders`

**Description:** List folders in a room, optionally filtered by parent folder.

**Query Parameters:**

```typescript
cursor?: string
limit?: number
parentFolderId?: string  // Root if omitted
sort?: string            // 'name', 'createdAt'
order?: 'asc' | 'desc'
```

**Response (200):**

```typescript
{
  "data": [
    {
      "folderId": string,
      "roomId": string,
      "parentFolderId": string | null,
      "name": string,
      "createdBy": string,
      "createdAt": string,
      "updatedAt": string,
      "documentCount": number,
      "subfolderCount": number,
      "breadcrumbs": [
        { "folderId": string | null, "name": string }
      ]
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F124 (Breadcrumb Navigation)
**Permission:** Member of room

---

#### 2. Create Folder

**POST** `/api/rooms/{roomId}/folders`

**Description:** Create a new folder.

**Request:**

```typescript
{
  "name": string,              // 1-255 chars
  "parentFolderId"?: string,   // Parent folder ID (null = root)
  "description"?: string
}
```

**Response (201):**

```typescript
{
  "data": {
    "folderId": string,
    "roomId": string,
    "parentFolderId": string | null,
    "name": string,
    "createdAt": string,
    "breadcrumbs": [
      { "folderId": string | null, "name": string }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`, `CONFLICT`

**Feature ID:** F010 (Indexing; folder structure)
**Permission:** Admin of room

---

#### 3. Get Folder

**GET** `/api/rooms/{roomId}/folders/{folderId}`

**Description:** Retrieve folder details and contents (documents and subfolders).

**Response (200):**

```typescript
{
  "data": {
    "folderId": string,
    "roomId": string,
    "parentFolderId": string | null,
    "name": string,
    "createdBy": string,
    "createdAt": string,
    "updatedAt": string,
    "breadcrumbs": [
      { "folderId": string | null, "name": string }
    ],
    "documents": [
      {
        "documentId": string,
        "name": string,
        "size": number,
        "index": number,
        "status": "active" | "archived" | "deleted"
      }
    ],
    "subfolders": [
      {
        "folderId": string,
        "name": string,
        "documentCount": number,
        "subfolderCount": number
      }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F124 (Breadcrumb Navigation)
**Permission:** Member of room

---

#### 4. Update Folder

**PATCH** `/api/rooms/{roomId}/folders/{folderId}`

**Description:** Rename folder or move to different parent.

**Request:**

```typescript
{
  "name"?: string,
  "parentFolderId"?: string | null,  // null = root
  "description"?: string
}
```

**Response (200):**

```typescript
{
  "data": {
    "folderId": string,
    "name": string,
    "parentFolderId": string | null,
    "updatedAt": string,
    "breadcrumbs": [
      { "folderId": string | null, "name": string }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`, `CONFLICT`

**Feature ID:** F124 (Breadcrumb Navigation)
**Permission:** Admin of room

---

#### 5. Delete Folder

**DELETE** `/api/rooms/{roomId}/folders/{folderId}`

**Description:** Soft-delete folder (and all contents).

**Query Parameters:**

```typescript
permanent?: boolean  // If true, hard delete
```

**Response (204):** No content

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F114 (Trash/Soft Delete)
**Permission:** Admin of room

---

#### 6. Move Folder

**POST** `/api/rooms/{roomId}/folders/{folderId}/move`

**Description:** Move folder to a different parent.

**Request:**

```typescript
{
  "parentFolderId"?: string | null  // null = root
}
```

**Response (200):**

```typescript
{
  "data": {
    "folderId": string,
    "parentFolderId": string | null,
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F114 (Soft Delete context)
**Permission:** Admin of room

---

### Links Endpoints

#### 1. List Links

**GET** `/api/rooms/{roomId}/links`

**Description:** List all share links for a room.

**Query Parameters:**

```typescript
cursor?: string
limit?: number
status?: string  // 'active', 'expired'
scope?: string   // 'room', 'folder', 'document'
```

**Response (200):**

```typescript
{
  "data": [
    {
      "linkId": string,
      "code": string,                    // Unique share code
      "roomId": string,
      "folderId"?: string,
      "documentId"?: string,
      "scope": "room" | "folder" | "document",
      "createdBy": string,
      "createdAt": string,
      "expiresAt": string | null,        // F116
      "passwordProtected": boolean,      // F017
      "requireEmailVerification": boolean,  // F016
      "accessCount": number,
      "status": "active" | "expired",
      "permissions": {
        "canView": boolean,
        "canDownload": boolean,
        "canPrint": boolean               // V1+
      },
      "ipAllowlist"?: string[],          // V1+
      "ipBlocklist"?: string[]           // V1+
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F116 (Granular Link Permissions)
**Permission:** Admin of room

---

#### 2. Create Link

**POST** `/api/rooms/{roomId}/links`

**Description:** Create a new share link for room, folder, or document.

**Request:**

```typescript
{
  "scope": "room" | "folder" | "document",
  "targetId"?: string,                 // folderId or documentId if scope != 'room'
  "expiresAt"?: string,                // ISO 8601 datetime (F116)
  "passwordProtected"?: boolean,       // F017
  "password"?: string,                 // If passwordProtected=true
  "requireEmailVerification"?: boolean,  // F016
  "permissions": {
    "canView": boolean,
    "canDownload"?: boolean,           // Default: true
    "canPrint"?: boolean               // V1+
  },
  "ipAllowlist"?: string[],            // V1+
  "ipBlocklist"?: string[],            // V1+
  "customMessage"?: string             // Message shown to link users
}
```

**Response (201):**

```typescript
{
  "data": {
    "linkId": string,
    "code": string,                    // Short alphanumeric code
    "url": string,                     // Full share URL (public)
    "roomId": string,
    "folderId"?: string,
    "documentId"?: string,
    "scope": "room" | "folder" | "document",
    "createdAt": string,
    "expiresAt": string | null,
    "passwordProtected": boolean,
    "permissions": {
      "canView": boolean,
      "canDownload": boolean
    }
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F035 (No Account Required), F116 (Granular Link Permissions), F017 (Password Protection), F016 (Email Verification)
**Permission:** Admin of room

---

#### 3. Get Link

**GET** `/api/rooms/{roomId}/links/{linkId}`

**Description:** Retrieve link details.

**Response (200):**

```typescript
{
  "data": {
    "linkId": string,
    "code": string,
    "url": string,
    "scope": "room" | "folder" | "document",
    "createdBy": string,
    "createdAt": string,
    "expiresAt": string | null,
    "passwordProtected": boolean,
    "requireEmailVerification": boolean,
    "accessCount": number,
    "lastAccessAt": string | null,
    "permissions": {
      "canView": boolean,
      "canDownload": boolean
    },
    "customMessage"?: string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F116 (Granular Link Permissions)
**Permission:** Admin of room

---

#### 4. Update Link

**PATCH** `/api/rooms/{roomId}/links/{linkId}`

**Description:** Update link settings (expiry, password, permissions).

**Request:**

```typescript
{
  "expiresAt"?: string | null,
  "passwordProtected"?: boolean,
  "password"?: string,                 // New password
  "requireEmailVerification"?: boolean,
  "permissions"?: {
    "canView"?: boolean,
    "canDownload"?: boolean
  },
  "ipAllowlist"?: string[],
  "ipBlocklist"?: string[],
  "customMessage"?: string
}
```

**Response (200):**

```typescript
{
  "data": {
    "linkId": string,
    "expiresAt": string | null,
    "passwordProtected": boolean,
    "permissions": {
      "canView": boolean,
      "canDownload": boolean
    },
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F116 (Granular Link Permissions)
**Permission:** Admin of room

---

#### 5. Delete Link

**DELETE** `/api/rooms/{roomId}/links/{linkId}`

**Description:** Revoke a share link (disable access immediately).

**Response (204):** No content

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F116 (Granular Link Permissions)
**Permission:** Admin of room

---

#### 6. Access Link (Public Viewer Entry Point)

**GET** `/api/links/{code}`

**Description:** **PUBLIC ENDPOINT** - Access a shared room/folder/document via link code. No authentication required. Returns viewer credentials or redirects with token.

**Query Parameters:**

```typescript
password?: string  // If link passwordProtected
email?: string     // For email verification links
token?: string     // Email verification token
```

**Response (200):**

```typescript
{
  "data": {
    "linkId": string,
    "code": string,
    "scope": "room" | "folder" | "document",
    "resourceName": string,            // Room/folder/document name
    "permissions": {
      "canView": boolean,
      "canDownload": boolean
    },
    "viewerToken": string,             // Temporary token for viewer
    "viewerTokenExpiresAt": string,    // 24 hours from now
    "brandedSettings": {
      "brandLogo"?: string,
      "brandColors"?: { "primary": string, "secondary": string },
      "customMessage"?: string
    },
    "passwordProtected": boolean,
    "requiresEmailVerification": boolean,
    "unverifiedEmail"?: string         // If email provided but not verified
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `LINK_EXPIRED`, `LINK_ACCESS_DENIED`, `INVALID_INPUT`

**Feature ID:** F035 (No Account Required), F033 (Branded Viewer), F016 (Email Verification), F017 (Password Protection)
**Permission:** None (public)

---

### Users & Teams Endpoints

#### 1. List Users

**GET** `/api/users`

**Description:** List all users in the organization.

**Query Parameters:**

```typescript
cursor?: string
limit?: number
role?: string      // 'Owner', 'Admin', 'Member'
sort?: string      // 'email', 'createdAt'
order?: 'asc' | 'desc'
```

**Response (200):**

```typescript
{
  "data": [
    {
      "userId": string,
      "email": string,
      "firstName": string | null,
      "lastName": string | null,
      "role": "Owner" | "Admin" | "Member",
      "emailVerified": boolean,
      "createdAt": string,
      "lastLoginAt": string | null,
      "roomCount": number,
      "status": "active" | "inactive"
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F044 (Team Member Invite)
**Permission:** Owner or Admin of organization

---

#### 2. Invite User

**POST** `/api/users/invite`

**Description:** Invite a user to the organization.

**Request:**

```typescript
{
  "email": string,
  "role": "Admin" | "Member",        // Organization-level role
  "firstName"?: string,
  "lastName"?: string,
  "roomIds"?: string[]               // Optional initial room assignments
}
```

**Response (201):**

```typescript
{
  "data": {
    "invitationId": string,
    "email": string,
    "role": "Admin" | "Member",
    "invitedAt": string,
    "expiresAt": string,              // Invitation valid for 7 days
    "invitedBy": string,              // userId
    "status": "pending"
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `INVALID_INPUT`, `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMIT_EXCEEDED`

**Feature ID:** F044 (Team Member Invite)
**Permission:** Owner of organization

---

#### 3. Get User

**GET** `/api/users/{userId}`

**Description:** Get user profile (public info within organization).

**Response (200):**

```typescript
{
  "data": {
    "userId": string,
    "email": string,
    "firstName": string | null,
    "lastName": string | null,
    "organizationId": string,
    "role": "Owner" | "Admin" | "Member",
    "emailVerified": boolean,
    "createdAt": string,
    "lastLoginAt": string | null,
    "avatar"?: string,                // URL to avatar image (future feature)
    "notificationPreferences": {
      "emailOnDocumentView": boolean,
      "emailOnDocumentUpdate": boolean,
      "emailOnMemberJoin": boolean
    }
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F044 (Team Member Invite)
**Permission:** Member of organization (can view own profile; Owners can view all)

---

#### 4. Update User

**PATCH** `/api/users/{userId}`

**Description:** Update user profile or organization role (Owners only).

**Request:**

```typescript
{
  "firstName"?: string,
  "lastName"?: string,
  "role"?: "Admin" | "Member",        // Organization-level (Owners only)
  "notificationPreferences"?: {
    "emailOnDocumentView"?: boolean,
    "emailOnDocumentUpdate"?: boolean,
    "emailOnMemberJoin"?: boolean
  }
}
```

**Response (200):**

```typescript
{
  "data": {
    "userId": string,
    "email": string,
    "firstName": string | null,
    "lastName": string | null,
    "role": "Owner" | "Admin" | "Member",
    "updatedAt": string,
    "notificationPreferences": {
      "emailOnDocumentView": boolean,
      "emailOnDocumentUpdate": boolean,
      "emailOnMemberJoin": boolean
    }
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F043 (Notification Preferences), F044 (Team Member Invite)
**Permission:** Self (can update own profile); Owner (can update others' org roles)

---

#### 5. Remove User

**DELETE** `/api/users/{userId}`

**Description:** Remove user from organization (Owner only).

**Response (204):** No content

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F044 (Team Member Invite)
**Permission:** Owner of organization

---

#### 6. User Groups

**GET** `/api/users/{userId}/groups`

**Description:** List all groups a user is a member of.

**Query Parameters:**

```typescript
cursor?: string
limit?: number
```

**Response (200):**

```typescript
{
  "data": [
    {
      "groupId": string,
      "name": string,
      "memberCount": number,
      "createdAt": string
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F020 (User Group Management)
**Permission:** Self or Owner/Admin of organization

---

### Groups Endpoints

#### 1. List Groups

**GET** `/api/groups`

**Description:** List all user groups in the organization.

**Query Parameters:**

```typescript
cursor?: string
limit?: number
sort?: string   // 'name', 'createdAt'
order?: 'asc' | 'desc'
```

**Response (200):**

```typescript
{
  "data": [
    {
      "groupId": string,
      "name": string,
      "description": string | null,
      "createdBy": string,
      "createdAt": string,
      "memberCount": number,
      "permissionCount": number  // Number of ACLs using this group
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F020 (User Group Management)
**Permission:** Admin of organization

---

#### 2. Create Group

**POST** `/api/groups`

**Description:** Create a new user group.

**Request:**

```typescript
{
  "name": string,              // 1-255 chars, unique per org
  "description"?: string,
  "memberIds"?: string[]       // Initial members (userIds)
}
```

**Response (201):**

```typescript
{
  "data": {
    "groupId": string,
    "name": string,
    "description": string | null,
    "createdAt": string,
    "members": [
      {
        "userId": string,
        "email": string,
        "firstName": string | null,
        "lastName": string | null
      }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `INVALID_INPUT`, `CONFLICT`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F020 (User Group Management)
**Permission:** Admin of organization

---

#### 3. Update Group

**PATCH** `/api/groups/{groupId}`

**Description:** Update group name or description.

**Request:**

```typescript
{
  "name"?: string,
  "description"?: string | null
}
```

**Response (200):**

```typescript
{
  "data": {
    "groupId": string,
    "name": string,
    "description": string | null,
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`, `CONFLICT`

**Feature ID:** F020 (User Group Management)
**Permission:** Admin of organization

---

#### 4. Delete Group

**DELETE** `/api/groups/{groupId}`

**Description:** Delete a user group (does not delete members, only removes group).

**Response (204):** No content

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F020 (User Group Management)
**Permission:** Admin of organization

---

#### 5. Group Members

**GET** `/api/groups/{groupId}/members`
**POST** `/api/groups/{groupId}/members` (add member)
**DELETE** `/api/groups/{groupId}/members/{userId}` (remove member)

**Description:** Manage group membership.

**(GET) Response (200):**

```typescript
{
  "data": [
    {
      "userId": string,
      "email": string,
      "firstName": string | null,
      "lastName": string | null,
      "joinedAt": string
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**(POST) Request:**

```typescript
{
  "userIds": string[]  // Array of user IDs to add
}
```

**(DELETE) Response (204):** No content

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F020 (User Group Management)
**Permission:** Admin of organization

---

### Permissions Endpoints

#### 1. Get Permissions

**GET** `/api/permissions/{resourceType}/{resourceId}`

**Description:** Get effective permissions for a resource (room, folder, document).

**Path Parameters:**

```typescript
resourceType: 'room' | 'folder' | 'document';
resourceId: string; // UUID
```

**Query Parameters:**

```typescript
userId?: string     // Specific user; omit for current user
```

**Response (200):**

```typescript
{
  "data": {
    "resourceType": string,
    "resourceId": string,
    "userId": string,
    "permissions": {
      "canView": boolean,
      "canDownload": boolean,
      "canUpload": boolean,
      "canDelete": boolean,
      "canShare": boolean,
      "canManagePermissions": boolean
    },
    "source": "direct" | "group" | "inherited",  // How permission is granted
    "expiresAt": string | null
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F141 (Centralized Permission Engine)
**Permission:** Member of room (can check own permissions); Admin (can check others)

---

#### 2. Set Permissions

**POST** `/api/permissions/{resourceType}/{resourceId}`

**Description:** Grant or update permissions for a user or group on a resource.

**Path Parameters:**

```typescript
resourceType: 'room' | 'folder' | 'document';
resourceId: string;
```

**Request:**

```typescript
{
  "grantees": [
    {
      "type": "user" | "group",
      "id": string,                    // userId or groupId
      "permissions": {
        "canView": boolean,
        "canDownload": boolean,
        "canUpload"?: boolean,         // Folder/room only
        "canDelete"?: boolean,         // Folder/room only
        "canShare"?: boolean,
        "canManagePermissions"?: boolean  // Room Admins only
      },
      "expiresAt"?: string             // Optional permission expiry
    }
  ]
}
```

**Response (200):**

```typescript
{
  "data": {
    "resourceType": string,
    "resourceId": string,
    "grantees": [
      {
        "type": "user" | "group",
        "id": string,
        "permissions": { /* granted */ },
        "updatedAt": string
      }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F005 (Per-Document/Folder ACLs), F141 (PermissionEngine)
**Permission:** Admin of room (or parent room for folders/documents)

---

#### 3. Bulk Update Permissions

**POST** `/api/permissions/bulk-update`

**Description:** Update permissions for multiple resources in one request.

**Request:**

```typescript
{
  "updates": [
    {
      "resourceType": "room" | "folder" | "document",
      "resourceId": string,
      "grantees": [
        {
          "type": "user" | "group",
          "id": string,
          "permissions": { /* perms */ }
        }
      ]
    }
  ]
}
```

**Response (200):**

```typescript
{
  "data": {
    "updateCount": number,
    "results": [
      {
        "resourceId": string,
        "status": "success" | "failed",
        "error"?: string
      }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `INVALID_INPUT`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F005 (Per-Document/Folder ACLs)
**Permission:** Admin of room

---

#### 4. Explain Permissions

**GET** `/api/permissions/{resourceType}/{resourceId}/explain`

**Description:** Diagnostic endpoint: explain why a user has (or doesn't have) permission on a resource.

**Path Parameters:**

```typescript
resourceType: 'room' | 'folder' | 'document';
resourceId: string;
```

**Query Parameters:**

```typescript
userId: string; // User to diagnose
```

**Response (200):**

```typescript
{
  "data": {
    "resourceType": string,
    "resourceId": string,
    "userId": string,
    "hasAccess": boolean,
    "permissions": {
      "canView": { allowed: boolean, reason: string },
      "canDownload": { allowed: boolean, reason: string },
      "canUpload": { allowed: boolean, reason: string },
      "canDelete": { allowed: boolean, reason: string },
      "canShare": { allowed: boolean, reason: string }
    },
    "grantPath": [                      // Chain of permission grants
      {
        "type": "direct" | "group" | "inherited",
        "grantee": string,              // User name or group name
        "grantor": string,              // Who granted it
        "grantedAt": string
      }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F141 (PermissionEngine)
**Permission:** Admin of room

---

### Activity/Audit Endpoints

#### 1. List Events

**GET** `/api/audit/events`

**Description:** List audit events for organization (immutable event log).

**Query Parameters:**

```typescript
cursor?: string
limit?: number                    // Default: 50, Max: 100
roomId?: string                   // Filter by room
userId?: string                   // Filter by actor user
eventType?: string                // 'document.viewed', 'document.downloaded', 'permission.granted', etc.
startDate?: string                // ISO 8601 (filter by date range)
endDate?: string
sortBy?: 'timestamp'              // Default: 'timestamp'
order?: 'asc' | 'desc'
```

**Response (200):**

```typescript
{
  "data": [
    {
      "eventId": string,
      "eventType": string,
      "actor": {
        "userId": string,
        "email": string,
        "type": "user" | "system"
      },
      "resource": {
        "type": "room" | "document" | "folder" | "user" | "link",
        "id": string,
        "name": string
      },
      "action": string,             // e.g., "view", "download", "upload", "share"
      "details": { [key: string]: string },
      "timestamp": string,          // ISO 8601, immutable
      "ipAddress"?: string,
      "userAgent"?: string,
      "status": "success" | "failure"
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F025 (Audit Trail), F102 (Event Bus)
**Permission:** Admin of organization

---

#### 2. Dashboard Stats

**GET** `/api/audit/dashboard`

**Description:** High-level activity statistics for room activity dashboard.

**Query Parameters:**

```typescript
roomId?: string              // Single room; omit for org-wide
timeRange?: string           // '7d', '30d', '90d' (default: '7d')
```

**Response (200):**

```typescript
{
  "data": {
    "period": {
      "startDate": string,
      "endDate": string
    },
    "summary": {
      "totalViews": number,
      "totalDownloads": number,
      "totalUploads": number,
      "uniqueViewers": number,
      "newDocuments": number,
      "newMembers": number
    },
    "topDocuments": [           // Most viewed
      {
        "documentId": string,
        "name": string,
        "viewCount": number,
        "downloadCount": number
      }
    ],
    "activeUsers": [             // Most active users
      {
        "userId": string,
        "email": string,
        "firstName": string,
        "actionCount": number,
        "lastActionAt": string
      }
    ],
    "activityTrend": [          // Daily view/download counts
      {
        "date": string,          // YYYY-MM-DD
        "views": number,
        "downloads": number,
        "uploads": number
      }
    ]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F121 (Room Activity Dashboard)
**Permission:** Admin of room (if roomId specified); Admin of organization (if org-wide)

---

#### 3. Export Audit [V1]

**POST** `/api/audit/export`

**Description:** Export audit log as CSV (async job).

**Request:**

```typescript
{
  "roomId"?: string,
  "format": "csv" | "json",
  "includeDetails": boolean,        // Include full event details
  "startDate"?: string,
  "endDate"?: string
}
```

**Response (202 Accepted):**

```typescript
{
  "data": {
    "exportId": string,
    "status": "queued",
    "downloadUrl"?: string         // Present when ready
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F025 (Audit Trail)
**Permission:** Admin of organization

---

### Admin Endpoints

#### 1. Organization Settings

**GET** `/api/admin/settings`
**PATCH** `/api/admin/settings`

**Description:** Get or update organization-level settings.

**(GET) Response (200):**

```typescript
{
  "data": {
    "organizationId": string,
    "organizationName": string,
    "customDomain"?: string,               // F001
    "ssoEnabled": boolean,                 // V1+
    "ssoProvider"?: string,                // 'google', 'okta', etc.
    "passwordPolicy": {
      "minLength": number,
      "requireUppercase": boolean,
      "requireNumbers": boolean,
      "requireSymbols": boolean,
      "expiryDays": number | null
    },
    "sessionTimeout": number,              // Minutes
    "mfaRequired": boolean,                // V1+
    "twoFactorRequired": boolean,
    "gdprEnabled": boolean,                // F052
    "dataRetentionDays": number | null,
    "backupEnabled": boolean,              // F137
    "backupFrequency": string,             // 'daily', 'weekly'
    "createdAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**(PATCH) Request:**

```typescript
{
  "organizationName"?: string,
  "customDomain"?: string,
  "sessionTimeout"?: number,
  "passwordPolicy"?: {
    "minLength"?: number,
    "requireUppercase"?: boolean,
    "requireNumbers"?: boolean,
    "requireSymbols"?: boolean
  },
  "dataRetentionDays"?: number | null,
  "backupFrequency"?: string
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F142 (Multi-Tenant Organization Model)
**Permission:** Owner of organization

---

#### 2. Branding

**GET** `/api/admin/branding`
**PATCH** `/api/admin/branding`

**Description:** Configure organization branding (logo, colors only; per MVP stakeholder decision).

**(GET) Response (200):**

```typescript
{
  "data": {
    "organizationId": string,
    "logoUrl"?: string,                    // F033
    "logoUploadedAt"?: string,
    "primaryColor": string,                // Hex color (default: #007bff)
    "secondaryColor": string,              // Hex color (default: #6c757d)
    "customMessage"?: string,              // Welcome message for viewers
    "applyToAllRooms": boolean,            // Apply to all rooms by default
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**(PATCH) Request (multipart/form-data):**

```typescript
{
  "logo"?: File,                           // PNG or SVG, max 2MB
  "primaryColor"?: string,                 // Hex format
  "secondaryColor"?: string,
  "customMessage"?: string,
  "applyToAllRooms"?: boolean
}
```

**Response (200):** (same as GET)

**Error Codes:** `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`

**Feature ID:** F033 (Branded Viewer)
**Permission:** Owner of organization

---

#### 3. Notification Preferences

**GET** `/api/admin/notifications`
**PATCH** `/api/admin/notifications`

**Description:** Configure organization-level notification settings (F043).

**(GET) Response (200):**

```typescript
{
  "data": {
    "organizationId": string,
    "adminEmailNotifications": {
      "onDocumentView": boolean,
      "onDocumentDownload": boolean,
      "onDocumentUpload": boolean,
      "onMemberJoin": boolean,
      "onRoomCreated": boolean,
      "onUserInvite": boolean
    },
    "emailProvider": "smtp" | "sendgrid" | "azure",  // F059
    "emailFrom": string,
    "smtpConfig"?: {
      "host": string,
      "port": number,
      "useTls": boolean
    },
    "updatedAt": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**(PATCH) Request:**

```typescript
{
  "adminEmailNotifications"?: {
    "onDocumentView"?: boolean,
    "onDocumentDownload"?: boolean,
    "onDocumentUpload"?: boolean,
    "onMemberJoin"?: boolean,
    "onRoomCreated"?: boolean,
    "onUserInvite"?: boolean
  },
  "emailProvider"?: "smtp" | "sendgrid" | "azure",
  "emailFrom"?: string,
  "smtpConfig"?: {
    "host": string,
    "port": number,
    "useTls": boolean
    // Note: password NOT sent here; set in environment or admin panel separately
  }
}
```

**Error Codes:** `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`

**Feature ID:** F043 (Notification Preferences), F059 (SMTP-Agnostic Email)
**Permission:** Owner or Admin of organization

---

#### 4. Admin Activity Log

**GET** `/api/admin/log`

**Description:** Log of admin-only actions (user management, org settings changes).

**Query Parameters:**

```typescript
cursor?: string
limit?: number
actionType?: string  // 'user.invited', 'user.removed', 'settings.updated', etc.
adminId?: string     // Filter by admin user
```

**Response (200):**

```typescript
{
  "data": [
    {
      "eventId": string,
      "actionType": string,
      "admin": {
        "userId": string,
        "email": string
      },
      "target": string,                  // User email, setting name, etc.
      "details": { [key: string]: string },
      "timestamp": string,               // ISO 8601
      "ipAddress": string,
      "status": "success" | "failure"
    }
  ],
  "pagination": { "cursor": null, "hasMore": false, "limit": number, "count": number },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F040 (Admin Activity Log)
**Permission:** Owner or Admin of organization

---

#### 5. Force Logout User

**POST** `/api/admin/users/{userId}/force-logout`

**Description:** Invalidate all sessions for a user (security/offboarding).

**Request:** None

**Response (200):**

```typescript
{
  "data": {
    "userId": string,
    "sessionsTerminated": number,
    "timestamp": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`

**Feature ID:** F105 (Session Management)
**Permission:** Owner of organization

---

### Setup Endpoints

#### 1. Setup Wizard Status

**GET** `/api/setup/status`

**Description:** Check if organization setup is complete (first-run wizard).

**Response (200):**

```typescript
{
  "data": {
    "setupComplete": boolean,
    "steps": {
      "organization": { "completed": boolean, "timestamp"?: string },
      "admin": { "completed": boolean, "timestamp"?: string },
      "branding": { "completed": boolean, "timestamp"?: string },
      "emailConfig": { "completed": boolean, "timestamp"?: string },
      "demoData": { "completed": boolean, "timestamp"?: string }
    },
    "demoRoomId"?: string                 // If demo seed data (F143) loaded
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** None (always succeeds; returns current state)

**Feature ID:** F128 (Setup Wizard)
**Permission:** Owner of organization (first-run only)

---

#### 2. Complete Setup

**POST** `/api/setup/complete`

**Description:** Mark setup as complete and optionally load demo seed data (F143).

**Request:**

```typescript
{
  "organizationName": string,
  "adminEmail": string,
  "adminPassword": string,
  "brandLogo"?: string,                  // URL
  "primaryColor"?: string,
  "loadDemoData": boolean               // Load Series A Funding Room (F143)
}
```

**Response (200):**

```typescript
{
  "data": {
    "setupComplete": true,
    "organizationId": string,
    "demoRoomId"?: string,
    "demoRoomUrl"?: string,
    "timestamp": string
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** `INVALID_INPUT`, `CONFLICT`

**Feature ID:** F128 (Setup Wizard), F143 (Demo Seed Data)
**Permission:** None (first-run only; no auth required)

---

### Health Endpoints

#### 1. Health Check

**GET** `/api/health`

**Description:** Service health check with version and dependency status.

**Response (200):**

```typescript
{
  "data": {
    "status": "healthy" | "degraded" | "unhealthy",
    "version": string,                   // e.g., "1.0.0"
    "timestamp": string,
    "uptime": number,                    // Seconds
    "dependencies": {
      "database": {
        "status": "ok" | "error",
        "latency": number                // milliseconds
      },
      "redis": {
        "status": "ok" | "error" | "unavailable"
      },
      "storage": {
        "status": "ok" | "error"
      },
      "email": {
        "status": "ok" | "error" | "unconfigured"
      }
    },
    "warnings": [string]                 // e.g., ["Redis unavailable - caching disabled"]
  },
  "meta": { "requestId": string, "timestamp": string }
}
```

**Error Codes:** None (always returns; status indicates health)

**Feature ID:** F062 (Docker Deployment)
**Permission:** None (public endpoint)

---

## Request/Response Examples

### Example 1: Document Upload Flow

**Step 1: Create Room**

```bash
POST /api/rooms HTTP/1.1
Content-Type: application/json

{
  "name": "Series A Funding Room",
  "templateType": "investor",
  "status": "active",
  "settings": {
    "requireEmailVerification": true,
    "enableDownload": true
  }
}
```

**Response:**

```json
{
  "data": {
    "roomId": "room_abc123",
    "name": "Series A Funding Room",
    "status": "active",
    "templateType": "investor",
    "createdAt": "2026-03-14T10:00:00Z"
  },
  "meta": { "requestId": "req_xyz", "timestamp": "2026-03-14T10:00:01Z" }
}
```

**Step 2: Create Folder Structure**

```bash
POST /api/rooms/room_abc123/folders HTTP/1.1
Content-Type: application/json

{
  "name": "Financial Statements"
}
```

**Response:**

```json
{
  "data": {
    "folderId": "folder_def456",
    "name": "Financial Statements",
    "parentFolderId": null,
    "createdAt": "2026-03-14T10:01:00Z"
  },
  "meta": { "requestId": "req_uvw", "timestamp": "2026-03-14T10:01:01Z" }
}
```

**Step 3: Upload Document**

```bash
POST /api/rooms/room_abc123/documents HTTP/1.1
Content-Type: multipart/form-data

Content-Disposition: form-data; name="file"; filename="2026-financials.pdf"
Content-Type: application/pdf

[binary PDF data]

Content-Disposition: form-data; name="folderId"
folder_def456

Content-Disposition: form-data; name="tags"
financial,2026,audited
```

**Response (201):**

```json
{
  "data": {
    "documentId": "doc_ghi789",
    "versionId": "ver_jkl012",
    "name": "2026-financials.pdf",
    "size": 2048576,
    "previewStatus": "pending",
    "virusScanStatus": "pending",
    "createdAt": "2026-03-14T10:02:00Z"
  },
  "meta": { "requestId": "req_rst", "timestamp": "2026-03-14T10:02:01Z" }
}
```

---

### Example 2: Room Creation with Initial Members

```bash
POST /api/rooms HTTP/1.1
Content-Type: application/json

{
  "name": "Q1 2026 Board Retreat",
  "templateType": "board",
  "status": "draft",
  "initialMembers": [
    { "email": "alice@company.com", "role": "Admin" },
    { "email": "bob@company.com", "role": "Viewer" },
    { "email": "carol@company.com", "role": "Viewer" }
  ],
  "settings": {
    "passwordProtected": true,
    "password": "BoardPass2026!",
    "requireEmailVerification": true,
    "expiresAt": "2026-06-30T23:59:59Z"
  }
}
```

**Response (201):**

```json
{
  "data": {
    "roomId": "room_xyz789",
    "name": "Q1 2026 Board Retreat",
    "templateType": "board",
    "status": "draft",
    "members": [
      {
        "userId": "user_123",
        "email": "alice@company.com",
        "role": "Admin",
        "joinedAt": "2026-03-14T10:03:00Z"
      },
      {
        "userId": "user_124",
        "email": "bob@company.com",
        "role": "Viewer",
        "joinedAt": "2026-03-14T10:03:00Z"
      },
      {
        "userId": "user_125",
        "email": "carol@company.com",
        "role": "Viewer",
        "joinedAt": "2026-03-14T10:03:00Z"
      }
    ],
    "settings": {
      "passwordProtected": true,
      "requireEmailVerification": true,
      "expiresAt": "2026-06-30T23:59:59Z"
    }
  },
  "meta": { "requestId": "req_abc", "timestamp": "2026-03-14T10:03:01Z" }
}
```

---

### Example 3: Share Link Creation with Permissions

```bash
POST /api/rooms/room_abc123/links HTTP/1.1
Content-Type: application/json

{
  "scope": "room",
  "expiresAt": "2026-04-14T23:59:59Z",
  "passwordProtected": true,
  "password": "ViewerPass!",
  "requireEmailVerification": true,
  "permissions": {
    "canView": true,
    "canDownload": false
  }
}
```

**Response (201):**

```json
{
  "data": {
    "linkId": "link_mno345",
    "code": "board-retreat-2026",
    "url": "https://app.vaultspace.io/v/board-retreat-2026",
    "scope": "room",
    "expiresAt": "2026-04-14T23:59:59Z",
    "passwordProtected": true,
    "permissions": {
      "canView": true,
      "canDownload": false
    },
    "createdAt": "2026-03-14T10:04:00Z"
  },
  "meta": { "requestId": "req_def", "timestamp": "2026-03-14T10:04:01Z" }
}
```

---

### Example 4: Document Viewer Access (Public Link Flow)

**Step 1: Viewer accesses public link**

```bash
GET /api/links/board-retreat-2026 HTTP/1.1
```

**Response (200):**

```json
{
  "data": {
    "linkId": "link_mno345",
    "scope": "room",
    "resourceName": "Q1 2026 Board Retreat",
    "permissions": {
      "canView": true,
      "canDownload": false
    },
    "passwordProtected": true,
    "requiresEmailVerification": true,
    "brandedSettings": {
      "brandLogo": "https://cdn.vaultspace.io/org_123/logo.png",
      "brandColors": { "primary": "#007bff", "secondary": "#6c757d" }
    }
  },
  "meta": { "requestId": "req_ghi", "timestamp": "2026-03-14T10:05:00Z" }
}
```

**Step 2: Viewer submits password and email**

```bash
GET /api/links/board-retreat-2026?password=ViewerPass!&email=viewer@external.com HTTP/1.1
```

**Response (200):**

```json
{
  "data": {
    "linkId": "link_mno345",
    "viewerToken": "token_pqr678",
    "viewerTokenExpiresAt": "2026-03-15T10:05:00Z",
    "requiresEmailVerification": true,
    "unverifiedEmail": "viewer@external.com"
  },
  "meta": { "requestId": "req_jkl", "timestamp": "2026-03-14T10:05:01Z" }
}
```

**Step 3: Viewer clicks email verification link**

```bash
POST /api/auth/verify-email HTTP/1.1
Content-Type: application/json

{
  "token": "email_verify_token_from_link"
}
```

**Response (200):**

```json
{
  "data": {
    "emailVerified": true,
    "email": "viewer@external.com"
  },
  "meta": { "requestId": "req_mno", "timestamp": "2026-03-14T10:06:00Z" }
}
```

**Step 4: Frontend uses viewerToken to fetch room/documents**

```bash
GET /api/rooms/room_abc123 HTTP/1.1
Authorization: Bearer token_pqr678
```

---

### Example 5: Activity Dashboard Query

```bash
GET /api/audit/dashboard?roomId=room_abc123&timeRange=7d HTTP/1.1
```

**Response (200):**

```json
{
  "data": {
    "period": {
      "startDate": "2026-03-07",
      "endDate": "2026-03-14"
    },
    "summary": {
      "totalViews": 145,
      "totalDownloads": 32,
      "totalUploads": 8,
      "uniqueViewers": 12,
      "newDocuments": 8,
      "newMembers": 3
    },
    "topDocuments": [
      { "documentId": "doc_1", "name": "Term Sheet v3", "viewCount": 47, "downloadCount": 12 },
      { "documentId": "doc_2", "name": "Cap Table", "viewCount": 38, "downloadCount": 8 }
    ],
    "activeUsers": [
      {
        "userId": "user_123",
        "email": "alice@company.com",
        "firstName": "Alice",
        "actionCount": 68,
        "lastActionAt": "2026-03-14T09:45:00Z"
      },
      {
        "userId": "user_124",
        "email": "bob@company.com",
        "firstName": "Bob",
        "actionCount": 32,
        "lastActionAt": "2026-03-14T08:30:00Z"
      }
    ],
    "activityTrend": [
      { "date": "2026-03-07", "views": 18, "downloads": 4, "uploads": 1 },
      { "date": "2026-03-08", "views": 22, "downloads": 5, "uploads": 1 },
      { "date": "2026-03-14", "views": 28, "downloads": 7, "uploads": 2 }
    ]
  },
  "meta": { "requestId": "req_pqr", "timestamp": "2026-03-14T10:07:00Z" }
}
```

---

## Rate Limiting

### Request Limit Enforcement

When rate limit is exceeded, the response is:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
Content-Type: application/json

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please wait 45 seconds before retrying.",
    "status": 429,
    "requestId": "req_stu"
  }
}
```

**Retry-After Header:** Always present when 429 response; value in seconds.

---

## Webhook Events [V1]

> ⚠️ **V1 -- DO NOT IMPLEMENT IN MVP**
>
> **Feature ID:** F058 (Webhooks)
>
> Webhooks are NOT part of MVP scope. This entire section documents the event types that will be available in V1, for architectural reference only. Do NOT implement webhook endpoints, event delivery, or HMAC signing during the MVP phase. Keep this section for reference when planning V1 features.

### Webhook Event Categories

| Event                 | Trigger                       | Payload                                                                    |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `room.created`        | New room created              | `{ roomId, name, createdBy, timestamp }`                                   |
| `room.updated`        | Room settings changed         | `{ roomId, changes: { field: [old, new] }, updatedBy, timestamp }`         |
| `room.archived`       | Room archived/closed          | `{ roomId, status, timestamp }`                                            |
| `document.uploaded`   | Document added                | `{ documentId, roomId, name, size, uploadedBy, timestamp }`                |
| `document.viewed`     | Document viewed               | `{ documentId, viewedBy, timestamp }`                                      |
| `document.downloaded` | Document downloaded           | `{ documentId, downloadedBy, timestamp }`                                  |
| `document.deleted`    | Document soft-deleted         | `{ documentId, deletedBy, timestamp }`                                     |
| `document.restored`   | Document restored from trash  | `{ documentId, restoredBy, timestamp }`                                    |
| `member.invited`      | User invited to room          | `{ roomId, email, invitedBy, role, timestamp }`                            |
| `member.joined`       | User accepted room invitation | `{ roomId, userId, email, timestamp }`                                     |
| `member.removed`      | Member removed from room      | `{ roomId, userId, removedBy, timestamp }`                                 |
| `permission.granted`  | Permission granted            | `{ resourceType, resourceId, grantee, permissions, grantedBy, timestamp }` |
| `permission.revoked`  | Permission revoked            | `{ resourceType, resourceId, grantee, revokedBy, timestamp }`              |
| `link.created`        | Share link created            | `{ linkId, code, scope, createdBy, timestamp }`                            |
| `link.accessed`       | Link accessed                 | `{ linkId, code, accessedAt, ipAddress, timestamp }`                       |
| `link.revoked`        | Link disabled                 | `{ linkId, revokedBy, timestamp }`                                         |
| `scan.completed`      | Virus scan complete           | `{ documentId, status: 'passed' \| 'failed', timestamp }`                  |
| `preview.ready`       | Preview generation ready      | `{ documentId, previewUrl, timestamp }`                                    |

**V1 Implementation:** Webhooks will be delivered via HTTP POST to registered webhook endpoints with HMAC-SHA256 signature verification.

---

**End of API_SPEC.md**

This specification is the authoritative contract between frontend and backend teams for the VaultSpace MVP. All 63 features are mapped to their corresponding endpoints. Frontend teams can develop against this spec; backend teams implement according to these contracts. See ARCHITECTURE.md, PERMISSION_MODEL.md, and DATABASE_SCHEMA.md for supporting technical details.
