# SEED_DATA.md - VaultSpace Test Data & Seed Specification

**Status:** MVP Specification
**Feature Reference:** F143 (Demo Seed Data)
**Last Updated:** 2026-03-14

---

## Table of Contents

1. [Seed Data Purpose](#seed-data-purpose)
2. [Organizations](#organizations)
3. [Users](#users)
4. [Series A Funding Room](#series-a-funding-room)
5. [Sample Documents](#sample-documents)
6. [Room Members and Permissions](#room-members-and-permissions)
7. [Shared Links](#shared-links)
8. [Simulated Activity History](#simulated-activity-history)
9. [Cross-Tenant Test Data](#cross-tenant-test-data)
10. [Seed Script Specification](#seed-script-specification)
11. [Test Accounts Quick Reference](#test-accounts-quick-reference)

---

## Seed Data Purpose

The seed data specification defines a consistent, repeatable dataset for VaultSpace MVP development, testing, and demonstration.

### F143 Requirement: Demo Launch

When a developer runs `npm run db:seed` after `docker compose up`, the system launches with a fully-populated "Series A Funding Room" demonstration data room. This room showcases:

- Multi-level folder hierarchy with realistic document organization
- Multiple users with different roles (owner, admin, member, viewer)
- Room-level and document-level permissions
- Shared links (active, expired, password-protected)
- Rich activity history showing document views, downloads, uploads, member additions
- Sample files representing all common document types (PDF, Excel, PowerPoint, Word, text)

### Development Testing

All developers work with identical seed data, ensuring:

- Consistent reproduction of bugs across environments
- Predictable test data for feature development
- Same folder structure and permissions for understanding the product

### Security Testing

Seed data includes multiple organizations and users for validating:

- **SEC-001 to SEC-005:** Cross-tenant isolation
- **SEC-006 to SEC-010:** Permission enforcement (role-based access control)
- **SEC-011 to SEC-016:** Link permissions, password protection, expiry handling, IP restrictions (V1)

### Preview Pipeline Testing

Sample documents include all supported file types in preview processing:

- PDF files
- Word documents (.docx)
- Excel spreadsheets (.xlsx)
- PowerPoint presentations (.pptx)
- Images (.png, .jpg)
- Text files (.txt)

Each document in the seed room has a preview status of `READY` (all processed), allowing testers to immediately view previews without waiting for background jobs.

---

## Organizations

### Acme Corp

**Primary organization for Series A demo.**

| Field           | Value                |
| --------------- | -------------------- |
| **orgId**       | `org_acme`           |
| **Name**        | Acme Corp            |
| **Tier**        | Pro (self-hosted)    |
| **Industry**    | Technology           |
| **Admin Email** | admin@acme.example   |
| **Created At**  | 2026-01-01T00:00:00Z |

### Beta Industries

**Secondary organization for cross-tenant security testing.**

| Field           | Value                |
| --------------- | -------------------- |
| **orgId**       | `org_beta`           |
| **Name**        | Beta Industries      |
| **Tier**        | Pro (self-hosted)    |
| **Industry**    | Manufacturing        |
| **Admin Email** | admin@beta.example   |
| **Created At**  | 2026-01-01T00:00:00Z |

---

## Users

All user passwords are hashed using bcrypt with 12 rounds. The plain-text password is listed below **for development convenience only**; all stored values are bcrypt hashes.

**Password Hash Reference:** Using password `password123`, the bcrypt hash is:

```
$2b$12$7/Z/5L2zPqVpB1aBz6l1K.Y9Kz7/Z/5L2zPqVpB1aBz6l1K.Y9Kz
```

### Acme Corp Users

| Name          | Email                   | Password      | Org Role   | Room Role   | Organization | Status       | Purpose                                              |
| ------------- | ----------------------- | ------------- | ---------- | ----------- | ------------ | ------------ | ---------------------------------------------------- |
| Admin User    | `admin@acme.example`    | `password123` | **OWNER**  | Room ADMIN  | Acme Corp    | ACTIVE       | Org owner; can create/delete rooms, manage all users |
| Manager User  | `manager@acme.example`  | `password123` | **ADMIN**  | Room ADMIN  | Acme Corp    | ACTIVE       | Org admin; can manage rooms but not org settings     |
| Member User   | `member@acme.example`   | `password123` | **MEMBER** | Room EDITOR | Acme Corp    | ACTIVE       | Regular org member; upload/view in assigned rooms    |
| Viewer User   | `viewer@acme.example`   | `password123` | **MEMBER** | Room VIEWER | Acme Corp    | ACTIVE       | Read-only viewer; cannot upload, limited downloads   |
| Disabled User | `disabled@acme.example` | `password123` | **MEMBER** | (none)      | Acme Corp    | **DISABLED** | Account disabled; used for testing access denial     |

### Beta Industries Users

| Name            | Email                 | Password      | Org Role   | Room Role   | Organization    | Status | Purpose                                                  |
| --------------- | --------------------- | ------------- | ---------- | ----------- | --------------- | ------ | -------------------------------------------------------- |
| External Admin  | `admin@beta.example`  | `password123` | **OWNER**  | Room ADMIN  | Beta Industries | ACTIVE | Beta Industries owner; for cross-tenant isolation tests  |
| External Viewer | `viewer@beta.example` | `password123` | **MEMBER** | Room VIEWER | Beta Industries | ACTIVE | Beta Industries viewer; verify they cannot see Acme data |

### Role Definition Reference

**Organization Roles:**

- **OWNER**: Full control over organization, can create/manage rooms, assign user roles, configure settings
- **ADMIN**: Can manage rooms and documents, but cannot change org settings or user roles
- **MEMBER**: Limited to accessing assigned rooms; cannot manage rooms or users

**Room-Level Roles (within Series A Funding Room):**

- **ADMIN**: Full control of room documents, folders, permissions, and members
- **EDITOR**: Can upload documents and edit metadata, but no member management
- **VIEWER**: Read-only access; cannot upload; may have download restrictions per document

---

## Series A Funding Room

The "North Star" demonstration room showcasing all core features.

### Room Metadata

| Field            | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| **Room ID**      | `room_series_a`                                           |
| **Name**         | Series A Funding - Q1 2026                                |
| **Organization** | Acme Corp (org_acme)                                      |
| **Owner**        | admin@acme.example                                        |
| **Status**       | ACTIVE                                                    |
| **Created At**   | 2026-02-01T10:00:00Z                                      |
| **Description**  | Sample data room for Series A funding round due diligence |

### Room Settings

| Setting           | Value | Purpose                                 |
| ----------------- | ----- | --------------------------------------- |
| Allow Download    | TRUE  | Default; some folders override to FALSE |
| Allow Print       | FALSE | Security default                        |
| Require NDA       | FALSE | For MVP demo (V1: NDA gate)             |
| Watermark Enabled | FALSE | For MVP demo (V1: watermarking)         |
| Auto Archive Date | None  | Room remains active indefinitely        |

### Folder Structure

```
Series A Funding - Q1 2026/
├── Financial Documents/
│   ├── Q4-2025-Financial-Statements.pdf
│   ├── Revenue-Projections-2026.xlsx
│   └── Cap-Table-Current.xlsx
├── Legal/
│   ├── Certificate-of-Incorporation.pdf
│   ├── Bylaws.pdf
│   └── IP-Assignment-Agreements.pdf
├── Team/
│   ├── Org-Chart.pptx
│   └── Key-Employee-Bios.docx
├── Product/
│   ├── Product-Roadmap.pptx
│   ├── Architecture-Diagram.png
│   └── Demo-Video-Link.txt
└── Due Diligence Checklist.xlsx
```

### Folder-Level Permissions

| Folder              | Download Allowed | View Allowed | Notes                                       |
| ------------------- | ---------------- | ------------ | ------------------------------------------- |
| Financial Documents | **FALSE**        | TRUE         | Sensitive; viewers can see but not download |
| Legal               | TRUE             | TRUE         | Standard access                             |
| Team                | TRUE             | TRUE         | Standard access                             |
| Product             | TRUE             | TRUE         | Standard access                             |
| Root                | TRUE             | TRUE         | Checklist accessible to all                 |

---

## Sample Documents

All sample documents are generated as placeholder files by the seed script. Files contain minimal content (document title, some metadata) but are valid in their respective formats.

### Document Specifications

| File Name                            | Type        | Approx. Size | Pages    | Content Description                                                                                                                         | Preview Status |
| ------------------------------------ | ----------- | ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Q4-2025-Financial-Statements.pdf** | PDF         | 250 KB       | 15       | Mock financial statements with balance sheet, income statement, cash flow, and footnotes. Includes Acme Corp header and Q4 2025 period end. | READY          |
| **Revenue-Projections-2026.xlsx**    | Excel       | 180 KB       | 5 sheets | Spreadsheet with monthly revenue projections, expense budgets, and growth assumptions. Data mocked with realistic figures.                  | READY          |
| **Cap-Table-Current.xlsx**           | Excel       | 120 KB       | 2 sheets | Cap table showing share issuance history, current ownership percentages, dilution analysis, and investor list. Fictional data.              | READY          |
| **Certificate-of-Incorporation.pdf** | PDF         | 45 KB        | 3        | Legal document with corporate formation details, share structure, and amendment history. Mocked content.                                    | READY          |
| **Bylaws.pdf**                       | PDF         | 85 KB        | 8        | Corporate bylaws document covering governance, board structure, shareholder rights. Standard template content.                              | READY          |
| **IP-Assignment-Agreements.pdf**     | PDF         | 200 KB       | 12       | Multiple IP assignment agreements from founders and employees to the corporation. Redacted names/dates.                                     | READY          |
| **Org-Chart.pptx**                   | PowerPoint  | 350 KB       | 3 slides | Org chart presentation showing reporting structure with executive and team leads. Org chart diagram + team bios slide.                      | READY          |
| **Key-Employee-Bios.docx**           | Word        | 95 KB        | 4 pages  | Word document with executive bios: CEO, CTO, CFO, VP Sales. Each with mock background and role description.                                 | READY          |
| **Product-Roadmap.pptx**             | PowerPoint  | 420 KB       | 6 slides | Product roadmap presentation with Q1-Q4 2026 milestones, feature priorities, and release timeline.                                          | READY          |
| **Architecture-Diagram.png**         | Image (PNG) | 890 KB       | 1        | Technical architecture diagram showing system components, databases, integrations. High-resolution diagram.                                 | READY          |
| **Demo-Video-Link.txt**              | Text        | 1 KB         | 1        | Plain text file containing a link to product demo video (fictional YouTube URL).                                                            | READY          |
| **Due Diligence Checklist.xlsx**     | Excel       | 150 KB       | 1 sheet  | Checklist spreadsheet with common due diligence items, status (✓/✗), and owner assignments.                                                 | READY          |

### Document Metadata

All documents have these metadata fields populated:

| Field               | Value                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| **Created At**      | Documents created between 2026-02-01 and 2026-02-15 (spread across seed period) |
| **Updated At**      | Same as created time (no revisions in initial seed)                             |
| **File Size**       | As specified in table above                                                     |
| **Mime Type**       | Appropriate for file type (application/pdf, application/vnd.ms-excel, etc.)     |
| **Current Version** | Version 1 (all documents are version 1)                                         |
| **Total Versions**  | 1                                                                               |
| **Status**          | ACTIVE                                                                          |
| **Tags**            | Empty array (no tags for MVP demo)                                              |
| **Bates Number**    | None (Bates numbering is V1 feature)                                            |
| **View Count**      | Populated by activity history (see below)                                       |
| **Download Count**  | Populated by activity history (see below)                                       |
| **Last Viewed At**  | Populated by activity history (see below)                                       |

---

## Room Members and Permissions

### Room Membership

| User Email             | Org Role | Room Role   | Status | Permissions                                                               |
| ---------------------- | -------- | ----------- | ------ | ------------------------------------------------------------------------- |
| `admin@acme.example`   | OWNER    | Room ADMIN  | ACTIVE | Full control: upload, delete, manage permissions, manage members          |
| `manager@acme.example` | ADMIN    | Room ADMIN  | ACTIVE | Full control: upload, delete, manage permissions, manage members          |
| `member@acme.example`  | MEMBER   | Room EDITOR | ACTIVE | Upload/edit documents, view all; cannot manage members or delete          |
| `viewer@acme.example`  | MEMBER   | Room VIEWER | ACTIVE | View-only; cannot upload; limited downloads on Financial Documents folder |

### Document-Level Permissions

#### Financial Documents Folder

**Default folder permission:** `allowDownload: FALSE`

This creates a scenario where viewers can **see** the documents but are **prevented from downloading** them.

| User                 | Can View? | Can Download? | Notes                                              |
| -------------------- | --------- | ------------- | -------------------------------------------------- |
| admin@acme.example   | ✓         | ✓             | ADMIN can always download                          |
| manager@acme.example | ✓         | ✓             | ADMIN can always download                          |
| member@acme.example  | ✓         | ✓             | EDITOR inherits folder permission but can override |
| viewer@acme.example  | ✓         | ✗             | VIEWER subject to folder restriction               |

#### Legal Folder

**Default folder permission:** `allowDownload: TRUE`

All users can view and download.

#### Team Folder

**Default folder permission:** `allowDownload: TRUE`

All users can view and download.

#### Product Folder

**Default folder permission:** `allowDownload: TRUE`

All users can view and download.

---

## Shared Links

Shared links are a mechanism for giving external parties view access without requiring authentication.

### Active Link: "Investor Review"

| Field                  | Value                                        |
| ---------------------- | -------------------------------------------- |
| **Link ID**            | `link_investor`                              |
| **Name**               | Investor Review                              |
| **Room**               | Series A Funding - Q1 2026                   |
| **Scope**              | Entire room (all folders and documents)      |
| **Type**               | Email-verified                               |
| **Password Protected** | FALSE                                        |
| **Allows Download**    | TRUE                                         |
| **Allows View**        | TRUE                                         |
| **Created At**         | 2026-02-10T14:00:00Z                         |
| **Expires At**         | 2026-04-10T14:00:00Z (30 days from creation) |
| **Status**             | ACTIVE                                       |
| **Access Count**       | 5 (simulated; see activity history)          |

**Recipient Email:** investor@example.com (metadata only; not a user account)

**Purpose:** Allows external investors to review the entire room without logging in. Email verification required before first access.

### Active Link: "Legal Review"

| Field               | Value                                        |
| ------------------- | -------------------------------------------- |
| **Link ID**         | `link_legal_review`                          |
| **Name**            | Legal Review                                 |
| **Room**            | Series A Funding - Q1 2026                   |
| **Scope**           | Legal folder only                            |
| **Type**            | Password-protected                           |
| **Password**        | `review2026` (bcrypt-hashed in database)     |
| **Allows Download** | TRUE                                         |
| **Allows View**     | TRUE                                         |
| **Created At**      | 2026-02-12T09:00:00Z                         |
| **Expires At**      | 2026-05-12T09:00:00Z (90 days from creation) |
| **Status**          | ACTIVE                                       |
| **Access Count**    | 2 (simulated; see activity history)          |

**Purpose:** Restricted link for legal team review. Password required; can access only Legal folder documents.

### Expired Link: "Investor Preview (OLD)"

| Field                  | Value                                           |
| ---------------------- | ----------------------------------------------- |
| **Link ID**            | `link_expired`                                  |
| **Name**               | Investor Preview (OLD)                          |
| **Room**               | Series A Funding - Q1 2026                      |
| **Scope**              | Product folder                                  |
| **Type**               | Email-verified                                  |
| **Password Protected** | FALSE                                           |
| **Allows Download**    | TRUE                                            |
| **Allows View**        | TRUE                                            |
| **Created At**         | 2026-01-15T12:00:00Z                            |
| **Expires At**         | 2026-02-14T12:00:00Z (**EXPIRED** - 2 days ago) |
| **Status**             | EXPIRED                                         |
| **Access Count**       | 8 (before expiry)                               |

**Purpose:** Link that expired in the past. Used for testing expiration handling (access should be denied with 404 or "link expired" message).

---

## Simulated Activity History

To provide a realistic demo experience, the seed script populates the event log with 50+ events spread across the past 30 days. These events simulate real user interactions.

### Event Distribution

| Event Type            | Count | Spread  | Description                        |
| --------------------- | ----- | ------- | ---------------------------------- |
| DOCUMENT_VIEWED       | 20    | 30 days | Various users viewing documents    |
| DOCUMENT_DOWNLOADED   | 8     | 30 days | Downloads by member and viewer     |
| DOCUMENT_UPLOADED     | 4     | 15 days | Uploads by admin and manager users |
| ROOM_MEMBER_ADDED     | 5     | 15 days | User invitations to the room       |
| LINK_ACCESSED         | 10    | 25 days | External access via shared links   |
| ROOM_SETTINGS_CHANGED | 2     | 20 days | Admin configuration updates        |

### Sample Events (Chronological Order)

**Event 1: Room Created**

- **Type:** ROOM_CREATED
- **Timestamp:** 2026-02-01T10:00:00Z
- **Actor:** admin@acme.example (OWNER)
- **Room:** Series A Funding - Q1 2026
- **Description:** Org owner created the demo room

**Event 2: Member Added**

- **Type:** ROOM_MEMBER_ADDED
- **Timestamp:** 2026-02-01T10:15:00Z
- **Actor:** admin@acme.example
- **User Added:** manager@acme.example
- **Role Assigned:** Room ADMIN
- **Description:** Added manager as room admin

**Event 3: Member Added**

- **Type:** ROOM_MEMBER_ADDED
- **Timestamp:** 2026-02-01T10:30:00Z
- **Actor:** admin@acme.example
- **User Added:** member@acme.example
- **Role Assigned:** Room EDITOR
- **Description:** Added member as editor

**Event 4: Member Added**

- **Type:** ROOM_MEMBER_ADDED
- **Timestamp:** 2026-02-01T10:45:00Z
- **Actor:** admin@acme.example
- **User Added:** viewer@acme.example
- **Role Assigned:** Room VIEWER
- **Description:** Added viewer as read-only member

**Event 5-16: Document Uploads** (2026-02-01 to 2026-02-15)

- **Type:** DOCUMENT_UPLOADED
- **Actor:** admin@acme.example or manager@acme.example
- **Documents:** All 12 sample documents uploaded
- **Timestamp Spread:** One document every ~18 hours
- **Description:** Documents added to respective folders as part of room setup

**Event 17-36: Document Views** (2026-02-15 to 2026-03-10)

- **Type:** DOCUMENT_VIEWED
- **Actor:** Various (admin, manager, member, viewer)
- **Timestamp Spread:** 2-3 views per day, randomly distributed
- **Sample:**
  - member@acme.example views Q4-2025-Financial-Statements.pdf (2026-02-15T14:00:00Z)
  - viewer@acme.example views Org-Chart.pptx (2026-02-16T09:30:00Z)
  - manager@acme.example views Product-Roadmap.pptx (2026-02-17T11:00:00Z)
  - (... continue pattern)

**Event 37-44: Document Downloads** (2026-02-20 to 2026-03-05)

- **Type:** DOCUMENT_DOWNLOADED
- **Actor:** member@acme.example or admin@acme.example
- **Documents:** Legal, Team, Product folders (NOT Financial Documents due to download restriction)
- **Sample:**
  - member@acme.example downloads Bylaws.pdf (2026-02-20T15:30:00Z)
  - admin@acme.example downloads Key-Employee-Bios.docx (2026-02-22T10:00:00Z)
  - (... continue pattern)

**Event 45-54: Link Accesses** (2026-02-10 to 2026-03-08)

- **Type:** LINK_ACCESSED
- **Actor:** Anonymous (via link)
- **Link:** investor@example.com via "Investor Review" link
- **Timestamp Spread:** 1-2 accesses every 3-4 days
- **Sample:**
  - investor@example.com accesses room via "Investor Review" link (2026-02-10T14:30:00Z)
  - investor@example.com views Certificate-of-Incorporation.pdf (2026-02-12T16:00:00Z)
  - investor@example.com views Revenue-Projections-2026.xlsx (2026-02-15T10:00:00Z)
  - legal@example.com accesses Legal folder via "Legal Review" link (2026-02-12T09:15:00Z)
  - legal@example.com views Bylaws.pdf (2026-02-12T09:20:00Z)
  - (... continue pattern)

**Event 55: Room Settings Updated**

- **Type:** ROOM_SETTINGS_CHANGED
- **Timestamp:** 2026-02-25T13:00:00Z
- **Actor:** admin@acme.example
- **Changed Fields:** { watermarkEnabled: false, allowPrint: false }
- **Description:** Admin configured room security settings

### Event Model Fields

Every event in the activity history includes:

```typescript
{
  id: string;                     // Unique event ID
  organizationId: string;         // org_acme
  roomId: string;                 // room_series_a
  eventType: EventType;           // DOCUMENT_VIEWED, etc.
  actorType: ActorType;           // ADMIN, VIEWER, SYSTEM
  actorId?: string;               // User ID (null for anonymous)
  actorEmail?: string;            // Email of actor
  resourceType: ResourceType;     // DOCUMENT, ROOM, LINK, etc.
  resourceId?: string;            // Document ID, Link ID, etc.
  resourceName?: string;          // "Series A Funding - Q1 2026"
  timestamp: DateTime;            // Event occurrence time
  details: Json;                  // Event-specific metadata
  isAuditable: boolean;           // true for all seed events
}
```

### Activity History Impact

The simulated events populate these document fields:

| Document                         | View Count | Download Count | Last Viewed          |
| -------------------------------- | ---------- | -------------- | -------------------- |
| Q4-2025-Financial-Statements.pdf | 5          | 2              | 2026-03-08T14:00:00Z |
| Revenue-Projections-2026.xlsx    | 4          | 2              | 2026-03-07T10:00:00Z |
| Cap-Table-Current.xlsx           | 3          | 1              | 2026-03-05T09:30:00Z |
| Certificate-of-Incorporation.pdf | 6          | 3              | 2026-03-10T16:00:00Z |
| Bylaws.pdf                       | 4          | 3              | 2026-03-08T09:00:00Z |
| IP-Assignment-Agreements.pdf     | 2          | 1              | 2026-03-02T11:00:00Z |
| Org-Chart.pptx                   | 5          | 2              | 2026-03-09T14:30:00Z |
| Key-Employee-Bios.docx           | 3          | 2              | 2026-03-04T10:00:00Z |
| Product-Roadmap.pptx             | 4          | 2              | 2026-03-06T15:00:00Z |
| Architecture-Diagram.png         | 3          | 1              | 2026-03-03T12:00:00Z |
| Demo-Video-Link.txt              | 1          | 0              | 2026-02-28T09:00:00Z |
| Due Diligence Checklist.xlsx     | 2          | 2              | 2026-03-08T13:00:00Z |

---

## Cross-Tenant Test Data

For security and multi-tenancy testing, Beta Industries has a separate data room.

### Beta Industries Room: "Beta Internal"

| Field            | Value                        |
| ---------------- | ---------------------------- |
| **Room ID**      | `room_beta_internal`         |
| **Name**         | Beta Internal - Confidential |
| **Organization** | Beta Industries (org_beta)   |
| **Owner**        | admin@beta.example           |
| **Status**       | ACTIVE                       |
| **Created At**   | 2026-02-05T10:00:00Z         |

### Beta Room Documents

| File Name                      | Type  | Size   | Purpose                                 |
| ------------------------------ | ----- | ------ | --------------------------------------- |
| **Beta-Financial-Data.pdf**    | PDF   | 200 KB | Contains Beta Industries financial data |
| **Manufacturing-Process.docx** | Word  | 150 KB | Proprietary process documentation       |
| **Supply-Chain-Diagram.png**   | Image | 500 KB | Supply chain architecture               |

### Beta Room Membership

| User                | Org Role | Room Role   |
| ------------------- | -------- | ----------- |
| admin@beta.example  | OWNER    | Room ADMIN  |
| viewer@beta.example | MEMBER   | Room VIEWER |

### Security Test Cases Using Cross-Tenant Data

**SEC-001: Cross-Tenant Organization Isolation**

- Verify that `admin@acme.example` (OWNER of Acme Corp) cannot see `room_beta_internal`
- Expected: 404 or permission denied error

**SEC-002: Cross-Tenant User Visibility**

- Verify that `admin@acme.example` cannot view `admin@beta.example` in the user list
- Expected: User not found in Acme Corp's user directory

**SEC-003: Cross-Tenant Document Access**

- Verify that `viewer@acme.example` cannot access `Beta-Financial-Data.pdf`
- Expected: 404 or permission denied (with proper org scoping in query)

**SEC-004: Cross-Tenant Link Access**

- Create a shared link for Beta's room
- Verify that Acme users cannot access even via the link
- Expected: Link not found or access denied

**SEC-005: Database Query Isolation**

- Verify that raw database queries include `organizationId` filter
- Expected: Prisma middleware automatically scopes queries to user's org

---

## Seed Script Specification

### Script Location

```
prisma/seed.ts
```

### Execution

```bash
# After database migration
npm run db:seed
```

### Script Behavior

#### Idempotency

The seed script is **idempotent** and can be run multiple times safely:

- **Organizations:** Use `upsert` on `orgId` — if organization exists, do nothing; else create
- **Users:** Use `upsert` on `(email, organizationId)` — if user exists, skip; else create
- **Rooms:** Use `upsert` on `(name, organizationId)` — if room exists, skip; else create
- **Documents:** Use `upsert` on `(name, roomId)` — if document exists, skip; else create
- **Events:** Always append (insert new); never delete or update

#### Password Hashing

All user passwords are bcrypt-hashed with 12 rounds before insertion:

```typescript
import bcrypt from 'bcrypt';

const hashedPassword = await bcrypt.hash('password123', 12);
```

#### File Generation

The script generates placeholder files locally and uploads them to the storage provider (or local disk for dev):

```typescript
// For each document in the spec:
1. Generate a minimal valid file in the correct format
   - PDF: Simple PDF with document title and metadata
   - Excel: XLSX with sheet name and cell data
   - Word: DOCX with paragraph text
   - PowerPoint: PPTX with slides
   - PNG: Simple image (400x300, white background with text)
   - Text: Plain UTF-8 text file

2. Calculate SHA-256 hash of file content

3. Create DocumentVersion record with:
   - fileSha256: calculated hash
   - versionHash: H(versionNumber || fileContent || parentHash)
   - parentVersionHash: null (first version)
   - previewStatus: READY
   - scanStatus: CLEAN
   - mimeType: appropriate type

4. Upload file to storage provider with key:
   "org_acme/rooms/room_series_a/docs/{documentId}/v1.{ext}"

5. Create FileBlob record with storageKey and storageBucket
```

#### Event Generation

Events are created with realistic timestamps spread across 30 days:

```typescript
const eventDates = generateTimestamps(
  new Date('2026-02-01'),
  new Date('2026-03-13'),
  count: 50
);

for (let i = 0; i < events.length; i++) {
  await eventBus.emit(
    eventType,
    { ...eventData, timestamp: eventDates[i] }
  );
}
```

#### Folder Structure Creation

Folders are created recursively with proper parent references:

```typescript
// Create root folders in room
const financialFolder = await db.folder.create({
  data: {
    organizationId: 'org_acme',
    roomId: 'room_series_a',
    name: 'Financial Documents',
    parentFolderId: null,
    displayOrder: 1,
  },
});

// Create nested folders (for V1 expansion)
const subFolder = await db.folder.create({
  data: {
    organizationId: 'org_acme',
    roomId: 'room_series_a',
    name: 'Quarterly Results',
    parentFolderId: financialFolder.id,
    displayOrder: 1,
  },
});
```

### Seed Script Flow

```typescript
async function seed() {
  console.log('Starting VaultSpace seed...');

  // 1. Create organizations
  await seedOrganizations();

  // 2. Create users
  await seedUsers();

  // 3. Create Series A Funding room
  await seedSeriesARoom();

  // 4. Create Beta Industries room (for cross-tenant testing)
  await seedBetaRoom();

  // 5. Generate and upload documents
  await seedDocuments();

  // 6. Create shared links
  await seedSharedLinks();

  // 7. Generate activity history
  await seedActivityHistory();

  console.log('Seed complete!');
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

### Environment Variables Used

```bash
# Storage provider configuration (for file upload)
STORAGE_PROVIDER=local          # local | s3 | azure
STORAGE_LOCAL_PATH=./storage    # For local storage

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/vaultspace

# Optional: Logging level for seed output
SEED_LOG_LEVEL=info             # debug | info | warn | error
```

### Success Criteria

After `npm run db:seed` completes successfully:

```bash
✓ Organizations created (2 orgs)
✓ Users created (8 total: 5 Acme, 2 Beta, 1 disabled)
✓ Rooms created (2 rooms: Series A, Beta Internal)
✓ Folders created (5 folders in Series A, 1 in Beta)
✓ Documents created (12 in Series A, 3 in Beta)
✓ Documents uploaded and scanned (25 total)
✓ Shared links created (3 total: 2 active, 1 expired)
✓ Activity events created (50+ events)
✓ Room memberships created (4 members in Series A, 2 in Beta)
✓ Permissions configured (folder and document-level)

Database state:
  Organizations: 2
  Users: 8
  Rooms: 2
  Documents: 15
  Events: 50+
  Shared Links: 3
```

### Error Handling

If the script encounters errors:

1. **Unique constraint violation:** Skip that record (upsert); log warning
2. **File upload failure:** Fail fast; do not proceed; exit with code 1
3. **Database connection error:** Fail immediately; provide helpful error message
4. **Invalid data:** Log validation error; skip that record; continue

---

## Test Accounts Quick Reference

For developers, a quick reference table of all test accounts and their purposes.

### Acme Corp (org_acme)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ORGANIZATION: Acme Corp (org_acme)                                          │
├──────────────────────────┬──────────────┬────────────────┬──────────────────┤
│ Email                    │ Password     │ Org Role       │ Purpose          │
├──────────────────────────┼──────────────┼────────────────┼──────────────────┤
│ admin@acme.example       │ password123  │ OWNER          │ Full control;    │
│                          │              │                │ create/delete    │
│                          │              │                │ rooms            │
├──────────────────────────┼──────────────┼────────────────┼──────────────────┤
│ manager@acme.example     │ password123  │ ADMIN          │ Manage rooms &   │
│                          │              │                │ members          │
├──────────────────────────┼──────────────┼────────────────┼──────────────────┤
│ member@acme.example      │ password123  │ MEMBER         │ Upload/view in   │
│                          │              │                │ assigned rooms   │
├──────────────────────────┼──────────────┼────────────────┼──────────────────┤
│ viewer@acme.example      │ password123  │ MEMBER         │ Read-only access │
│                          │              │                │ (testing        │
│                          │              │                │ permissions)     │
├──────────────────────────┼──────────────┼────────────────┼──────────────────┤
│ disabled@acme.example    │ password123  │ MEMBER         │ Account disabled │
│                          │              │ (disabled)     │ (test denial)    │
└──────────────────────────┴──────────────┴────────────────┴──────────────────┘
```

### Beta Industries (org_beta)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ORGANIZATION: Beta Industries (org_beta)                                    │
├──────────────────────────┬──────────────┬────────────────┬──────────────────┤
│ Email                    │ Password     │ Org Role       │ Purpose          │
├──────────────────────────┼──────────────┼────────────────┼──────────────────┤
│ admin@beta.example       │ password123  │ OWNER          │ Cross-tenant     │
│                          │              │                │ isolation tests  │
├──────────────────────────┼──────────────┼────────────────┼──────────────────┤
│ viewer@beta.example      │ password123  │ MEMBER         │ Verify Beta user │
│                          │              │                │ cannot see Acme  │
│                          │              │                │ data             │
└──────────────────────────┴──────────────┴────────────────┴──────────────────┘
```

### Test Scenarios by Account

| Scenario                   | Test Account                                             | Notes                                                                    |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Full Admin Workflow**    | admin@acme.example                                       | Can create rooms, manage all documents, invite users, configure settings |
| **Manager Workflow**       | manager@acme.example                                     | Can manage Series A room but cannot touch org settings                   |
| **Member Workflow**        | member@acme.example                                      | Upload documents, limited to assigned rooms                              |
| **Viewer Workflow**        | viewer@acme.example                                      | View only; test permissions (Financial Documents folder has no download) |
| **Disabled User**          | disabled@acme.example                                    | Verify login is rejected; account is disabled                            |
| **Cross-Tenant Isolation** | admin@acme.example + admin@beta.example                  | Verify users cannot see each other's orgs/rooms                          |
| **Permission Denied**      | viewer@acme.example downloading from Financial Documents | Test access denial (403 or similar)                                      |

### Quick Login Instructions

```bash
# Login as admin (full access)
URL: http://localhost:3000/login
Email: admin@acme.example
Password: password123

# Login as viewer (read-only)
Email: viewer@acme.example
Password: password123

# Try disabled user (should fail)
Email: disabled@acme.example
Password: password123
# Expected: Account disabled error

# Access shared link (no login required)
URL: http://localhost:3000/links/{link_id}
# "Investor Review" link: http://localhost:3000/links/link_investor
# "Legal Review" link (password): http://localhost:3000/links/link_legal_review
# Password when prompted: review2026
```

---

## MVP Seed Data Checklist

Use this checklist to verify seed data completeness before marking F143 done.

- [ ] **Organizations**
  - [ ] Acme Corp (org_acme) created
  - [ ] Beta Industries (org_beta) created
  - [ ] Created timestamps are consistent

- [ ] **Users (Acme Corp)**
  - [ ] admin@acme.example (OWNER) created with hashed password
  - [ ] manager@acme.example (ADMIN) created with hashed password
  - [ ] member@acme.example (MEMBER) created with hashed password
  - [ ] viewer@acme.example (MEMBER) created with hashed password
  - [ ] disabled@acme.example (disabled account) created
  - [ ] Passwords bcrypt-hashed (not plaintext)

- [ ] **Users (Beta Industries)**
  - [ ] admin@beta.example (OWNER) created
  - [ ] viewer@beta.example (MEMBER) created

- [ ] **Series A Funding Room**
  - [ ] Room created: "Series A Funding - Q1 2026"
  - [ ] All 5 root folders created
  - [ ] Status is ACTIVE
  - [ ] Owner is admin@acme.example

- [ ] **Sample Documents**
  - [ ] All 12 documents in Series A room exist
  - [ ] Files are uploaded to storage (local or cloud)
  - [ ] Preview status is READY for all documents
  - [ ] Scan status is CLEAN for all documents
  - [ ] Correct mime types set
  - [ ] File sizes populated
  - [ ] View/download counts populated from activity history

- [ ] **Room Permissions**
  - [ ] admin@acme.example (Room ADMIN) - all permissions
  - [ ] manager@acme.example (Room ADMIN) - all permissions
  - [ ] member@acme.example (Room EDITOR) - upload, view, no delete
  - [ ] viewer@acme.example (Room VIEWER) - view only
  - [ ] Financial Documents folder has allowDownload=FALSE
  - [ ] Other folders have allowDownload=TRUE

- [ ] **Shared Links**
  - [ ] "Investor Review" link created (active, 30 days)
  - [ ] "Legal Review" link created (password-protected, 90 days)
  - [ ] "Investor Preview (OLD)" link created (expired)
  - [ ] Link permissions match specification

- [ ] **Activity History**
  - [ ] 50+ events created
  - [ ] Events spread across 30 days
  - [ ] Mix of event types (views, downloads, uploads, link accesses, member additions)
  - [ ] Document view/download counts populated correctly
  - [ ] Last viewed timestamps set correctly

- [ ] **Cross-Tenant Data**
  - [ ] Beta Industries room "Beta Internal" created
  - [ ] 3 documents in Beta room
  - [ ] admin@beta.example is owner
  - [ ] viewer@beta.example is member
  - [ ] Acme users cannot access Beta room (tested)

- [ ] **Script Execution**
  - [ ] Script runs idempotently (can re-run without errors)
  - [ ] Script completes with success message
  - [ ] Database has expected row counts
  - [ ] Files are accessible in storage

- [ ] **End-to-End Verification**
  - [ ] Docker Compose demo launches with seed data
  - [ ] admin@acme.example can log in and see Series A room
  - [ ] viewer@acme.example can log in and see Series A room
  - [ ] viewer@acme.example cannot download Financial Documents
  - [ ] Shared link "Investor Review" is accessible
  - [ ] Expired link returns 404 or "link expired" message
  - [ ] Cross-tenant check passes: admin@acme cannot see Beta data

---

## Appendix: Implementation Notes

### File Generation Details

For developers implementing file generation in the seed script:

#### PDF Generation

Use `pdfkit` or similar library:

```typescript
const PDFDocument = require('pdfkit');
const fs = require('fs');

const doc = new PDFDocument();
doc.fontSize(24).text('Q4 2025 Financial Statements', 100, 100);
doc
  .fontSize(12)
  .text(
    'Acme Corp\nConsolidated Financial Statements\nFor the Quarter Ended December 31, 2025',
    100,
    150
  );
// ... add more pages
doc.pipe(fs.createWriteStream('Q4-2025-Financial-Statements.pdf'));
doc.end();
```

#### Excel Generation

Use `xlsx` library:

```typescript
const XLSX = require('xlsx');

const workbook = XLSX.utils.book_new();
const worksheet = XLSX.utils.aoa_to_sheet([
  ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'],
  [1000000, 1200000, 1400000, 1600000],
]);
XLSX.utils.book_append_sheet(workbook, worksheet, 'Projections');
XLSX.writeFile(workbook, 'Revenue-Projections-2026.xlsx');
```

#### Word Document Generation

Use `docx` library:

```typescript
const { Document, Packer, Paragraph, TextRun } = require('docx');

const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph({
          children: [new TextRun({ text: 'Key Employee Bios', bold: true, size: 32 })],
        }),
        new Paragraph('CEO - Jane Smith\nCTO - John Doe\n...'),
      ],
    },
  ],
});

Packer.toFile(doc, 'Key-Employee-Bios.docx');
```

#### PowerPoint Generation

Use `pptxgen` library:

```typescript
const PptxGenJS = require('pptxgen.js');

const pres = new PptxGenJS();
const slide = pres.addSlide();
slide.addText('Product Roadmap', { x: 0.5, y: 0.5, fontSize: 44, bold: true });
slide.addText('Q1-Q4 2026 Milestones', { x: 0.5, y: 1.5, fontSize: 24 });
// ... add more slides
pres.save({ path: 'Product-Roadmap.pptx' });
```

#### Image Generation

Generate simple PNG with text:

```typescript
const Canvas = require('canvas');
const fs = require('fs');

const canvas = Canvas.createCanvas(400, 300);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, 400, 300);
ctx.fillStyle = '#000000';
ctx.font = '20px Arial';
ctx.fillText('Architecture Diagram', 50, 50);
// ... draw diagram elements

fs.writeFileSync('Architecture-Diagram.png', canvas.toBuffer());
```

### Storage Provider Integration

The seed script must integrate with the configured storage provider:

```typescript
async function uploadDocument(
  org: Organization,
  room: Room,
  document: Document,
  fileBuffer: Buffer
): Promise<FileBlob> {
  const storageKey = `${org.id}/rooms/${room.id}/docs/${document.id}/v1.pdf`;

  // Use provider interface (not direct SDK calls)
  const fileBlob = await storageProvider.upload({
    bucket: 'documents',
    key: storageKey,
    body: fileBuffer,
    metadata: {
      organizationId: org.id,
      documentId: document.id,
    },
  });

  return fileBlob;
}
```

### Database Connection Considerations

The seed script connects directly to PostgreSQL (not via Prisma when possible) for bulk inserts, then uses Prisma for relations:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Use raw SQL for bulk inserts if performance matters
await prisma.$executeRaw`
  INSERT INTO organization (id, name, tier, created_at, updated_at)
  VALUES ('org_acme', 'Acme Corp', 'pro', NOW(), NOW())
  ON CONFLICT(id) DO NOTHING;
`;

// Use Prisma ORM for subsequent operations
const org = await prisma.organization.findUnique({ where: { id: 'org_acme' } });
```

---

## Document Revision History

| Version | Date       | Changes                            |
| ------- | ---------- | ---------------------------------- |
| 1.0     | 2026-03-14 | Initial specification for MVP F143 |
