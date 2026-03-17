# VaultSpace MVP QA Test Plan

## Overview

This document contains comprehensive QA tests for all 63 MVP features defined in `dataroom-feature-matrix-v6.md`. Tests are organized by functional area and include manual test steps with expected results.

**Test Environment:** https://www.vaultspace.org (Azure Container Apps deployment)

---

## Test Execution Checklist

### Legend
- [ ] Not tested
- [x] Passed
- [!] Failed
- [~] Partial/Blocked

---

## Section 1: Authentication & User Management

### T001: User Registration (F004, F142)
**Feature:** Role separation: admin vs. viewer; Multi-tenant organization model

**Preconditions:** None

**Test Steps:**
1. Navigate to /auth/register
2. Enter organization name, user details, email, password
3. Submit registration form
4. Verify email confirmation (if enabled)

**Expected Results:**
- [ ] Registration form displays all required fields
- [ ] Form validates email format, password strength
- [ ] New organization is created
- [ ] User is created as ADMIN of their organization
- [ ] User is redirected to dashboard after registration

---

### T002: User Login (F105)
**Feature:** Session management

**Preconditions:** Registered user exists

**Test Steps:**
1. Navigate to /auth/login
2. Enter valid email and password
3. Submit login form

**Expected Results:**
- [ ] Login form displays email and password fields
- [ ] Successful login redirects to dashboard
- [ ] Session cookie is set
- [ ] User data is available in session

---

### T003: Password Reset (F105)
**Feature:** Session management

**Preconditions:** Registered user exists

**Test Steps:**
1. Navigate to /auth/forgot-password
2. Enter registered email
3. Submit form
4. Check email for reset link
5. Navigate to reset link
6. Enter new password
7. Login with new password

**Expected Results:**
- [ ] Forgot password form accepts email
- [ ] Reset email is sent
- [ ] Reset link works and allows password change
- [ ] New password works for login

---

### T004: Logout (F105)
**Feature:** Session management

**Preconditions:** User is logged in

**Test Steps:**
1. Click logout button/link
2. Attempt to access protected route

**Expected Results:**
- [ ] User is logged out
- [ ] Session is invalidated
- [ ] Protected routes redirect to login

---

### T005: Team Member Invite (F044)
**Feature:** Team member invite and role assignment

**Preconditions:** Admin user logged in, organization exists

**Test Steps:**
1. Navigate to Settings > Organization or Room settings
2. Click "Invite User" or "Add Admin"
3. Enter email address
4. Submit invitation

**Expected Results:**
- [ ] Invitation form displays
- [ ] Invitation is sent/user is added
- [ ] New member appears in member list
- [ ] Invited user can access organization

---

### T006: Multi-Admin Support (F039)
**Feature:** Multi-admin support

**Preconditions:** Organization with multiple admin users

**Test Steps:**
1. Add second admin to organization
2. Login as second admin
3. Verify all admin capabilities

**Expected Results:**
- [ ] Multiple admins can exist
- [ ] All admins have full admin capabilities
- [ ] Admin actions are tracked

---

### T007: User Group Management (F020)
**Feature:** User group management

**Preconditions:** Admin user logged in

**Test Steps:**
1. Navigate to Groups section
2. Create new group
3. Add users to group
4. Assign group to room with permissions
5. Verify group members have access

**Expected Results:**
- [ ] Groups can be created
- [ ] Users can be added to groups
- [ ] Groups can be assigned permissions
- [ ] Group permissions cascade to members

---

## Section 2: Room Management

### T008: Room Creation (F108)
**Feature:** Room lifecycle management

**Preconditions:** Admin user logged in

**Test Steps:**
1. Navigate to Rooms
2. Click "Create Room"
3. Enter room name, description
4. Select room template (optional)
5. Submit

**Expected Results:**
- [ ] Room creation form displays
- [ ] Room is created successfully
- [ ] Room appears in room list
- [ ] Room is in ACTIVE status

---

### T009: Room Templates (F109)
**Feature:** Room templates (M&A, investor, board, compliance, custom)

**Preconditions:** Admin user logged in

**Test Steps:**
1. Create new room
2. Select from available templates
3. Verify template structure is applied

**Expected Results:**
- [ ] Template options are available
- [ ] Selected template pre-creates folder structure
- [ ] Template settings are applied to room

---

### T010: Room Settings (F130)
**Feature:** Configurable room-level settings

**Preconditions:** Room exists, admin logged in

**Test Steps:**
1. Navigate to room > Settings
2. Modify room settings (watermark, download, etc.)
3. Save changes
4. Verify settings are applied

**Expected Results:**
- [ ] Room settings page displays
- [ ] Settings can be modified
- [ ] Changes persist after save
- [ ] Settings affect room behavior

---

### T011: Room Lifecycle States (F108)
**Feature:** Room lifecycle management (draft, active, archived, closed)

**Preconditions:** Room exists

**Test Steps:**
1. Create room (verify ACTIVE state)
2. Archive room
3. Verify archived behavior
4. Close room (if applicable)

**Expected Results:**
- [ ] Rooms can be archived
- [ ] Archived rooms are read-only
- [ ] Room status is displayed correctly

---

### T012: Room Activity Dashboard (F121)
**Feature:** Room activity summary dashboard

**Preconditions:** Room with activity exists

**Test Steps:**
1. Navigate to room > Analytics or Activity tab
2. View activity summary

**Expected Results:**
- [ ] Activity metrics display
- [ ] Document views, downloads shown
- [ ] Recent activity timeline visible

---

## Section 3: Document Management

### T013: Document Upload (F006, F007)
**Feature:** Bulk upload with folder structure preservation; Drag-and-drop upload

**Preconditions:** Room exists, admin logged in

**Test Steps:**
1. Navigate to room > Documents
2. Click Upload Files button
3. Select multiple files via file picker
4. Alternatively, drag files into upload zone
5. Wait for upload completion

**Expected Results:**
- [ ] Upload dialog/zone displays
- [ ] Files can be selected via picker
- [ ] Drag-and-drop works
- [ ] Upload progress is shown
- [ ] Files appear in document list after upload

---

### T014: Multi-Format Support (F009)
**Feature:** Multi-format support (PDF, DOCX, XLSX, PPTX, images)

**Preconditions:** Room exists

**Test Steps:**
1. Upload PDF file
2. Upload DOCX file
3. Upload XLSX file
4. Upload image file (PNG, JPG)
5. Verify all files are accepted and processed

**Expected Results:**
- [ ] PDF uploads successfully
- [ ] DOCX uploads successfully
- [ ] XLSX uploads successfully
- [ ] Images upload successfully
- [ ] All formats show correct preview/icon

---

### T015: Document Preview (F008)
**Feature:** In-browser document viewer (no download required)

**Preconditions:** Documents uploaded

**Test Steps:**
1. Click on a PDF document
2. Verify preview displays
3. Click on an image
4. Verify image displays
5. Try preview for other formats

**Expected Results:**
- [ ] PDF preview opens in dialog
- [ ] Image preview displays correctly
- [ ] Preview navigation works (if multi-page)
- [ ] Close button works

---

### T016: Document Download (F014)
**Feature:** Download enable/disable per document

**Preconditions:** Documents exist, download enabled

**Test Steps:**
1. Click download button on document
2. Verify file downloads
3. Check downloaded file matches original

**Expected Results:**
- [ ] Download button is available
- [ ] File downloads with correct name
- [ ] Downloaded file is complete/valid

---

### T017: Document Delete (F114)
**Feature:** Trash/soft delete with recovery

**Preconditions:** Documents exist

**Test Steps:**
1. Select document
2. Click Delete
3. Confirm deletion
4. Navigate to Trash
5. Verify document appears in trash
6. Restore document

**Expected Results:**
- [ ] Delete option available
- [ ] Confirmation dialog appears
- [ ] Document removed from main list
- [ ] Document appears in Trash
- [ ] Document can be restored

---

### T018: Document Version Control (F002)
**Feature:** Document version control with revision history

**Preconditions:** Document exists

**Test Steps:**
1. Upload new version of existing document
2. View version history
3. Access previous version

**Expected Results:**
- [ ] Version upload works
- [ ] Version history is available
- [ ] Previous versions accessible
- [ ] Version numbers increment correctly

---

### T019: Document Indexing (F010)
**Feature:** Document indexing and auto-numbering

**Preconditions:** Documents uploaded to room

**Test Steps:**
1. View document list
2. Check for index numbers
3. Verify ordering

**Expected Results:**
- [ ] Documents have index numbers
- [ ] Numbers are consistent
- [ ] Ordering is logical

---

### T020: Document Tagging (F110)
**Feature:** Document tagging and custom metadata

**Preconditions:** Documents exist

**Test Steps:**
1. Select document
2. Add tags/metadata
3. Save changes
4. Filter/search by tags

**Expected Results:**
- [ ] Tags can be added
- [ ] Custom metadata supported
- [ ] Tags are saved
- [ ] Filtering by tags works

---

### T021: File Integrity (F106)
**Feature:** File integrity verification (hash on upload)

**Preconditions:** Upload enabled

**Test Steps:**
1. Upload a file
2. Verify hash is computed and stored
3. Check file integrity on download

**Expected Results:**
- [ ] Files have hash computed
- [ ] Hash is stored with file metadata
- [ ] Integrity can be verified

---

### T022: Virus Scanning (F107)
**Feature:** Virus/malware scanning on upload

**Preconditions:** ClamAV service running

**Test Steps:**
1. Upload clean file
2. Verify file passes scan
3. Verify file becomes available

**Expected Results:**
- [ ] Files are scanned on upload
- [ ] Clean files become available
- [ ] Scan status is trackable

---

### T023: OCR for Scanned Documents (F132)
**Feature:** Basic OCR for scanned documents (Tesseract)

**Preconditions:** Scanned PDF uploaded

**Test Steps:**
1. Upload scanned PDF
2. Wait for processing
3. Search for text within scanned document

**Expected Results:**
- [ ] Scanned PDFs are processed
- [ ] Text is extracted via OCR
- [ ] Extracted text is searchable

---

## Section 4: Folder Management

### T024: Folder Creation (F006)
**Feature:** Bulk upload with folder structure preservation

**Preconditions:** Room exists

**Test Steps:**
1. Navigate to room > Documents
2. Click "New Folder"
3. Enter folder name
4. Create folder

**Expected Results:**
- [ ] New Folder button works
- [ ] Folder dialog appears
- [ ] Folder is created
- [ ] Folder appears in list

---

### T025: Folder Navigation (F124)
**Feature:** Breadcrumb navigation in folder hierarchy

**Preconditions:** Nested folders exist

**Test Steps:**
1. Navigate into folder
2. Navigate into subfolder
3. Use breadcrumbs to navigate back
4. Click root breadcrumb

**Expected Results:**
- [ ] Folders are clickable
- [ ] Breadcrumbs display path
- [ ] Breadcrumb clicks navigate correctly
- [ ] Path updates on navigation

---

### T026: Folder Delete (F114)
**Feature:** Trash/soft delete with recovery

**Preconditions:** Folder with documents exists

**Test Steps:**
1. Select folder from dropdown menu
2. Click Delete
3. Confirm deletion
4. Verify folder removed
5. Verify documents moved to trash

**Expected Results:**
- [ ] Folder delete option available
- [ ] Confirmation dialog appears
- [ ] Folder is removed
- [ ] Documents are soft-deleted (in trash)

---

### T027: Per-Folder Access Controls (F005)
**Feature:** Per-document and per-folder access controls

**Preconditions:** Folders exist, groups/users available

**Test Steps:**
1. Set permissions on specific folder
2. Login as user with folder access
3. Verify access to folder
4. Verify no access to other folders

**Expected Results:**
- [ ] Folder permissions can be set
- [ ] Permissions are enforced
- [ ] Users only see permitted folders

---

## Section 5: Share Links

### T028: Create Share Link (F116)
**Feature:** Granular link permissions (per-link expiry, password, access scope)

**Preconditions:** Room exists

**Test Steps:**
1. Navigate to room > Share Links tab
2. Click "Create Link"
3. Enter link name
4. Select permission level (View/Download)
5. Create link
6. Copy link URL

**Expected Results:**
- [ ] Create Link button works
- [ ] Link creation dialog appears
- [ ] Link is created successfully
- [ ] Link URL is generated
- [ ] Link appears in list

---

### T029: Link-Based Access (F035)
**Feature:** No account required for viewers (link-based)

**Preconditions:** Share link created

**Test Steps:**
1. Open link URL in incognito/new browser
2. Verify access to room content
3. View documents
4. Try download (if permitted)

**Expected Results:**
- [ ] Link opens viewer interface
- [ ] No login required
- [ ] Documents are viewable
- [ ] Permissions are enforced

---

### T030: Password-Protected Links (F017)
**Feature:** Password-protected rooms and links

**Preconditions:** Link with password exists

**Test Steps:**
1. Create link with password protection
2. Open link in new session
3. Enter password
4. Access content

**Expected Results:**
- [ ] Password option available on link creation
- [ ] Link requires password
- [ ] Correct password grants access
- [ ] Wrong password denies access

---

### T031: Email Verification (F016)
**Feature:** Email verification before access

**Preconditions:** Link with email verification

**Test Steps:**
1. Create link with email verification required
2. Access link
3. Enter email
4. Receive verification email
5. Complete verification

**Expected Results:**
- [ ] Email verification option available
- [ ] Email prompt appears for viewers
- [ ] Verification email sent
- [ ] Verification grants access

---

### T032: Link Expiration (F116)
**Feature:** Granular link permissions (per-link expiry)

**Preconditions:** Link with expiration

**Test Steps:**
1. Create link with expiration date
2. Access link before expiry (should work)
3. Wait for expiry or modify date
4. Access expired link (should fail)

**Expected Results:**
- [ ] Expiration option available
- [ ] Links work before expiry
- [ ] Expired links are denied

---

### T033: Link Delete (F116)
**Feature:** Share link management

**Preconditions:** Links exist

**Test Steps:**
1. View link in list
2. Click Delete
3. Confirm deletion
4. Try accessing deleted link

**Expected Results:**
- [ ] Delete option available
- [ ] Link is removed from list
- [ ] Deleted link no longer works

---

### T034: Copy Link (F116)
**Feature:** Share link management

**Preconditions:** Link exists

**Test Steps:**
1. Click Copy Link
2. Paste into browser
3. Verify link works

**Expected Results:**
- [ ] Copy function works
- [ ] Correct URL is copied
- [ ] Link is functional

---

## Section 6: Audit & Activity

### T035: Audit Trail (F025)
**Feature:** Audit trail of all user activity

**Preconditions:** Room with activity

**Test Steps:**
1. Perform actions (view, download, etc.)
2. Navigate to room > Activity tab
3. View audit events

**Expected Results:**
- [ ] Actions are logged
- [ ] Events display actor and timestamp
- [ ] Event details are accurate

---

### T036: Admin Activity Log (F040)
**Feature:** Admin activity log

**Preconditions:** Admin actions performed

**Test Steps:**
1. Navigate to Settings > Activity
2. View admin activities
3. Filter by type/date

**Expected Results:**
- [ ] Admin log exists
- [ ] Admin actions are recorded
- [ ] Filtering works

---

## Section 7: Notifications

### T037: Email Notifications (F003, F059)
**Feature:** Email notifications on document view/update; SMTP-agnostic email

**Preconditions:** Email configured, notification preferences set

**Test Steps:**
1. Enable notifications for document events
2. Have someone view/download document
3. Check email for notification

**Expected Results:**
- [ ] Notifications can be enabled
- [ ] Emails are sent for events
- [ ] Email content is correct

---

### T038: Notification Preferences (F043)
**Feature:** Notification preferences per admin user

**Preconditions:** Admin logged in

**Test Steps:**
1. Navigate to Settings > Notifications
2. Modify preferences
3. Save changes
4. Trigger events
5. Verify preference enforcement

**Expected Results:**
- [ ] Preferences page exists
- [ ] Options are configurable
- [ ] Preferences are saved
- [ ] Notifications respect preferences

---

## Section 8: UI/UX

### T039: Mobile Responsive Viewer (F034)
**Feature:** Mobile-responsive document viewer

**Preconditions:** Share link available

**Test Steps:**
1. Open viewer on mobile device/responsive mode
2. Navigate documents
3. View document preview
4. Test all interactions

**Expected Results:**
- [ ] UI adapts to mobile screen
- [ ] All features accessible
- [ ] Touch interactions work
- [ ] Documents are viewable

---

### T040: Branded Viewer (F033)
**Feature:** Branded viewer with no third-party branding

**Preconditions:** Share link exists

**Test Steps:**
1. Access viewer via share link
2. Inspect branding
3. Verify no third-party logos

**Expected Results:**
- [ ] Viewer shows VaultSpace/custom branding
- [ ] No external service branding visible
- [ ] Professional appearance

---

### T041: Admin Setup Wizard (F128)
**Feature:** Admin setup wizard (first-run configuration)

**Preconditions:** Fresh installation or setup not complete

**Test Steps:**
1. Access setup page
2. Complete wizard steps
3. Verify configuration applied

**Expected Results:**
- [ ] Setup wizard accessible
- [ ] All steps completable
- [ ] Configuration persists

---

## Section 9: Export & Backup

### T042: Room ZIP Export (F113)
**Feature:** Archive/export entire room as ZIP

**Preconditions:** Room with documents exists

**Test Steps:**
1. Navigate to room
2. Find export/archive option
3. Export room as ZIP
4. Download and verify contents

**Expected Results:**
- [ ] Export option available
- [ ] ZIP is generated
- [ ] ZIP contains all documents
- [ ] Folder structure preserved

---

### T043: Backup/Restore (F137)
**Feature:** Backup and restore tooling

**Preconditions:** Admin access, data exists

**Test Steps:**
1. Run backup procedure
2. Verify backup created
3. Test restore (if possible in test env)

**Expected Results:**
- [ ] Backup can be created
- [ ] Backup contains all data
- [ ] Restore procedure works

---

## Section 10: Infrastructure & Deployment

### T044: Docker Compose Deployment (F062)
**Feature:** Docker Compose single-command deployment

**Preconditions:** Docker installed

**Test Steps:**
1. Run docker compose up
2. Verify all services start
3. Access application

**Expected Results:**
- [ ] docker compose up works
- [ ] All services start
- [ ] Application accessible

---

### T045: Environment Configuration (F063)
**Feature:** Environment variable-based configuration

**Preconditions:** .env file exists

**Test Steps:**
1. Review .env.example
2. Configure required variables
3. Start application
4. Verify configuration applied

**Expected Results:**
- [ ] .env.example documents all variables
- [ ] Required vars are validated
- [ ] Configuration is applied

---

### T046: Database Migrations (F068)
**Feature:** Automated database migrations on upgrade

**Preconditions:** Database running

**Test Steps:**
1. Run migration command
2. Verify schema updates
3. Check migration history

**Expected Results:**
- [ ] Migrations run without error
- [ ] Schema is correct
- [ ] Migration history tracked

---

### T047: Custom Domain (F001)
**Feature:** Custom domain support

**Preconditions:** DNS configured

**Test Steps:**
1. Configure custom domain
2. Access via custom domain
3. Verify SSL works

**Expected Results:**
- [ ] Custom domain accessible
- [ ] SSL certificate valid
- [ ] All features work on custom domain

---

### T048: Rate Limiting (F104)
**Feature:** Rate limiting and abuse prevention

**Preconditions:** API accessible

**Test Steps:**
1. Make rapid API requests
2. Verify rate limit kicks in
3. Wait and verify access restored

**Expected Results:**
- [ ] Rate limits are enforced
- [ ] Error message indicates rate limit
- [ ] Access restored after cooldown

---

## Section 11: Permission System

### T049: Permission Engine (F141)
**Feature:** Centralized permission engine

**Preconditions:** Various users/roles exist

**Test Steps:**
1. Test org admin access (full)
2. Test room admin access (room-scoped)
3. Test viewer access (view only)
4. Test group-based permissions

**Expected Results:**
- [ ] Org admins have full access
- [ ] Room admins scoped to rooms
- [ ] Viewers limited appropriately
- [ ] Groups grant correct access

---

### T050: Per-User Permissions (F019)
**Feature:** Per-user and per-group permission levels

**Preconditions:** Users and groups exist

**Test Steps:**
1. Set specific user permissions
2. Verify user has only granted access
3. Set group permissions
4. Verify group members inherit

**Expected Results:**
- [ ] User-level permissions work
- [ ] Permissions are enforced
- [ ] Group inheritance works

---

## Section 12: GDPR & Compliance

### T051: GDPR Compliance (F052)
**Feature:** GDPR-compliant data handling and deletion

**Preconditions:** User data exists

**Test Steps:**
1. Request data export (if implemented)
2. Request data deletion
3. Verify data is deleted

**Expected Results:**
- [ ] Data export possible
- [ ] Data can be deleted
- [ ] Deletion is complete

---

## Section 13: Demo & Documentation

### T052: Demo Seed Data (F143)
**Feature:** Demo seed data and sample room

**Preconditions:** Fresh database

**Test Steps:**
1. Run seed command
2. Login with demo credentials
3. Verify demo room exists

**Expected Results:**
- [ ] Seed command works
- [ ] Demo organization created
- [ ] Demo room with documents exists

---

### T053: Documentation Files (F146-F155)
**Feature:** All documentation files

**Test Steps:**
1. Verify CONTRIBUTING.md exists
2. Verify SECURITY.md exists
3. Verify ARCHITECTURE.md exists
4. Verify CODE_OF_CONDUCT.md exists
5. Verify DATABASE_SCHEMA.md exists
6. Verify EVENT_MODEL.md exists
7. Verify PERMISSION_MODEL.md exists
8. Verify DEPLOYMENT.md exists

**Expected Results:**
- [ ] All documentation files present
- [ ] Content is accurate
- [ ] Files are up to date

---

## Test Summary

| Section | Tests | Passed | Failed | Blocked |
|---------|-------|--------|--------|---------|
| Authentication | 7 | | | |
| Room Management | 5 | | | |
| Document Management | 11 | | | |
| Folder Management | 4 | | | |
| Share Links | 7 | | | |
| Audit & Activity | 2 | | | |
| Notifications | 2 | | | |
| UI/UX | 3 | | | |
| Export & Backup | 2 | | | |
| Infrastructure | 5 | | | |
| Permission System | 2 | | | |
| GDPR & Compliance | 1 | | | |
| Demo & Documentation | 2 | | | |
| **TOTAL** | **53** | | | |

---

## Automated Test Commands

```bash
# Run all tests
npm run test

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Type check
npm run type-check

# Lint
npm run lint
```

---

## Critical Path Tests (Smoke Test)

For quick validation, run these tests in order:

1. **T002** - Login
2. **T008** - Create Room
3. **T013** - Upload Document
4. **T015** - Preview Document
5. **T016** - Download Document
6. **T024** - Create Folder
7. **T026** - Delete Folder
8. **T028** - Create Share Link
9. **T029** - Access Share Link (viewer)
10. **T017** - Delete Document

If all 10 pass, basic MVP functionality is confirmed.

---

## Notes

- Tests should be run in a dedicated test environment when possible
- Some tests may require specific infrastructure (ClamAV for virus scanning)
- Mobile tests require actual device or browser dev tools responsive mode
- Rate limit tests may require waiting between runs
