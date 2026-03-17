# EVENT_MODEL.md - VaultSpace Event System Specification

**Document Version:** 1.0
**Feature ID:** F102 (Internal event bus), F153 (Event Model specification)
**Last Updated:** 2026-03-14
**Status:** Implementation-Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Event Schema](#event-schema)
3. [Event Type Catalog](#event-type-catalog)
4. [EventBus Implementation](#eventbus-implementation)
5. [Event Consumers](#event-consumers)
6. [Storage and Partitioning](#storage-and-partitioning)
7. [Querying Events](#querying-events)
8. [Request and Session Correlation](#request-and-session-correlation)
9. [Immutability Guarantees](#immutability-guarantees)
10. [Cross-References](#cross-references)

---

## Overview

VaultSpace uses an **event-driven architecture** where all meaningful state changes emit events to a central EventBus. This foundational pattern enables:

- **Audit Trail (F025)** - Immutable log of every action for compliance and legal defense
- **Analytics Aggregation (F121, F027, F028)** - Async computation of engagement metrics, heatmaps, and activity reports
- **Notifications (F003, F043, F122)** - Email alerts and activity digests based on events
- **Webhook Dispatch (F058)** - Push events to external systems for integrations
- **Real-time Updates (future)** - WebSocket-based live dashboards via event streams

### Philosophy

**Events are facts, not commands.** An event records that something happened in the past; consumers decide what to do with that fact. This decouples the business logic (that emitted the event) from the concern of persistence, notifications, analytics, and integrations.

**Events are append-only and immutable.** Once written, events cannot be modified or deleted. This is enforced at the database level with partitions and constraints.

**Events must never block the emitting operation.** The EventBus accepts events synchronously or queues them immediately, but always returns to the caller so that HTTP requests, user actions, and background jobs are never delayed by event processing.

---

## Event Schema

All events conform to the following canonical schema:

```typescript
interface Event {
  // Unique identifier for this event
  event_id: UUID;

  // Event type enumeration (org.created, room.uploaded, user.login, etc.)
  event_type: EventType;

  // ISO 8601 timestamp (UTC, no timezone info) representing when the event occurred
  timestamp: ISO8601Timestamp;

  // The actor who triggered this event (null for system-generated events)
  actor_id: UUID | null;

  // What kind of actor: user, system, api_key, link_visitor
  actor_type: ActorType;

  // Which organization owns this event (required, no null)
  organization_id: UUID;

  // Which data room is this event about (nullable for org-level events)
  room_id: UUID | null;

  // Which document is this event about (nullable)
  document_id: UUID | null;

  // Correlation ID: links all events emitted during a single HTTP request
  // Enables tracking a single user action to all its side effects
  request_id: UUID;

  // Correlation ID: links all events from a single user session
  // Persists across multiple HTTP requests for the same user
  session_id: UUID;

  // Event-type-specific payload as JSON
  // Structure varies by event_type; see Event Type Catalog
  metadata_json: JSONB;

  // Client IP address (IPv4 or IPv6, nullable for system events)
  ip_address: string | null;

  // User-Agent header from HTTP request (nullable for system events)
  user_agent: string | null;

  // Server-assigned sequencing for strict ordering within a partition
  // Monotonically increasing within a month's partition
  sequence_number: bigint;

  // Created/immutable timestamp (set by database trigger)
  created_at: timestamp with time zone;
}

type EventType = string; // See Event Type Catalog for complete list

type ActorType = 'user' | 'system' | 'api_key' | 'link_visitor';

type UUID = string; // Standard UUID v4 format

type ISO8601Timestamp = string; // RFC 3339 format, e.g., "2026-03-14T15:30:45Z"

type JSONB = Record<string, any>; // PostgreSQL JSONB
```

### Field Specifications

| Field             | Type      | Null | Notes                                                                       |
| ----------------- | --------- | ---- | --------------------------------------------------------------------------- |
| `event_id`        | UUID      | No   | Primary identifier; must be unique globally                                 |
| `event_type`      | string    | No   | Immutable; see Event Type Catalog                                           |
| `timestamp`       | ISO 8601  | No   | Ideally sub-second precision; server time at emission                       |
| `actor_id`        | UUID      | Yes  | Null for system-generated events (background jobs, retention cleanup, etc.) |
| `actor_type`      | enum      | No   | One of: user, system, api_key, link_visitor                                 |
| `organization_id` | UUID      | No   | **Required**: tenant isolation at query time                                |
| `room_id`         | UUID      | Yes  | Null for org-level events (org.created, user.invited, etc.)                 |
| `document_id`     | UUID      | Yes  | Null for room-level events (room.created, user.added_to_room)               |
| `request_id`      | UUID      | No   | **Correlation ID**: groups all events from one HTTP request                 |
| `session_id`      | UUID      | No   | **Correlation ID**: groups all events from one user session                 |
| `metadata_json`   | JSONB     | No   | Event-specific payload; structure varies by event_type                      |
| `ip_address`      | string    | Yes  | Null for system events; IPv4/IPv6 format                                    |
| `user_agent`      | string    | Yes  | Null for system events                                                      |
| `sequence_number` | bigint    | No   | Monotonic within partition; aids ordering                                   |
| `created_at`      | timestamp | No   | Immutable; server timestamp at insertion                                    |

---

## Event Type Catalog

Events are organized by domain. Each event type specifies:

- **Description** – What happened
- **Required Fields** – Minimum set of actor_id, room_id, document_id
- **Example Metadata** – JSON payload specific to this event type

### Organization Events

#### org.created

Organization provisioned (first-run setup).

- **Required Fields:** actor_id (admin setting up), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "organization_name": "Acme Corp",
    "admin_email": "admin@acme.com",
    "plan_type": "self-hosted"
  }
  ```

#### org.updated

Organization settings changed (name, logo, features enabled).

- **Required Fields:** actor_id (admin user), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "changed_fields": ["organization_name", "logo_url"],
    "organization_name": "Acme Corp Investments",
    "previous_name": "Acme Corp",
    "updated_by_admin_id": "uuid"
  }
  ```

#### org.member.added

User invited to organization as admin.

- **Required Fields:** actor_id (inviting admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "invited_user_id": "uuid",
    "invited_email": "newadmin@acme.com",
    "role": "admin",
    "invitation_id": "uuid"
  }
  ```

#### org.member.removed

User removed from organization.

- **Required Fields:** actor_id (admin removing), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "removed_user_id": "uuid",
    "removed_email": "oldadmin@acme.com",
    "reason": "offboarding" | "security" | "voluntary"
  }
  ```

#### org.member.role_changed

User role changed (e.g., admin → viewer-only, or vice versa).

- **Required Fields:** actor_id (admin changing role), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "target_user_id": "uuid",
    "previous_role": "admin",
    "new_role": "viewer"
  }
  ```

#### org.data_residency_selected

Organization chose a data residency region (V2 compliance feature).

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "region": "eu-west-1" | "us-east-1" | "custom",
    "compliance_requirements": ["gdpr"]
  }
  ```

---

### Room Events

#### room.created

A new data room was created.

- **Required Fields:** actor_id (admin creating), room_id (the new room), document_id=null
- **Metadata:**
  ```json
  {
    "room_name": "Project Alpha M&A",
    "room_type": "m_and_a" | "investor" | "board" | "compliance" | "custom",
    "template_id": "uuid or null if custom"
  }
  ```

#### room.updated

Room metadata changed (name, description, settings).

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "changed_fields": ["room_name", "description"],
    "room_name": "Project Alpha Series B",
    "previous_name": "Project Alpha M&A",
    "allow_downloads": true,
    "require_nda": true,
    "watermark_enabled": true
  }
  ```

#### room.archived

Room transitioned to archived state (read-only, no new uploads).

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "previous_state": "active",
    "new_state": "archived",
    "reason": "deal_closed" | "awaiting_review" | "compliance_hold"
  }
  ```

#### room.reopened

Room transitioned from archived back to active.

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "previous_state": "archived",
    "new_state": "active"
  }
  ```

#### room.closed

Room transitioned to closed state (viewers denied all access, read-only to admins).

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "previous_state": "active" | "archived",
    "new_state": "closed",
    "reason": "retention_expired" | "legal_hold_cleared" | "manual_close"
  }
  ```

#### room.deleted

Room hard-deleted (recovery not possible). Only emitted if soft-delete recovery window has passed.

- **Required Fields:** actor_id (system for retention job, or admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "deleted_by": "admin" | "retention_policy",
    "room_name": "Project Alpha M&A",
    "document_count": 150,
    "preserved_in_backup": true
  }
  ```

#### room.member.added

User or group granted access to a room.

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "target_user_id": "uuid or null",
    "target_group_id": "uuid or null",
    "target_email": "viewer@acme.com or null",
    "role": "view" | "view_download" | "admin",
    "expires_at": "2026-04-14T00:00:00Z or null"
  }
  ```

#### room.member.removed

User or group removed from a room.

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "target_user_id": "uuid or null",
    "target_email": "viewer@acme.com or null",
    "reason": "permission_revoked" | "expiry" | "leave_room"
  }
  ```

#### room.legal_hold_applied

Room placed under legal hold (prevents deletion).

- **Required Fields:** actor_id (admin or system), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "legal_hold_id": "uuid",
    "reason": "litigation" | "regulatory_investigation" | "dispute",
    "hold_expires_at": "2027-03-14T00:00:00Z or null"
  }
  ```

#### room.legal_hold_released

Room legal hold removed.

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "legal_hold_id": "uuid",
    "released_by": "admin_id"
  }
  ```

---

### Document Events

#### document.uploaded

A document file was uploaded to a room.

- **Required Fields:** actor_id (admin or api_key), room_id, document_id (the new document)
- **Metadata:**
  ```json
  {
    "document_name": "Q3_2025_Financials.xlsx",
    "file_size_bytes": 2457600,
    "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "folder_id": "uuid or null",
    "file_hash_sha256": "abc123...",
    "virus_scan_result": "clean" | "quarantined" | "pending",
    "upload_source": "web_ui" | "api" | "bulk_import"
  }
  ```

#### document.version.created

A new version of a document was uploaded, replacing the previous version.

- **Required Fields:** actor_id (admin or api_key), room_id, document_id
- **Metadata:**
  ```json
  {
    "document_name": "Q3_2025_Financials.xlsx",
    "version_number": 2,
    "previous_version_id": "uuid",
    "file_size_bytes": 2500000,
    "file_hash_sha256": "def456...",
    "parent_hash": "abc123...",
    "change_summary": "Updated with preliminary audit adjustments"
  }
  ```

#### document.viewed

A viewer or admin opened a document.

- **Required Fields:** actor_id (viewer, user, or api_key), room_id, document_id
- **Metadata:**
  ```json
  {
    "viewer_email": "investor@acme.com or null",
    "viewer_id": "uuid or null",
    "access_method": "link" | "room_member" | "admin_preview",
    "session_duration_seconds": null,
    "page_count": 45,
    "pages_viewed": [1, 2, 3]
  }
  ```

#### document.downloaded

Viewer or admin downloaded a document file.

- **Required Fields:** actor_id, room_id, document_id
- **Metadata:**
  ```json
  {
    "viewer_email": "investor@acme.com or null",
    "viewer_id": "uuid or null",
    "file_format": "original" | "pdf",
    "file_size_bytes": 2457600,
    "access_method": "link" | "room_member"
  }
  ```

#### document.deleted

Document soft-deleted (moved to trash).

- **Required Fields:** actor_id (admin), room_id, document_id
- **Metadata:**
  ```json
  {
    "document_name": "Old_Draft_v1.docx",
    "trash_recovery_expires_at": "2026-04-13T23:59:59Z",
    "reason": "outdated_version" | "user_request" | "cleanup"
  }
  ```

#### document.permanently_deleted

Document hard-deleted from trash (unrecoverable).

- **Required Fields:** actor_id (admin or system), room_id, document_id=null (already deleted)
- **Metadata:**
  ```json
  {
    "document_name": "Trash_Item_vX.pdf",
    "deleted_by": "admin" | "retention_policy",
    "recovery_period_expired": true
  }
  ```

#### document.tagged

One or more tags applied to a document.

- **Required Fields:** actor_id (admin), room_id, document_id
- **Metadata:**
  ```json
  {
    "tags_added": ["financial", "confidential"],
    "tags_removed": [],
    "all_tags": ["financial", "confidential", "q3_2025"]
  }
  ```

#### document.metadata_updated

Custom metadata (key-value pairs) updated on a document.

- **Required Fields:** actor_id (admin), room_id, document_id
- **Metadata:**
  ```json
  {
    "metadata_changes": {
      "department": "Finance",
      "fiscal_year": "2025",
      "sensitivity": "Highly Confidential"
    }
  }
  ```

#### document.bates_number_applied

Admin applied or updated Bates numbering on a document.

- **Required Fields:** actor_id (admin), room_id, document_id
- **Metadata:**
  ```json
  {
    "bates_number_start": 1001,
    "bates_page_count": 45,
    "bates_number_end": 1045
  }
  ```

#### document.preview.generated

Preview pipeline completed successfully (PDF, thumbnails).

- **Required Fields:** actor_id=null (system), room_id, document_id
- **Metadata:**
  ```json
  {
    "preview_format": "pdf",
    "thumbnail_count": 45,
    "text_extraction_succeeded": true,
    "generation_time_ms": 5420,
    "file_size_bytes": 5242880
  }
  ```

#### document.preview.generation_failed

Preview pipeline failed.

- **Required Fields:** actor_id=null (system), room_id, document_id
- **Metadata:**
  ```json
  {
    "error_code": "unsupported_format" | "conversion_timeout" | "storage_error",
    "error_message": "LibreOffice conversion failed: timeout after 30s",
    "retry_count": 2,
    "next_retry_at": "2026-03-14T16:00:00Z"
  }
  ```

#### document.text.extracted

Full-text extraction completed for search indexing.

- **Required Fields:** actor_id=null (system), room_id, document_id
- **Metadata:**
  ```json
  {
    "extracted_text_length": 45000,
    "extraction_time_ms": 2300,
    "confidence": 0.98
  }
  ```

#### document.virus_scan.completed

Virus scan finished.

- **Required Fields:** actor_id=null (system), room_id, document_id
- **Metadata:**
  ```json
  {
    "scan_result": "clean" | "infected" | "suspicious",
    "scanner": "clamav",
    "scan_time_ms": 1200,
    "threat_name": "Win.Trojan.Generic or null"
  }
  ```

#### document.redaction.applied

Admin applied redactions to a document (V2 feature).

- **Required Fields:** actor_id (admin), room_id, document_id
- **Metadata:**
  ```json
  {
    "redacted_pages": [5, 12, 23],
    "redaction_count": 8,
    "original_document_id": "uuid"
  }
  ```

---

### Access Control Events

#### link.created

Admin created a share link.

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "link_id": "uuid",
    "link_token": "hashed_token",
    "expires_at": "2026-04-14T00:00:00Z or null",
    "password_protected": true,
    "download_enabled": true,
    "scope": "room" | "folder" | "document",
    "access_level": "view" | "view_download"
  }
  ```

#### link.visited

Someone clicked or accessed a share link.

- **Required Fields:** actor_id=link_visitor, room_id, document_id=null
- **Metadata:**
  ```json
  {
    "link_id": "uuid",
    "visitor_email": "external@partner.com or null",
    "visitor_identifier": "hashed_ip_or_cookie",
    "password_required": true,
    "password_provided": true,
    "access_granted": true
  }
  ```

#### link.expired

Share link reached its expiry date and became inaccessible.

- **Required Fields:** actor_id=null (system), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "link_id": "uuid",
    "expired_at": "2026-04-14T00:00:00Z"
  }
  ```

#### link.revoked

Admin manually revoked a share link.

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "link_id": "uuid",
    "reason": "no_longer_needed" | "security" | "user_request"
  }
  ```

#### nda.presented

Viewer presented with NDA before room access.

- **Required Fields:** actor_id=link_visitor, room_id, document_id=null
- **Metadata:**
  ```json
  {
    "visitor_email": "investor@acme.com",
    "nda_version": "2.0",
    "presented_at": "2026-03-14T15:30:00Z"
  }
  ```

#### nda.signed

Viewer accepted/signed the NDA.

- **Required Fields:** actor_id (visitor who signed), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "visitor_email": "investor@acme.com",
    "visitor_id": "uuid or null",
    "nda_version": "2.0",
    "signed_at": "2026-03-14T15:35:00Z",
    "ip_address": "192.0.2.1",
    "signature_hash": "sha256_hash_of_acceptance"
  }
  ```

#### permission.granted

User or group granted a specific permission on a document or folder.

- **Required Fields:** actor_id (admin), room_id, document_id
- **Metadata:**
  ```json
  {
    "target_user_id": "uuid or null",
    "target_group_id": "uuid or null",
    "target_email": "viewer@acme.com or null",
    "permission": "view" | "view_download" | "print",
    "scope": "document" | "folder" | "implicit_via_group",
    "expires_at": "2026-04-14T00:00:00Z or null"
  }
  ```

#### permission.revoked

User or group lost a permission.

- **Required Fields:** actor_id (admin), room_id, document_id
- **Metadata:**
  ```json
  {
    "target_user_id": "uuid or null",
    "target_email": "viewer@acme.com or null",
    "permission": "view" | "view_download" | "print",
    "reason": "admin_revoked" | "permission_expired" | "group_membership_change"
  }
  ```

#### access_request.submitted

Uninvited user requested access to a room.

- **Required Fields:** actor_id=link_visitor, room_id, document_id=null
- **Metadata:**
  ```json
  {
    "requester_email": "external@partner.com",
    "requester_message": "We are evaluating your platform for our investment.",
    "request_id": "uuid"
  }
  ```

#### access_request.approved

Admin approved an access request.

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "request_id": "uuid",
    "requester_email": "external@partner.com",
    "approved_access_level": "view_download",
    "expires_at": "2026-04-14T00:00:00Z or null"
  }
  ```

#### access_request.denied

Admin denied an access request.

- **Required Fields:** actor_id (admin), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "request_id": "uuid",
    "requester_email": "external@partner.com",
    "denial_reason": "Not authorized for this deal"
  }
  ```

---

### User/Session Events

#### user.login

Admin or user logged in (created a session).

- **Required Fields:** actor_id (the user logging in), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "user_id": "uuid",
    "user_email": "admin@acme.com",
    "authentication_method": "password" | "sso" | "api_key",
    "sso_provider": "okta or null",
    "session_id": "uuid",
    "device_fingerprint": "hash or null"
  }
  ```

#### user.logout

Admin or user logged out (destroyed session).

- **Required Fields:** actor_id (the user logging out), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "user_id": "uuid",
    "user_email": "admin@acme.com",
    "session_id": "uuid",
    "session_duration_seconds": 3600,
    "logout_reason": "explicit" | "timeout" | "admin_force_logout"
  }
  ```

#### user.invited

User invited to organization.

- **Required Fields:** actor_id (inviting admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "invited_user_email": "newadmin@acme.com",
    "invited_role": "admin" | "viewer",
    "invited_to_rooms": ["room_id_1", "room_id_2"],
    "invitation_id": "uuid",
    "email_sent": true
  }
  ```

#### user.invitation_accepted

Invited user accepted invitation and created account.

- **Required Fields:** actor_id (the user accepting), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "user_id": "uuid",
    "user_email": "newadmin@acme.com",
    "invitation_id": "uuid"
  }
  ```

#### user.password_changed

User changed their password.

- **Required Fields:** actor_id (the user), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "user_id": "uuid",
    "user_email": "admin@acme.com",
    "changed_by": "self" | "admin",
    "password_hash_updated": true
  }
  ```

#### user.2fa_enabled

User enabled two-factor authentication.

- **Required Fields:** actor_id (the user), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "user_id": "uuid",
    "user_email": "admin@acme.com",
    "2fa_method": "totp"
  }
  ```

#### user.2fa_disabled

User disabled two-factor authentication.

- **Required Fields:** actor_id (the user or admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "user_id": "uuid",
    "user_email": "admin@acme.com",
    "disabled_by": "self" | "admin"
  }
  ```

#### user.api_key_created

User (admin) created an API key.

- **Required Fields:** actor_id (the admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "user_id": "uuid",
    "api_key_id": "uuid",
    "api_key_hash": "sha256_hash",
    "scopes": ["room:read", "document:read", "document:write"],
    "expires_at": "2027-03-14T00:00:00Z or null"
  }
  ```

#### user.api_key_rotated

Admin rotated (revoked and issued replacement) for an API key.

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "api_key_id": "uuid",
    "new_key_hash": "sha256_hash",
    "rotated_by": "admin_id"
  }
  ```

#### user.api_key_revoked

API key explicitly revoked.

- **Required Fields:** actor_id (admin or owner), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "api_key_id": "uuid",
    "revoked_by": "self" | "admin",
    "reason": "compromised" | "unused" | "rotation"
  }
  ```

#### user.session_terminated

User session forcefully terminated by admin.

- **Required Fields:** actor_id (admin terminating), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "target_user_id": "uuid",
    "target_user_email": "admin@acme.com",
    "session_id": "uuid",
    "reason": "security" | "offboarding"
  }
  ```

---

### System Events

#### job.started

Background job started (preview generation, scan, email dispatch, etc.).

- **Required Fields:** actor_id=null (system), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "job_id": "uuid",
    "job_type": "preview_generation" | "virus_scan" | "email_dispatch" | "analytics_aggregation",
    "queue": "preview" | "scan" | "general" | "report",
    "priority": "high" | "normal" | "low",
    "attempted_at": "2026-03-14T15:30:00Z"
  }
  ```

#### job.completed

Background job finished successfully.

- **Required Fields:** actor_id=null (system), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "job_id": "uuid",
    "job_type": "preview_generation",
    "duration_ms": 5420,
    "completed_at": "2026-03-14T15:35:00Z"
  }
  ```

#### job.failed

Background job failed.

- **Required Fields:** actor_id=null (system), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "job_id": "uuid",
    "job_type": "preview_generation",
    "error_code": "timeout" | "storage_error" | "conversion_error",
    "error_message": "LibreOffice conversion failed after 30s",
    "retry_count": 2,
    "max_retries": 5,
    "failed_at": "2026-03-14T15:35:00Z",
    "next_retry_at": "2026-03-14T16:00:00Z or null"
  }
  ```

#### scan.completed

Malware/virus scan completed on a file.

- **Required Fields:** actor_id=null (system), room_id, document_id
- **Metadata:**
  ```json
  {
    "scanner": "clamav",
    "scan_result": "clean" | "infected" | "suspicious",
    "threat_name": "Win.Trojan.Generic or null",
    "scan_time_ms": 1200,
    "file_hash": "sha256_hash"
  }
  ```

#### preview.generated

PDF preview and thumbnails generated for a document.

- **Required Fields:** actor_id=null (system), room_id, document_id
- **Metadata:**
  ```json
  {
    "preview_format": "pdf",
    "page_count": 45,
    "thumbnail_count": 45,
    "file_size_bytes": 5242880,
    "generation_time_ms": 5420
  }
  ```

#### retention.cleanup.started

Retention policy cleanup job started.

- **Required Fields:** actor_id=null (system), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "cleanup_job_id": "uuid",
    "scope": "organization" | "room",
    "organization_id": "uuid",
    "retention_days": 90,
    "started_at": "2026-03-14T02:00:00Z"
  }
  ```

#### retention.document.deleted

Document auto-deleted by retention policy.

- **Required Fields:** actor_id=null (system), room_id, document_id=null (already deleted)
- **Metadata:**
  ```json
  {
    "document_name": "expired_doc.pdf",
    "document_id_archived": "uuid",
    "deletion_reason": "retention_policy_expired",
    "uploaded_at": "2025-12-14T00:00:00Z",
    "deleted_at": "2026-03-14T00:00:00Z",
    "retention_days": 90
  }
  ```

#### expiry.link_expired

Share link automatically expired after its expiry_date.

- **Required Fields:** actor_id=null (system), room_id, document_id=null
- **Metadata:**
  ```json
  {
    "link_id": "uuid",
    "expired_at": "2026-04-14T00:00:00Z",
    "access_count": 42
  }
  ```

#### expiry.permission_expired

User's permission on a document/room automatically expired.

- **Required Fields:** actor_id=null (system), room_id, document_id
- **Metadata:**
  ```json
  {
    "target_user_id": "uuid",
    "target_email": "viewer@acme.com or null",
    "permission_level": "view_download",
    "expired_at": "2026-04-14T00:00:00Z"
  }
  ```

---

### Admin Events

#### settings.changed

Global organization settings changed (email config, storage, watermark defaults, etc.).

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "setting_key": "smtp_host" | "watermark_enabled" | "session_timeout_minutes",
    "previous_value": "smtp.sendgrid.net",
    "new_value": "smtp.gmail.com",
    "changed_fields": ["smtp_host", "smtp_port"]
  }
  ```

#### watermark.updated

Watermark settings changed (fields, placement, font).

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "watermark_enabled": true,
    "fields": ["viewer_name", "viewer_email", "ip_address", "timestamp"],
    "placement": "diagonal" | "margin",
    "font_size": 14,
    "opacity": 0.3
  }
  ```

#### room_template.created

Admin created a new room template from an existing room.

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "template_name": "M&A Due Diligence 2026",
    "template_id": "uuid",
    "source_room_id": "uuid",
    "folder_structure_included": true,
    "permissions_included": true
  }
  ```

#### room_template.updated

Room template modified.

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "template_id": "uuid",
    "template_name": "M&A Due Diligence 2026",
    "changed_fields": ["description", "default_permissions"]
  }
  ```

#### room_template.deleted

Room template deleted.

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "template_id": "uuid",
    "template_name": "M&A Due Diligence 2026"
  }
  ```

#### audit_report.exported

Admin exported an audit/compliance report.

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "report_type": "audit_trail" | "compliance_package" | "activity_summary",
    "report_id": "uuid",
    "filters": {
      "time_range": {
        "start": "2026-01-14T00:00:00Z",
        "end": "2026-03-14T00:00:00Z"
      },
      "rooms": ["room_id_1"],
      "event_types": ["document.viewed", "permission.granted"]
    },
    "record_count": 5042,
    "export_format": "csv" | "pdf",
    "export_size_bytes": 1024000
  }
  ```

#### backup.started

Database and storage backup initiated.

- **Required Fields:** actor_id (admin or system), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "backup_id": "uuid",
    "backup_type": "full" | "incremental",
    "initiated_by": "manual" | "scheduled",
    "started_at": "2026-03-14T02:00:00Z"
  }
  ```

#### backup.completed

Backup finished successfully.

- **Required Fields:** actor_id=null (system), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "backup_id": "uuid",
    "backup_type": "full",
    "backup_size_bytes": 107374182400,
    "duration_minutes": 45,
    "database_records": 250000,
    "storage_files": 15000,
    "completed_at": "2026-03-14T02:45:00Z",
    "backup_location": "s3://backups/backup_uuid/",
    "checksum": "sha256_hash"
  }
  ```

#### restore.initiated

Admin initiated a restore from backup.

- **Required Fields:** actor_id (admin), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "restore_id": "uuid",
    "backup_id": "uuid",
    "restore_point_time": "2026-03-13T00:00:00Z",
    "scope": "full" | "database_only" | "storage_only"
  }
  ```

#### restore.completed

Restore finished successfully.

- **Required Fields:** actor_id=null (system), room_id=null, document_id=null
- **Metadata:**
  ```json
  {
    "restore_id": "uuid",
    "backup_id": "uuid",
    "duration_minutes": 120,
    "records_restored": 250000,
    "files_restored": 15000,
    "completed_at": "2026-03-14T04:45:00Z"
  }
  ```

---

## EventBus Implementation

The EventBus is the central dispatcher for all events. It guarantees:

1. **Synchronous acceptance** - caller gets immediate confirmation
2. **Async processing** - consumers run without blocking the caller
3. **Event validation** - malformed events are rejected
4. **Error isolation** - consumer failures don't impact other consumers
5. **Ordering** - events within a partition maintain causal order

### TypeScript Interface

```typescript
// Core EventBus interface
interface EventBus {
  /**
   * Emit an event synchronously (returns immediately).
   * Event is either stored immediately or queued for async processing.
   * Throws EventValidationError if the event fails schema validation.
   * Never throws for downstream consumer failures.
   */
  emit(event: Event): Promise<void>;

  /**
   * Subscribe to events of a specific type.
   * Handler is called synchronously if event is processed immediately,
   * or asynchronously if event is queued.
   * Handler errors are caught and logged; they do not propagate.
   */
  subscribe(
    eventType: EventType | EventType[],
    handler: EventHandler,
    options?: SubscriptionOptions
  ): Unsubscribe;

  /**
   * Query historical events (for audit trail, analytics).
   * Results are paginated and filtered by the query.
   */
  query(query: EventQuery, options?: QueryOptions): Promise<EventQueryResult>;

  /**
   * Health check: verify EventBus can write to database and process queues.
   */
  health(): Promise<HealthStatus>;
}

type EventHandler = (event: Event, context: EventContext) => Promise<void>;

interface SubscriptionOptions {
  // Process only events from the current organization
  organizationId?: UUID;

  // Process events asynchronously via job queue
  // If false, handler runs synchronously in-process
  async?: boolean;

  // Retry failed handler calls up to N times
  maxRetries?: number;

  // Queue priority (if async=true)
  // Synchronous handlers ignore this
  priority?: 'high' | 'normal' | 'low';

  // Topic prefix for selective subscriptions
  // "document.%" subscribes to all document.* events
  topicFilter?: string;
}

interface EventContext {
  // The original HTTP request object (if applicable)
  request?: IncomingMessage;

  // The current user session (if applicable)
  session?: Session;

  // Organization context
  organizationId: UUID;

  // For tracing: the original request_id
  requestId: UUID;

  // For correlation: the user session_id
  sessionId: UUID;
}

interface EventQuery {
  // Required: filter by organization
  organizationId: UUID;

  // Optional: filter by event types
  eventTypes?: EventType[];

  // Optional: filter by actor
  actorId?: UUID;
  actorType?: ActorType;

  // Optional: filter by resource
  roomId?: UUID;
  documentId?: UUID;

  // Optional: filter by time range
  startTime?: ISO8601Timestamp;
  endTime?: ISO8601Timestamp;

  // Optional: full-text search in metadata_json
  metadataSearch?: string;

  // Pagination
  limit?: number; // default 100, max 10000
  offset?: number; // default 0
}

interface EventQueryResult {
  events: Event[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: 'ok' | 'error';
  jobQueue: 'ok' | 'error' | 'not_configured';
  lastEventId?: UUID;
  lastEventTime?: ISO8601Timestamp;
  errors?: string[];
}

type Unsubscribe = () => void;
```

### Implementation Class

```typescript
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@logger';
import { Database } from '@database';
import { JobQueue } from '@jobs';
import { validate as validateEvent } from './eventSchema';

export class EventBusImpl implements EventBus {
  private db: Database;
  private jobQueue: JobQueue;
  private logger: Logger;
  private emitter: EventEmitter;

  constructor(db: Database, jobQueue: JobQueue, logger: Logger) {
    this.db = db;
    this.jobQueue = jobQueue;
    this.logger = logger;
    this.emitter = new EventEmitter();

    // Set high listener limit to avoid warnings with many subscriptions
    this.emitter.setMaxListeners(100);
  }

  async emit(event: Event): Promise<void> {
    // Validate event schema
    try {
      await validateEvent(event);
    } catch (err) {
      this.logger.error('Event validation failed', {
        error: err.message,
        event_id: event.event_id,
        event_type: event.event_type,
      });
      throw new EventValidationError(`Invalid event: ${err.message}`, event);
    }

    // Ensure event_id, timestamps, request_id, session_id are set
    const enrichedEvent: Event = {
      ...event,
      event_id: event.event_id || uuidv4(),
      timestamp: event.timestamp || new Date().toISOString(),
      request_id: event.request_id || uuidv4(),
      session_id: event.session_id || uuidv4(),
    };

    try {
      // Write event to database (immutable append)
      await this.db.events.create(enrichedEvent);

      // Emit locally for synchronous subscribers
      this.emitter.emit(enrichedEvent.event_type, enrichedEvent);

      // Queue for async consumers
      // Create a job per subscription to decouple processing
      await this.jobQueue.enqueue(
        'event-dispatch',
        {
          event_id: enrichedEvent.event_id,
          event_type: enrichedEvent.event_type,
        },
        { priority: 'normal' }
      );

      this.logger.debug('Event emitted', {
        event_id: enrichedEvent.event_id,
        event_type: enrichedEvent.event_type,
      });
    } catch (err) {
      this.logger.error('Event emission failed', {
        error: err.message,
        event_id: enrichedEvent.event_id,
        event_type: enrichedEvent.event_type,
      });
      // Important: Never throw on storage failure, but log it
      // Events are precious; a failure to store should alert ops
      // but should not block the HTTP response
    }
  }

  subscribe(
    eventType: EventType | EventType[],
    handler: EventHandler,
    options: SubscriptionOptions = {}
  ): Unsubscribe {
    const eventTypes = Array.isArray(eventType) ? eventType : [eventType];

    const wrappedHandler = async (event: Event) => {
      const context: EventContext = {
        organizationId: event.organization_id,
        requestId: event.request_id,
        sessionId: event.session_id,
      };

      try {
        if (options.async) {
          // Enqueue async job
          await this.jobQueue.enqueue(
            'event-handler',
            { event_id: event.event_id, handler: handler.name },
            { priority: options.priority || 'normal', maxRetries: options.maxRetries || 3 }
          );
        } else {
          // Call synchronously
          await handler(event, context);
        }
      } catch (err) {
        this.logger.error('Event handler error', {
          event_id: event.event_id,
          event_type: event.event_type,
          handler_name: handler.name,
          error: err.message,
        });
        // Error is logged but not propagated
      }
    };

    // Subscribe to each event type
    eventTypes.forEach((type) => {
      this.emitter.on(type, wrappedHandler);
    });

    // Return unsubscribe function
    return () => {
      eventTypes.forEach((type) => {
        this.emitter.off(type, wrappedHandler);
      });
    };
  }

  async query(query: EventQuery, options?: QueryOptions): Promise<EventQueryResult> {
    const limit = Math.min(query.limit || 100, 10000);
    const offset = query.offset || 0;

    const where: Record<string, any> = {
      organization_id: query.organizationId,
    };

    if (query.eventTypes?.length) {
      where.event_type = { in: query.eventTypes };
    }
    if (query.actorId) {
      where.actor_id = query.actorId;
    }
    if (query.actorType) {
      where.actor_type = query.actorType;
    }
    if (query.roomId) {
      where.room_id = query.roomId;
    }
    if (query.documentId) {
      where.document_id = query.documentId;
    }
    if (query.startTime || query.endTime) {
      where.timestamp = {};
      if (query.startTime) where.timestamp.gte = query.startTime;
      if (query.endTime) where.timestamp.lte = query.endTime;
    }

    // Full-text search in metadata if requested
    if (query.metadataSearch) {
      where.metadata_json = {
        contains: query.metadataSearch, // PostgreSQL JSONB @@ operator via Prisma
      };
    }

    const [events, total] = await Promise.all([
      this.db.events.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.db.events.count({ where }),
    ]);

    return {
      events,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async health(): Promise<HealthStatus> {
    const status: HealthStatus = {
      status: 'healthy',
      database: 'ok',
      jobQueue: 'ok',
    };

    try {
      // Test database connectivity
      const lastEvent = await this.db.events.findFirst({
        orderBy: { created_at: 'desc' },
      });
      status.lastEventId = lastEvent?.event_id;
      status.lastEventTime = lastEvent?.timestamp;
    } catch (err) {
      status.database = 'error';
      status.status = 'degraded';
      status.errors ||= [];
      status.errors.push(`Database error: ${err.message}`);
    }

    try {
      // Test job queue connectivity
      const queueHealth = await this.jobQueue.health();
      if (!queueHealth.ok) {
        status.jobQueue = 'error';
        status.status = 'degraded';
        status.errors ||= [];
        status.errors.push(`Job queue error: ${queueHealth.error}`);
      }
    } catch (err) {
      status.jobQueue = 'error';
      status.status = 'degraded';
      status.errors ||= [];
      status.errors.push(`Job queue error: ${err.message}`);
    }

    if (status.database === 'error') {
      status.status = 'unhealthy';
    }

    return status;
  }
}

class EventValidationError extends Error {
  constructor(
    message: string,
    public event: Event
  ) {
    super(message);
    this.name = 'EventValidationError';
  }
}
```

### Middleware Integration

In the Express/Fastify request pipeline, inject request_id and session_id:

```typescript
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

// Middleware to attach request_id and session_id to every request
export function eventCorrelationMiddleware(req: Request, res: Response, next: NextFunction) {
  // Generate request_id if not present (for distributed tracing)
  req.request_id = (req.headers['x-request-id'] as string) || uuidv4();

  // Extract or create session_id (from secure session cookie)
  let session_id = req.session?.id as string | undefined;
  if (!session_id) {
    // Generate new session_id; will be stored in session cookie
    session_id = uuidv4();
    if (req.session) {
      req.session.id = session_id;
    }
  }
  req.session_id = session_id;

  // Make available to event handlers
  res.setHeader('x-request-id', req.request_id);

  next();
}

// When emitting events, always include request_id and session_id from the request context
export function emitEvent(req: Request, event: Omit<Event, 'request_id' | 'session_id'>) {
  return eventBus.emit({
    ...event,
    request_id: req.request_id,
    session_id: req.session_id,
    ip_address: req.ip,
    user_agent: req.get('user-agent'),
  });
}
```

---

## Event Consumers

Different systems consume events in different ways. The EventBus enables decoupled subscribers.

### Audit Trail Consumer

**Pattern:** Synchronous, direct database write, immutable

```typescript
// Subscribe to all events for audit trail
eventBus.subscribe(
  '*', // All events
  async (event: Event) => {
    // Write directly to audit_events table
    await db.auditEvents.create({
      event_id: event.event_id,
      event_type: event.event_type,
      organization_id: event.organization_id,
      actor_id: event.actor_id,
      actor_email: event.actor?.email, // Join to users table if needed
      resource_type: getResourceType(event.event_type),
      resource_id: event.document_id || event.room_id,
      action: event.event_type,
      change_details: event.metadata_json,
      ip_address: event.ip_address,
      user_agent: event.user_agent,
      timestamp: event.timestamp,
    });
  },
  { async: false } // Synchronous for immediate durability
);
```

**Query Example:** Audit trail for a specific document

```typescript
const auditTrail = await eventBus.query({
  organizationId: org_id,
  documentId: doc_id,
  startTime: '2026-01-01T00:00:00Z',
  endTime: '2026-03-14T23:59:59Z',
  limit: 1000,
});

// Display as table
auditTrail.events.forEach((event) => {
  console.log(
    `${event.timestamp} | ${event.actor_id} | ${event.event_type} | ${JSON.stringify(event.metadata_json)}`
  );
});
```

### Analytics Aggregation Consumer

**Pattern:** Asynchronous, batch aggregation, updates counters

```typescript
// Aggregate analytics from viewing and download events
eventBus.subscribe(
  ['document.viewed', 'document.downloaded'],
  async (event: Event) => {
    // Increment counters for analytics dashboard
    const date = new Date(event.timestamp).toISOString().split('T')[0];

    // Upsert analytics record
    await db.analytics.upsert(
      {
        organization_id: event.organization_id,
        room_id: event.room_id,
        document_id: event.document_id,
        date,
        metric_type: event.event_type === 'document.viewed' ? 'views' : 'downloads',
      },
      {
        create: {
          organization_id: event.organization_id,
          room_id: event.room_id,
          document_id: event.document_id,
          date,
          metric_type: event.event_type === 'document.viewed' ? 'views' : 'downloads',
          count: 1,
          unique_viewers: event.metadata_json.viewer_email ? 1 : 0,
        },
        update: {
          count: { increment: 1 },
          unique_viewers: event.metadata_json.viewer_email ? { increment: 1 } : undefined,
        },
      }
    );
  },
  { async: true, priority: 'low' } // Async, low priority (doesn't need immediate response)
);
```

### Notification Dispatcher Consumer

**Pattern:** Asynchronous, checks user preferences, sends emails

```typescript
eventBus.subscribe(
  ['document.viewed', 'document.downloaded', 'document.deleted', 'permission.granted'],
  async (event: Event, context: EventContext) => {
    // Get admin users who should be notified
    const admins = await db.users.findMany({
      where: {
        organization_id: context.organizationId,
        role: 'admin',
      },
      include: { notificationPreferences: true },
    });

    for (const admin of admins) {
      // Check if admin has notifications enabled for this event type
      const prefs = admin.notificationPreferences;
      const shouldNotify = shouldSendNotification(event.event_type, prefs);

      if (shouldNotify) {
        // Queue email
        await emailQueue.enqueue('notification-email', {
          recipient: admin.email,
          event_type: event.event_type,
          event_data: event,
          admin_name: admin.name,
        });
      }
    }
  },
  { async: true, priority: 'normal' }
);

function shouldSendNotification(eventType: EventType, prefs: NotificationPreferences): boolean {
  if (!prefs.email_enabled) return false;

  switch (eventType) {
    case 'document.viewed':
      return prefs.notify_on_view;
    case 'document.downloaded':
      return prefs.notify_on_download;
    case 'document.deleted':
      return prefs.notify_on_delete;
    case 'permission.granted':
      return prefs.notify_on_permission_change;
    default:
      return false;
  }
}
```

### Webhook Dispatcher Consumer

**Pattern:** Asynchronous, delivers to registered endpoints, retries on failure

```typescript
eventBus.subscribe(
  '*', // All events
  async (event: Event, context: EventContext) => {
    // Find webhooks registered for this event type
    const webhooks = await db.webhooks.findMany({
      where: {
        organization_id: context.organizationId,
        enabled: true,
        event_types: { has: event.event_type },
      },
    });

    for (const webhook of webhooks) {
      // Queue webhook delivery
      await jobQueue.enqueue(
        'webhook-delivery',
        {
          webhook_id: webhook.id,
          webhook_url: webhook.url,
          event_id: event.event_id,
          event_type: event.event_type,
          payload: {
            event_id: event.event_id,
            event_type: event.event_type,
            timestamp: event.timestamp,
            data: event.metadata_json,
          },
        },
        { priority: 'normal', maxRetries: 5 }
      );
    }
  },
  { async: true, priority: 'normal' }
);
```

**Webhook Delivery Job Handler:**

```typescript
jobQueue.registerHandler('webhook-delivery', async (job: Job) => {
  const { webhook_id, webhook_url, event_id, payload } = job.data;

  const signature = createWebhookSignature(payload, webhook.secret);

  try {
    const response = await fetch(webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VaultSpace-Signature': signature,
        'X-Event-ID': event_id,
      },
      body: JSON.stringify(payload),
      timeout: 30000,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Log successful delivery
    await db.webhookLogs.create({
      webhook_id,
      event_id,
      status: 'delivered',
      response_code: response.status,
    });
  } catch (err) {
    // Log failed delivery; job will retry
    await db.webhookLogs.create({
      webhook_id,
      event_id,
      status: 'failed',
      error_message: err.message,
    });

    throw err; // Trigger job retry
  }
});
```

---

## Storage and Partitioning

Events are stored in PostgreSQL with monthly time-based partitioning for efficient retention and archival.

### Database Schema

```sql
-- Main events table, partitioned by month
CREATE TABLE events (
  event_id UUID NOT NULL PRIMARY KEY,
  event_type VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  actor_id UUID,
  actor_type VARCHAR(50) NOT NULL,
  organization_id UUID NOT NULL,
  room_id UUID,
  document_id UUID,
  request_id UUID NOT NULL,
  session_id UUID NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  sequence_number BIGSERIAL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
)
PARTITION BY RANGE (DATE_TRUNC('month', timestamp));

-- Create initial partitions (e.g., current month and next 3 months)
CREATE TABLE events_2026_03 PARTITION OF events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE events_2026_04 PARTITION OF events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE events_2026_05 PARTITION OF events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE events_2026_06 PARTITION OF events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Indices for common queries
CREATE INDEX idx_events_org_time ON events (organization_id, timestamp DESC)
  WHERE created_at IS NOT NULL;

CREATE INDEX idx_events_room_time ON events (room_id, timestamp DESC)
  WHERE room_id IS NOT NULL;

CREATE INDEX idx_events_document_time ON events (document_id, timestamp DESC)
  WHERE document_id IS NOT NULL;

CREATE INDEX idx_events_actor_time ON events (actor_id, timestamp DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX idx_events_type ON events (event_type);

-- JSONB containment indices for metadata queries
CREATE INDEX idx_events_metadata ON events USING gin (metadata_json);

-- Row-Level Security: REQUIRED in production, optional in development
-- RLS provides a second layer of defense: even if app logic fails to filter by organizationId,
-- the database will prevent cross-tenant data leakage.
--
-- PRODUCTION: RLS must be enabled to enforce org isolation
-- DEVELOPMENT: RLS can be disabled for debugging convenience (Docker Compose)
--
-- Set app.current_org_id before every request/transaction:
--   SET LOCAL app.current_org_id = '<organization-id>';
-- This context variable is automatically reset at transaction end.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Immutability: disable updates and deletes at the constraint level
CREATE POLICY events_immutable_insert ON events
  FOR INSERT TO authenticated, service_role
  WITH CHECK (true);

CREATE POLICY events_immutable_no_update ON events
  FOR UPDATE TO authenticated, service_role
  USING (false); -- Prevent all updates

CREATE POLICY events_immutable_no_delete ON events
  FOR DELETE TO authenticated, service_role
  USING (false); -- Prevent all deletes

-- Read policy: users can only read events from their own organization
-- This enforces org isolation at the database level using RLS context
CREATE POLICY events_read_own_org ON events
  FOR SELECT TO authenticated
  USING (organization_id = current_setting('app.current_org_id')::UUID);
```

### Prisma Schema

```prisma
model Event {
  eventId          String   @id @db.Uuid
  eventType        String
  timestamp        DateTime @db.Timestamptz
  actorId          String?  @db.Uuid
  actorType        String // 'user' | 'system' | 'api_key' | 'link_visitor'
  organizationId   String   @db.Uuid
  roomId           String?  @db.Uuid
  documentId       String?  @db.Uuid
  requestId        String   @db.Uuid
  sessionId        String   @db.Uuid
  metadataJson     Json     @default("{}")
  ipAddress        String?
  userAgent        String?
  sequenceNumber   BigInt   @autoincrement
  createdAt        DateTime @default(now()) @db.Timestamptz

  // Relations
  organization     Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  room             Room?        @relation(fields: [roomId], references: [id], onDelete: SetNull)
  document         Document?    @relation(fields: [documentId], references: [id], onDelete: SetNull)
  actor            User?        @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([organizationId, timestamp(sort: Desc)])
  @@index([roomId, timestamp(sort: Desc)])
  @@index([documentId, timestamp(sort: Desc)])
  @@index([actorId, timestamp(sort: Desc)])
  @@index([eventType])
  @@index([metadataJson])
  @@map("events")
}
```

### Partition Management

Automatically create future partitions via a scheduled job (runs daily):

```typescript
// Background job: Create next month's partition
jobQueue.registerScheduledJob(
  'events-create-next-partition',
  '0 2 * * *', // 02:00 daily
  async () => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const monthAfter = new Date(now.getFullYear(), now.getMonth() + 3, 1);

    const partitionName = `events_${nextMonth.getFullYear()}_${String(
      nextMonth.getMonth() + 1
    ).padStart(2, '0')}`;

    const startDate = nextMonth.toISOString().split('T')[0];
    const endDate = monthAfter.toISOString().split('T')[0];

    try {
      await db.$executeRaw(Prisma.sql`
        CREATE TABLE IF NOT EXISTS ${Prisma.raw(partitionName)} PARTITION OF events
        FOR VALUES FROM (${startDate}::timestamp) TO (${endDate}::timestamp);
      `);

      logger.info('Created partition', {
        partition_name: partitionName,
        start_date: startDate,
        end_date: endDate,
      });
    } catch (err) {
      logger.error('Failed to create partition', {
        error: err.message,
        partition_name: partitionName,
      });
    }
  }
);
```

### Retention and Archival Policy

```typescript
interface RetentionPolicy {
  organizationId: UUID;
  retentionDays: number; // Default: 365
  archivalDays: number; // Default: 1095 (3 years)
  archivalStorageUrl?: string; // S3, GCS, etc.
}

// Background job: Archive and delete expired events
jobQueue.registerScheduledJob(
  'events-retention-cleanup',
  '0 3 * * 0', // 03:00 on Sundays
  async () => {
    const orgs = await db.organizations.findMany({
      include: { retentionPolicy: true },
    });

    for (const org of orgs) {
      const policy = org.retentionPolicy || {
        retentionDays: 365,
        archivalDays: 1095,
      };

      // Calculate cutoff dates
      const archiveBeforeDate = new Date();
      archiveBeforeDate.setDate(archiveBeforeDate.getDate() - policy.archivalDays);

      const deleteBeforeDate = new Date();
      deleteBeforeDate.setDate(deleteBeforeDate.getDate() - policy.retentionDays);

      // Archive old events
      if (policy.archivalStorageUrl) {
        const archiveEvents = await db.events.findMany({
          where: {
            organizationId: org.id,
            timestamp: { lt: archiveBeforeDate },
            archived: false,
          },
          take: 100000,
        });

        if (archiveEvents.length > 0) {
          // Export to archival storage
          const archiveFile = await exportEventsToParquet(archiveEvents, org.id, archiveBeforeDate);

          await uploadToArchivalStorage(policy.archivalStorageUrl, archiveFile);

          // Mark as archived
          await db.events.updateMany(
            {
              where: {
                event_id: { in: archiveEvents.map((e) => e.event_id) },
              },
            },
            { archived: true }
          );

          logger.info('Archived events', {
            organization_id: org.id,
            count: archiveEvents.length,
            archive_date: archiveBeforeDate.toISOString(),
          });
        }
      }

      // Delete old, archived events (respect legal holds)
      await db.events.deleteMany({
        where: {
          organizationId: org.id,
          timestamp: { lt: deleteBeforeDate },
          archived: true,
          room: { legalHold: { is: null } }, // Don't delete if room is under legal hold
        },
      });

      logger.info('Deleted archived events', {
        organization_id: org.id,
        delete_before: deleteBeforeDate.toISOString(),
      });
    }
  }
);
```

---

## Event Compaction & Aggregation

### Problem Statement

Rooms open for 3+ years (particularly in legal holds, M&A transactions, and compliance archives) accumulate 36+ monthly event partitions. Querying raw events for analytics dashboards (F121 activity summary, F028 viewer analytics) becomes slow; aggregate queries scanning 3+ years of raw event tables may timeout or consume excessive I/O.

### Solution: Room Activity Summary Table

A denormalized `room_activity_summary` table aggregates daily events, updated nightly by a Low Priority background job. The analytics dashboard (F121) and activity reports (F031, F122) read from this summary instead of scanning raw events.

**Schema:**

```prisma
model RoomActivitySummary {
  id                String   @id @default(cuid())
  roomId            String
  organizationId    String
  period            String   // 'daily' | 'weekly' | 'monthly'
  periodDate        DateTime // Start of period (e.g., 2026-03-01 for daily)

  // Aggregated metrics
  totalViews        Int      @default(0)
  uniqueViewers     Int      @default(0)
  documentsAdded    Int      @default(0)
  documentsUpdated  Int      @default(0)

  // Top documents (JSON for flexibility)
  topDocumentsJson  Json     // Array of {documentId, views, downloads}

  computedAt        DateTime @default(now())
  updatedAt         DateTime @updatedAt

  room              Room     @relation(fields: [roomId], references: [id], onDelete: Cascade)
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([roomId, period, periodDate])
  @@index([organizationId, periodDate])
  @@map("room_activity_summaries")
}
```

**SQL equivalent:**

```sql
CREATE TABLE room_activity_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly'
  period_date DATE NOT NULL,
  total_views INT DEFAULT 0,
  unique_viewers INT DEFAULT 0,
  documents_added INT DEFAULT 0,
  documents_updated INT DEFAULT 0,
  top_documents_json JSONB DEFAULT '[]',
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(room_id, period, period_date),
  INDEX idx_org_period (organization_id, period_date)
);
```

**Aggregation Job (Low Priority, scheduled nightly):**

```typescript
jobQueue.registerScheduledJob(
  'event-compaction',
  '0 2 * * *', // 02:00 daily, after most traffic subsides
  async () => {
    const orgs = await db.organization.findMany();

    for (const org of orgs) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStart = new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate()
      );
      const yesterdayEnd = new Date(yesterdayStart);
      yesterdayEnd.setDate(yesterdayEnd.getDate() + 1);

      // Get all rooms in org
      const rooms = await db.room.findMany({
        where: { organizationId: org.id },
        select: { id: true },
      });

      for (const room of rooms) {
        // Aggregate yesterday's events
        const views = await db.event.count({
          where: {
            roomId: room.id,
            eventType: 'document.viewed',
            createdAt: { gte: yesterdayStart, lt: yesterdayEnd },
          },
        });

        const uniqueViewers = await db.event.findMany({
          where: {
            roomId: room.id,
            eventType: 'document.viewed',
            createdAt: { gte: yesterdayStart, lt: yesterdayEnd },
          },
          select: { actorId: true },
          distinct: ['actorId'],
        });

        const docsAdded = await db.event.count({
          where: {
            roomId: room.id,
            eventType: 'document.uploaded',
            createdAt: { gte: yesterdayStart, lt: yesterdayEnd },
          },
        });

        const docsUpdated = await db.event.count({
          where: {
            roomId: room.id,
            eventType: 'document.updated',
            createdAt: { gte: yesterdayStart, lt: yesterdayEnd },
          },
        });

        // Top documents by view count
        const topDocs = await db.$queryRaw`
          SELECT
            document_id,
            COUNT(*) as view_count,
            SUM(CASE WHEN event_type = 'document.downloaded' THEN 1 ELSE 0 END) as download_count
          FROM events
          WHERE room_id = ${room.id}
            AND created_at >= ${yesterdayStart}
            AND created_at < ${yesterdayEnd}
            AND event_type IN ('document.viewed', 'document.downloaded')
          GROUP BY document_id
          ORDER BY view_count DESC
          LIMIT 10;
        `;

        // Upsert summary
        await db.roomActivitySummary.upsert({
          where: {
            roomId_period_periodDate: {
              roomId: room.id,
              period: 'daily',
              periodDate: yesterdayStart,
            },
          },
          update: {
            totalViews: views,
            uniqueViewers: uniqueViewers.length,
            documentsAdded: docsAdded,
            documentsUpdated: docsUpdated,
            topDocumentsJson: topDocs,
            updatedAt: new Date(),
          },
          create: {
            roomId: room.id,
            organizationId: org.id,
            period: 'daily',
            periodDate: yesterdayStart,
            totalViews: views,
            uniqueViewers: uniqueViewers.length,
            documentsAdded: docsAdded,
            documentsUpdated: docsUpdated,
            topDocumentsJson: topDocs,
          },
        });
      }
    }

    logger.info('Event compaction job completed', {
      timestamp: new Date(),
      organizations: orgs.length,
    });
  }
);
```

**Analytics Dashboard Integration:**

The room activity dashboard (F121) and viewer analytics (F028) now queries the summary table instead of raw events:

```typescript
async function getRoomActivitySummary(
  organizationId: UUID,
  roomId: UUID,
  days: number = 30
): Promise<ActivityMetrics> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Fast query on aggregated table (single index)
  const summaries = await db.roomActivitySummary.findMany({
    where: {
      organizationId,
      roomId,
      period: 'daily',
      periodDate: { gte: cutoffDate },
    },
    orderBy: { periodDate: 'asc' },
  });

  return {
    totalViews: summaries.reduce((sum, s) => sum + s.totalViews, 0),
    uniqueViewers: summaries.reduce((sum, s) => sum + s.uniqueViewers, 0),
    topDocuments: mergeTopDocuments(summaries),
    trend: summaries.map((s) => ({
      date: s.periodDate,
      views: s.totalViews,
      uniqueViewers: s.uniqueViewers,
    })),
  };
}
```

**Benefits:**

- Dashboard queries complete in milliseconds (index + denormalized data) vs. seconds/timeouts on raw events
- Nightly batch job has O(1) cost per room, not O(N partitions)
- Rooms with 3+ year retention (legal holds) remain queryable
- Raw events still available for detailed audit/forensics via direct queries

---

## Querying Events

Common query patterns for audit trail, analytics, and debugging.

### Activity Feed for a Room

Display recent actions in a room to admins:

```typescript
async function getActivityFeed(
  organizationId: UUID,
  roomId: UUID,
  limit: number = 50
): Promise<ActivityEntry[]> {
  const events = await eventBus.query({
    organizationId,
    roomId,
    eventTypes: [
      'document.uploaded',
      'document.viewed',
      'document.downloaded',
      'permission.granted',
      'permission.revoked',
      'room.member.added',
      'room.member.removed',
    ],
    limit,
  });

  return events.events.map((event) => ({
    timestamp: event.timestamp,
    actor: event.actor_id ? `User ${event.actor_id}` : 'System',
    action: formatEventType(event.event_type),
    details: event.metadata_json,
  }));
}
```

### Audit Trail for a Document

Export full audit trail for legal defensibility:

```typescript
async function getDocumentAuditTrail(organizationId: UUID, documentId: UUID): Promise<AuditReport> {
  const events = await eventBus.query({
    organizationId,
    documentId,
    limit: 10000,
  });

  return {
    document_id: documentId,
    total_events: events.total,
    events: events.events.map((e) => ({
      timestamp: e.timestamp,
      event_type: e.event_type,
      actor: e.actor_id,
      actor_type: e.actor_type,
      ip_address: e.ip_address,
      metadata: e.metadata_json,
    })),
  };
}
```

### User Activity History

Track all actions by a specific user (admin security audits):

```typescript
async function getUserActivityHistory(
  organizationId: UUID,
  userId: UUID,
  startDate: ISO8601Timestamp,
  endDate: ISO8601Timestamp
): Promise<Event[]> {
  return (
    await eventBus.query({
      organizationId,
      actorId: userId,
      startTime: startDate,
      endTime: endDate,
      limit: 10000,
    })
  ).events;
}
```

### Analytics Aggregation

Compute engagement metrics:

```typescript
async function getRoomEngagement(
  organizationId: UUID,
  roomId: UUID,
  days: number = 30
): Promise<EngagementMetrics> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const events = await eventBus.query({
    organizationId,
    roomId,
    eventTypes: ['document.viewed', 'document.downloaded'],
    startTime: startDate.toISOString(),
    limit: 100000,
  });

  const viewCounts = new Map<UUID, number>();
  const uniqueViewers = new Set<string>();

  events.events.forEach((event) => {
    const docId = event.document_id!;
    viewCounts.set(docId, (viewCounts.get(docId) || 0) + 1);

    if (event.metadata_json.viewer_email) {
      uniqueViewers.add(event.metadata_json.viewer_email);
    }
  });

  return {
    room_id: roomId,
    period_days: days,
    total_views: events.events.filter((e) => e.event_type === 'document.viewed').length,
    total_downloads: events.events.filter((e) => e.event_type === 'document.downloaded').length,
    unique_viewers: uniqueViewers.size,
    most_viewed_documents: Array.from(viewCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  };
}
```

### Time-Range Scoped Queries (Partition Pruning)

PostgreSQL automatically prunes partitions when timestamp is filtered:

```typescript
// This query only touches the March 2026 partition
const marchEvents = await eventBus.query({
  organizationId: org_id,
  startTime: '2026-03-01T00:00:00Z',
  endTime: '2026-03-31T23:59:59Z',
  limit: 100000,
});
// Query plan: SeqScan on events_2026_03 (not events)
```

---

## Request and Session Correlation

`request_id` and `session_id` enable grouping related events and debugging.

### Generation and Propagation

```typescript
// Express middleware (runs on every request)
app.use((req, res, next) => {
  // Extract or generate request_id
  req.request_id = (req.headers['x-request-id'] as string) || uuidv4();

  // Extract or generate session_id
  req.session_id = req.session?.id || uuidv4();
  if (req.session) {
    req.session.id = req.session_id;
  }

  // Make IDs available in response headers
  res.setHeader('x-request-id', req.request_id);

  next();
});

// Store in async context (for use in async handlers)
app.use((req, res, next) => {
  asyncLocalStorage.run(
    {
      request_id: req.request_id,
      session_id: req.session_id,
      organization_id: req.user?.organization_id,
    },
    next
  );
});
```

### Emitting Events with Correlation IDs

```typescript
// Helper function to emit events with automatic context capture
function emitEventFromRequest(req: Request, eventType: EventType, metadata: Record<string, any>) {
  return eventBus.emit({
    event_id: uuidv4(),
    event_type: eventType,
    timestamp: new Date().toISOString(),
    actor_id: req.user?.id || null,
    actor_type: req.user ? 'user' : 'system',
    organization_id: req.user?.organization_id,
    room_id: null,
    document_id: null,
    request_id: req.request_id, // Automatic
    session_id: req.session_id, // Automatic
    metadata_json: metadata,
    ip_address: req.ip,
    user_agent: req.get('user-agent'),
  });
}

// Usage in a route handler
app.post('/api/documents', async (req, res) => {
  const document = await createDocument(req.body);

  await emitEventFromRequest(req, 'document.uploaded', {
    document_name: document.name,
    file_size_bytes: document.file_size,
    file_hash_sha256: document.hash,
  });

  res.json(document);
});
```

### Correlating Events Across a Request

```typescript
// Query all events from a single request
async function getRequestEvents(organizationId: UUID, requestId: UUID): Promise<Event[]> {
  return (
    await eventBus.query({
      organizationId,
      metadataSearch: requestId, // This is a hack; ideally query by request_id directly
      // Better approach:
      // Prisma: events.findMany({ where: { organization_id: orgId, request_id: reqId } })
    })
  ).events;
}

// Trace a request: see all side effects
// If a single POST request emits document.uploaded, preview.generated, scan.completed,
// they all share the same request_id and can be correlated
```

### Correlating Events Across a Session

```typescript
// Query all events from a single user session
async function getSessionEvents(organizationId: UUID, sessionId: UUID): Promise<Event[]> {
  return (
    await eventBus.query({
      organizationId,
      // sessionId parameter not yet in EventQuery interface
      // Add it:
      // sessionId,
      limit: 100000,
    })
  ).events.filter((e) => e.session_id === sessionId);
}

// Track user behavior across multiple requests
// A user's session logs in, views docs, downloads, then logs out
// All linked by session_id
```

---

## Immutability Guarantees

Events are append-only and immutable by design and enforcement.

### Database-Level Enforcement

```sql
-- Policies prevent UPDATE and DELETE
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_immutable_no_update ON events
  FOR UPDATE
  USING (false);

CREATE POLICY events_immutable_no_delete ON events
  FOR DELETE
  USING (false);

-- Attempt to update will fail
UPDATE events SET metadata_json = '{}' WHERE event_id = 'xxx';
-- ERROR: new row violates row-level security policy "events_immutable_no_update"
```

### Application-Level Enforcement

Never call `update()` or `delete()` on events:

```typescript
// Forbidden
await db.events.update({ ... });
await db.events.delete({ ... });

// Allowed
await db.events.create({ ... });
await db.events.findMany({ ... });
await db.events.findUnique({ ... });
```

### Audit Trail Immutability

Because events cannot be modified, the audit trail is a tamper-evident record:

- **Admins cannot remove or alter events** – Enforcement at database level
- **Timestamps are set at insertion and immutable** – Forensic integrity
- **Hash chains (for version control, F002)** – Each document version includes the parent hash, enabling detection of missing versions

---

## Cross-References

This document is part of VaultSpace architecture and design specifications.

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** – High-level system design, module descriptions, data flow
- **[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)** – Complete database schema, Document Object Model, search index model, organization/tenant model
- **[PERMISSION_MODEL.md](./PERMISSION_MODEL.md)** – Role hierarchy, ACL evaluation, PermissionEngine specification
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** – Deployment guide, environment configuration, scaling considerations

### Related Features

- **F025** (Audit trail of all user activity) – Consumes events
- **F102** (Internal event bus) – This spec
- **F121** (Room activity summary dashboard) – Consumes events
- **F027** (Page-level engagement tracking) – Emits document.viewed events
- **F058** (Webhook support) – Delivers events to external endpoints
- **F003** (Email notifications) – Sends emails based on events

---

## Revision History

| Version | Date       | Changes                                                                                            |
| ------- | ---------- | -------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-03-14 | Initial specification: event schema, 50+ event types, storage/partitioning, consumers, correlation |
