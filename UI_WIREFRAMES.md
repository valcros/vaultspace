# VaultSpace - UI Wireframes & Specification

**Status:** MVP Specification
**Last Updated:** 2026-03-14
**Version:** 1.0
**Scope:** Complete UI specification for MVP implementation

---

## Table of Contents

1. [Design System Tokens](#design-system-tokens)
2. [Page Map](#page-map)
3. [Component Hierarchy & Wireframes](#component-hierarchy--wireframes)
4. [User Flows](#user-flows)
5. [Component Library](#component-library)
6. [Accessibility Requirements](#accessibility-requirements)
7. [Responsive Breakpoints](#responsive-breakpoints)

---

## Design System Tokens

### Color Palette

All colors are defined for light theme only. Dark mode is NOT in MVP scope.

| Token             | Hex       | Usage                                        |
| ----------------- | --------- | -------------------------------------------- |
| **Primary Blue**  | `#2563eb` | Primary actions, links, active states        |
| **Primary Dark**  | `#1e40af` | Hover state for primary buttons              |
| **Accent Teal**   | `#14b8a6` | Success highlights, secondary actions        |
| **Success Green** | `#10b981` | Success states, checkmarks, positive actions |
| **Warning Amber** | `#f59e0b` | Warnings, pending states, cautions           |
| **Danger Red**    | `#ef4444` | Errors, deletions, dangerous actions         |
| **Neutral 50**    | `#f9fafb` | Background, page background                  |
| **Neutral 100**   | `#f3f4f6` | Card backgrounds, section backgrounds        |
| **Neutral 200**   | `#e5e7eb` | Borders, dividers                            |
| **Neutral 400**   | `#9ca3af` | Secondary text, placeholders                 |
| **Neutral 600**   | `#4b5563` | Body text, default text                      |
| **Neutral 900**   | `#111827` | Headings, primary text                       |
| **White**         | `#ffffff` | Card backgrounds, input fields               |

### Typography

**Font Stack:**

- **Headings:** Inter (sans-serif), weights 600-700
- **Body:** Inter (sans-serif) fallback to system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif`)
- **Monospace:** `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Courier, monospace`

**Size Scale:**

| Token  | Size (px) | Line Height | Usage                             |
| ------ | --------- | ----------- | --------------------------------- |
| `xs`   | 12        | 1.33 (16px) | Small labels, badges, helper text |
| `sm`   | 14        | 1.43 (20px) | Secondary text, form labels       |
| `base` | 16        | 1.5 (24px)  | Body text, default                |
| `lg`   | 18        | 1.56 (28px) | Emphasis text, secondary headings |
| `xl`   | 20        | 1.6 (32px)  | Section headings                  |
| `2xl`  | 24        | 1.33 (32px) | Page headings, modal titles       |
| `3xl`  | 30        | 1.2 (36px)  | Main page titles, hero sections   |

**Font Weights:** 400 (regular), 500 (medium), 600 (semibold), 700 (bold)

### Spacing Scale

4px base unit. Values follow Tailwind convention:

| Token | Value (px) | Usage                               |
| ----- | ---------- | ----------------------------------- |
| 1     | 4          | Minimal spacing (icon gaps)         |
| 2     | 8          | Compact spacing (input padding)     |
| 3     | 12         | Default spacing (component margins) |
| 4     | 16         | Standard spacing (section padding)  |
| 6     | 24         | Larger spacing (card padding)       |
| 8     | 32         | Section spacing                     |
| 12    | 48         | Large section spacing               |
| 16    | 64         | Page-level spacing                  |

### Border Radius

| Token  | Value (px) | Usage                                    |
| ------ | ---------- | ---------------------------------------- |
| `sm`   | 4          | Small form elements, badges              |
| `md`   | 8          | Default (buttons, cards, inputs)         |
| `lg`   | 12         | Large panels, modals                     |
| `full` | 9999       | Circular avatars, pills, toggle switches |

### Shadows

| Token | CSS                                                                 | Usage                            |
| ----- | ------------------------------------------------------------------- | -------------------------------- |
| `sm`  | `0 1px 2px 0 rgba(0,0,0,0.05)`                                      | Subtle elevation, hover states   |
| `md`  | `0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)`   | Default card shadow              |
| `lg`  | `0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)` | Modal, dropdown, elevated panels |

### TailwindCSS Configuration

```typescript
// tailwind.config.ts
export default {
  content: ['./src/app/**/*.{js,ts,jsx,tsx}', './src/components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2563eb',
          dark: '#1e40af',
        },
        accent: '#14b8a6',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        neutral: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          400: '#9ca3af',
          600: '#4b5563',
          900: '#111827',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Cantarell',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Courier', 'monospace'],
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '28px' }],
        xl: ['20px', { lineHeight: '32px' }],
        '2xl': ['24px', { lineHeight: '32px' }],
        '3xl': ['30px', { lineHeight: '36px' }],
      },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
        16: '64px',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(0,0,0,0.05)',
        md: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
        lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
      },
    },
  },
  plugins: [],
};
```

---

## Page Map

Complete route tree for MVP application.

### Authentication Routes

| Route                            | Page Title       | Purpose                                          |
| -------------------------------- | ---------------- | ------------------------------------------------ |
| `/auth/login`                    | Login            | User login with email + password                 |
| `/auth/register`                 | Sign Up          | New admin user registration (if enabled)         |
| `/auth/forgot-password`          | Reset Password   | Password recovery via email                      |
| `/auth/reset-password?token=...` | Set New Password | Complete password reset                          |
| `/auth/verify-email?token=...`   | Verify Email     | Confirm email address (auto-redirect on success) |
| `/auth/logout`                   | (Redirect)       | Clear session, redirect to login                 |

### Admin Routes

All admin routes require authenticated session with admin role.

**Room Management:**

| Route                             | Page Title                  | Purpose                                                        |
| --------------------------------- | --------------------------- | -------------------------------------------------------------- |
| `/admin/rooms`                    | Rooms                       | List all rooms with search, filter, create                     |
| `/admin/rooms/[roomId]`           | Room Detail (Documents tab) | View/manage room, default to documents                         |
| `/admin/rooms/[roomId]/documents` | Documents                   | Upload, organize, manage documents                             |
| `/admin/rooms/[roomId]/members`   | Members                     | Manage room users, roles, permissions                          |
| `/admin/rooms/[roomId]/links`     | Share Links                 | Create, configure, revoke share links                          |
| `/admin/rooms/[roomId]/activity`  | Activity Log                | View room-level activity timeline                              |
| `/admin/rooms/[roomId]/settings`  | Room Settings               | Configure room name, description, status, templates, retention |
| `/admin/rooms/[roomId]/audit`     | Audit Trail                 | Export audit events, compliance reports                        |

**User & Organization Management:**

| Route             | Page Title            | Purpose                                                   |
| ----------------- | --------------------- | --------------------------------------------------------- |
| `/admin/users`    | Users                 | Manage admin users, invitations, roles                    |
| `/admin/groups`   | Groups                | Create, manage user groups for bulk permissions           |
| `/admin/activity` | Organization Activity | Global activity dashboard, search, export                 |
| `/admin/settings` | Organization Settings | Domain, branding, email, integrations, retention policies |

**Onboarding:**

| Route    | Page Title   | Purpose                                                 |
| -------- | ------------ | ------------------------------------------------------- |
| `/setup` | Setup Wizard | First-run configuration (steps: admin, org, room, done) |

### Viewer Routes

Routes for link-based document viewers (no authentication required).

| Route                                  | Page Title           | Purpose                                                   |
| -------------------------------------- | -------------------- | --------------------------------------------------------- |
| `/view/[shareToken]`                   | Access Gate / Verify | Email/password gate, or direct to docs if no restrictions |
| `/view/[shareToken]/verify`            | Email Verification   | Verify email before access                                |
| `/view/[shareToken]/documents`         | Document List        | List documents in shared room                             |
| `/view/[shareToken]/documents/[docId]` | Document Viewer      | In-browser PDF/document viewer with page nav              |

### Public Routes

| Route     | Page Title      | Purpose                                                     |
| --------- | --------------- | ----------------------------------------------------------- |
| `/`       | Home / Redirect | Redirect to login if not authenticated, else `/admin/rooms` |
| `/health` | Health Check    | (API route for monitoring, serves JSON)                     |

---

## Component Hierarchy & Wireframes

### 1. Application Shell Layout

All authenticated pages use a consistent layout:

```
┌─────────────────────────────────────────────────────────┐
│  VaultSpace Logo │ Rooms │ Users │ Groups │ Settings  │ ⚙️ Profile ▼
├──────────────────────────────────────────────────────────┤
│                                                          │
│  [Breadcrumb or Page Title Bar]                          │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │                                                    │  │
│ │  [Page Content - varies by route]                 │  │
│ │                                                    │  │
│ │                                                    │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘

Responsive:
- Mobile (< 768px): Top nav becomes hamburger menu; sidebar collapses
- Tablet (768-1024px): Sidebar collapses on scroll; icon-only nav visible
- Desktop (> 1024px): Full sidebar nav visible
```

**Header Component:**

- Logo (32x32 px) on left
- Horizontal nav: Rooms, Users, Groups, Settings (active highlighted with underline)
- Right-aligned: Profile menu (name + avatar dropdown with Logout option)
- Height: 64px, background white, border-bottom: 1px solid neutral-200

**Main Navigation (Desktop):**

- Left sidebar, sticky, width 256px
- Logo + project name at top (48px height)
- Nav items with icons: Rooms, Users, Groups, Activity, Settings
- Current route highlighted with primary-blue background, white text
- Hover: light background (neutral-100)
- Spacing: 4px vertical between items
- Fixed bottom: User profile card with avatar, name, email, logout link

### 2. Admin Dashboard - Room List (`/admin/rooms`)

```
┌───────────────────────────────────────────────────────────┐
│ Rooms │ Users │ Groups │ Activity │ Settings          │ 👤 │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  [Search box: "Search rooms..."]  [+ Create Room]        │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Filter: [All ▼] [Status ▼] [Last Activity ▼]       │ │
│  │ Sort: [Name ▼] [Last Activity ▼]                   │ │
│  │ View: [Grid] [List] (toggle icons)                 │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Room Card    │  │ Room Card    │  │ Room Card    │   │
│  │              │  │              │  │              │   │
│  │ Series A ... │  │ M&A Process  │  │ Board ...    │   │
│  │ 📄 12 docs   │  │ 📄 24 docs   │  │ 📄 8 docs    │   │
│  │ 👥 4 members │  │ 👥 7 members │  │ 👥 3 members │   │
│  │ 👁️ 42 views  │  │ 👁️ 156 views │  │ 👁️ 18 views  │   │
│  │              │  │              │  │              │   │
│  │ Status: ●... │  │ Status: ●... │  │ Status: ●... │   │
│  │ Updated ...  │  │ Updated ...  │  │ Updated ...  │   │
│  │              │  │              │  │              │   │
│  │ ••• [Details]│  │ ••• [Details]│  │ ••• [Details]│   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐                      │
│  │ Room Card    │  │ Room Card    │                      │
│  └──────────────┘  └──────────────┘                      │
│                                                           │
│  ◀ 1 2 3 4 ▶  Showing 1-6 of 42 rooms                   │
│                                                           │
└───────────────────────────────────────────────────────────┘

Elements:
- Search bar: max-width 400px, placeholder "Search by name, description..."
- Create button: Primary blue button with + icon
- Filter dropdowns: Neutral background, chevron icon, default "All"
- Room card (Grid View):
  - Width: 256px, shadow-md, border-radius-lg
  - Title: 18px bold, max 2 lines
  - Icon row: 📄 doc count, 👥 member count, 👁️ view count
  - Status badge: pill shape, colored (active=green, archived=gray, draft=yellow)
  - Last activity: 12px secondary text "Updated 2 days ago"
  - Actions menu: ••• icon (three dots), opens dropdown with Edit, Duplicate, Archive, Delete
- Pagination: centered, previous/next arrows, page numbers, showing count
```

**Room Card Details:**

```
Room Card (Grid): 256px × 240px
┌────────────────────────────┐
│ Series A Funding Room      │
│                            │
│ 📄 12   👥 4   👁️ 42      │
│                            │
│ Status: ● Active           │
│                            │
│ Updated 2 days ago         │
│                            │
│ [⋯ Details ────────────▼]  │  ← Menu reveals: Edit, Duplicate, Archive, Delete
└────────────────────────────┘

List View (alternative):
│ Series A Funding Room │ 12 docs │ 4 members │ Active │ 2d ago │ [⋯] │
```

### 3. Room Detail - Documents Tab (`/admin/rooms/[roomId]/documents`)

```
┌──────────────────────────────────────────────────────────────┐
│ Rooms > Series A Funding                            [⚙️]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ [Tab: Documents | Members | Links | Activity | Settings]    │
│                                                              │
│ [Toolbar]                                                   │
│ [📤 Upload] [📁 New Folder] [↕️ Sort ▼] [Grid/List]        │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Folder Tree      │ Documents List                    │   │
│ │                  │                                   │   │
│ │ ▼ Root           │ Name           │ Version │ Size  │   │
│ │  📁 Due D...     │ Term Sheet.pdf │ 3      │ 1.2M  │   │
│ │  📁 Financial... │ Cap Table.xlsx │ 2      │ 348K  │   │
│ │  📁 Board M...   │ Minutes.docx   │ 1      │ 256K  │   │
│ │                  │ Board Minutes  │        │       │   │
│ │                  │ ...revised     │ 1      │ 256K  │   │
│ │                  │ (in folder)    │        │       │   │
│ │                  │                │        │       │   │
│ │ (Drag files      │ ...or drag     │        │       │   │
│ │  here or use     │ files here     │        │       │   │
│ │  upload)         │                │        │       │   │
│ │                  │                │        │       │   │
│ │ [+ New Folder]   │                │        │       │   │
│ │                  │                │        │       │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ Drag-and-drop overlay (when dragging files):               │
│ ┌──────────────────────────────────────────────────────┐   │
│ │              Drop files here to upload               │   │
│ │         (1 file selected, ready to upload)           │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Folder Tree:
- Expandable/collapsible folders (▼/▶ icon)
- Root folder always visible
- Drag-drop to reorder or move documents between folders
- Context menu on right-click: Rename, Delete

Document List:
- Columns: Name (clickable), Version #, Size, Uploaded by, Date uploaded, Actions
- Row height: 48px
- Hover: light background (neutral-100)
- Actions menu: Download, Rename, Replace version, View details, Delete
```

### 4. Room Detail - Members Tab (`/admin/rooms/[roomId]/members`)

```
┌──────────────────────────────────────────────────────────────┐
│ Rooms > Series A Funding                            [⚙️]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ [Tab: Documents | Members | Links | Activity | Settings]    │
│                                                              │
│ [+ Invite Member]                                           │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Name         │ Email         │ Role       │ Added   │ [⋯] │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Alice Smith  │ alice@acme... │ Admin      │ Mar 5   │ [⋯] │
│ │ Bob Jones    │ bob@acme....  │ Editor     │ Mar 3   │ [⋯] │
│ │ Carol Lee    │ carol@acme... │ Viewer     │ Feb 20  │ [⋯] │
│ │ David Chen   │ david@part... │ Viewer     │ Feb 15  │ [⋯] │
│ │                                                          │ │
│ │ (+ Add more members below)                              │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Actions menu items: Change Role, Remove from room]        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Invite Modal:**

```
┌─────────────────────────────────────┐
│ Invite Members to Series A Funding  │
├─────────────────────────────────────┤
│                                     │
│ Email addresses (one per line):     │
│ [________________________]          │
│                                     │
│ Assign role:                        │
│ [Admin ▼]                           │
│                                     │
│ [Cancel]  [Send Invitations]        │
│                                     │
└─────────────────────────────────────┘
```

### 5. Room Detail - Links Tab (`/admin/rooms/[roomId]/links`)

```
┌──────────────────────────────────────────────────────────────┐
│ Rooms > Series A Funding                            [⚙️]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ [Tab: Documents | Members | Links | Activity | Settings]    │
│                                                              │
│ [+ Create Link]                                             │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Name/Config     │ Access      │ Expires    │ Views │ [⋯] │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Public Invite   │ All docs    │ Never      │ 23    │ [⋯] │
│ │ (no password)   │ PDF view    │            │       │     │
│ │                 │ No download │            │       │     │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Due Diligence   │ Due Diligence│ Mar 30     │ 156   │ [⋯] │
│ │ (pw: *****...)  │ folder only │ 2026-03-30 │       │     │
│ │                 │ with download            │       │     │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Board Review    │ Board Minutes│ Apr 15     │ 8     │ [⋯] │
│ │ (pw-protected)  │ only         │ 2026-04-15 │       │     │
│ │                 │ Email verify │            │       │     │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Actions: Copy Link, Edit, Revoke]                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Create Link Modal:**

```
┌──────────────────────────────────────┐
│ Create Share Link                    │
├──────────────────────────────────────┤
│                                      │
│ Name:                                │
│ [Due Diligence Review]               │
│                                      │
│ Documents to share:                  │
│ [☑ All documents]                    │
│ [☐ Due Diligence folder only]        │
│                                      │
│ Require email verification:          │
│ [Toggle: ON/OFF]                     │
│                                      │
│ Require password:                    │
│ [Toggle: ON] [••••••••]              │
│ (Generate random if enabled)         │
│                                      │
│ Link expiration:                     │
│ [In 30 days ▼]                       │
│                                      │
│ Download permission:                 │
│ [Allow downloads ▼]                  │
│                                      │
│ [Cancel]  [Create Link]              │
│                                      │
│ Share link will be:                  │
│ https://vaultspace.com/view/abc... │
│                                      │
└──────────────────────────────────────┘
```

### 6. Room Detail - Activity Tab (`/admin/rooms/[roomId]/activity`)

```
┌──────────────────────────────────────────────────────────────┐
│ Rooms > Series A Funding                            [⚙️]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ [Tab: Documents | Members | Links | Activity | Settings]    │
│                                                              │
│ [Date range picker]  [← Mar 1  to  Mar 14 →]  [Refresh]    │
│                                                              │
│ Stats Cards:                                                │
│ ┌─────────────┐  ┌──────────────┐  ┌────────┐  ┌────────┐ │
│ │ Total Views │  │ Unique Users │  │Documents│  │Downloads│ │
│ │    156      │  │      12      │  │  18    │  │   34    │ │
│ └─────────────┘  └──────────────┘  └────────┘  └────────┘ │
│                                                              │
│ Activity Timeline:                                          │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │                                                          │ │
│ │ Mar 14, 10:23 AM                                        │ │
│ │ 📄 Document viewed: Cap Table.xlsx                      │ │
│ │    by alice@acme.com                                   │ │
│ │                                                          │ │
│ │ Mar 14, 9:45 AM                                         │ │
│ │ 👥 Member invited: bob@acme.com                         │ │
│ │    Added by alice@acme.com                              │ │
│ │                                                          │ │
│ │ Mar 13, 3:30 PM                                         │ │
│ │ 📤 Document uploaded: Board_Minutes_v2.docx             │ │
│ │    by alice@acme.com (1.2 MB)                           │ │
│ │                                                          │ │
│ │ Mar 13, 2:15 PM                                         │ │
│ │ 🔗 Share link created: "Due Diligence Review"           │ │
│ │    by alice@acme.com                                   │ │
│ │                                                          │ │
│ │ [Show more ...]                                         │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Export as CSV]                                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 7. Room Detail - Settings Tab (`/admin/rooms/[roomId]/settings`)

```
┌──────────────────────────────────────────────────────────────┐
│ Rooms > Series A Funding                            [⚙️]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ [Tab: Documents | Members | Links | Activity | Settings]    │
│                                                              │
│ Basic Information                                           │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Room Name:                                              │ │
│ │ [Series A Funding Round]                                │ │
│ │                                                          │ │
│ │ Description:                                            │ │
│ │ [Investment round materials for Series A...]            │ │
│ │                                                          │ │
│ │ Status:                                                 │ │
│ │ [Active ▼] (Draft / Active / Archived / Closed)         │ │
│ │                                                          │ │
│ │ Template:                                               │ │
│ │ [Investor Room ▼] (M&A / Investor / Board / Compliance)│ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Access & Security                                           │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Require email verification for viewers: [Toggle: ON]     │ │
│ │                                                          │ │
│ │ Allow anonymous access (no login): [Toggle: ON]          │ │
│ │                                                          │ │
│ │ Watermark viewer names on PDFs: [Toggle: ON]             │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Document Settings                                           │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Enable version history: [Toggle: ON]                     │ │
│ │                                                          │ │
│ │ Allow document download by default: [Toggle: ON]         │ │
│ │                                                          │ │
│ │ Enable OCR & text extraction: [Toggle: ON]               │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Retention & Cleanup                                         │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Auto-delete trash after [90 ▼] days                      │ │
│ │                                                          │ │
│ │ Archive room automatically after [180 ▼] days of no use  │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Danger Zone                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ [Archive Room]  [Export as ZIP]  [Delete Room]           │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Save Changes]  [Revert]                                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 8. Document Viewer (`/view/[shareToken]/documents/[docId]`)

```
┌──────────────────────────────────────────────────────────────┐
│ Series A Funding > Cap Table.xlsx         [X close]          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────┐  ┌──────────────────────────────────┐  │
│  │ Thumbnails     │  │                                  │  │
│  │                │  │  Page 1                          │  │
│  │ ┌────────────┐ │  │  (PDF preview rendering)        │  │
│  │ │ [Page 1]   │ │  │                                  │  │
│  │ │ ▓▓▓▓▓      │ │  │  [Rendered PDF Content]          │  │
│  │ │ ▓▓▓▓▓      │ │  │                                  │  │
│  │ └────────────┘ │  │                                  │  │
│  │                │  │                                  │  │
│  │ ┌────────────┐ │  │  [Watermark: alice@acme.com]    │  │
│  │ │ [Page 2]   │ │  │  [timestamp: 2026-03-14T...]   │  │
│  │ │ ▓▓▓▓▓      │ │  │                                  │  │
│  │ │ ▓▓▓▓▓      │ │  │  © VaultSpace                  │  │
│  │ └────────────┘ │  │                                  │  │
│  │                │  │                                  │  │
│  │ ┌────────────┐ │  │                                  │  │
│  │ │ Page 3     │ │  │                                  │  │
│  │ │ ▓▓▓▓▓      │ │  │                                  │  │
│  │ │ ▓▓▓▓▓      │ │  │                                  │  │
│  │ └────────────┘ │  │                                  │  │
│  │                │  │                                  │  │
│  │ [Show more...] │  │                                  │  │
│  │                │  │                                  │  │
│  └────────────────┘  └──────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ◀  1 of 3  ▶  │ 100% ▼ │ 🔍- 🔍+ │ ⬇ │ 🖨️ │ ⋯      │  │
│  │ Controls: Prev/Next, Zoom out/in, Full-page, Zoom    │  │
│  │ level, Download (if enabled), Print (if enabled)     │  │
│  │ More menu: View fullscreen, Download original,       │  │
│  │ Copy link to page, Report issue                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Responsive:
- Mobile: Sidebar collapses, viewer takes full width
- Thumbnails hidden on small screens, swipe navigation for pages
```

### 9. Access Verification Gate (`/view/[shareToken]/verify`)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│                                                              │
│                 ┌──────────────────────┐                    │
│                 │                      │                    │
│                 │  VaultSpace Logo   │                    │
│                 │                      │                    │
│                 └──────────────────────┘                    │
│                                                              │
│                  Series A Funding                           │
│                  Investment Round Materials                 │
│                                                              │
│                [Company/Org Logo]                           │
│                                                              │
│                                                              │
│  Email Verification (if enabled):                           │
│  ┌──────────────────────────────┐                          │
│  │ Email Address:               │                          │
│  │ [investor@example.com      ] │                          │
│  │                              │                          │
│  │ [Continue]                   │                          │
│  └──────────────────────────────┘                          │
│                                                              │
│  Password (if enabled):                                     │
│  ┌──────────────────────────────┐                          │
│  │ Password:                    │                          │
│  │ [••••••••••]                 │                          │
│  │                              │                          │
│  │ [Access Documents]           │                          │
│  └──────────────────────────────┘                          │
│                                                              │
│                                                              │
│                  Powered by VaultSpace                    │
│                                                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 10. Setup Wizard (`/setup`)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│         Step 1 of 4: Create Admin Account                   │
│                                                              │
│  ┌─────┬─────┬──────┬──────┐                               │
│  │ 1   │ 2   │ 3    │ 4    │                               │
│  │ Admin│Org  │ Room │ Done │                               │
│  └─────┴─────┴──────┴──────┘                               │
│                                                              │
│  ┌──────────────────────────────┐                          │
│  │ Full Name:                   │                          │
│  │ [Alice Smith]                │                          │
│  │                              │                          │
│  │ Email Address:               │                          │
│  │ [alice@acme.com]             │                          │
│  │                              │                          │
│  │ Password:                    │                          │
│  │ [••••••••••] (8+ characters) │                          │
│  │                              │                          │
│  │ Confirm Password:            │                          │
│  │ [••••••••••]                 │                          │
│  │                              │                          │
│  │ [Back]  [Next Step]          │                          │
│  │                              │                          │
│  └──────────────────────────────┘                          │
│                                                              │
│                                                              │
│         Step 2 of 4: Organization Details                   │
│                                                              │
│  ┌──────────────────────────────┐                          │
│  │ Organization Name:           │                          │
│  │ [Acme Capital]               │                          │
│  │                              │                          │
│  │ Industry:                    │                          │
│  │ [Venture Capital ▼]          │                          │
│  │                              │
│  │ Custom Domain (optional):    │                          │
│  │ [dataroom.acmecapital.com]   │                          │
│  │                              │                          │
│  │ [Back]  [Next Step]          │                          │
│  │                              │                          │
│  └──────────────────────────────┘                          │
│                                                              │
│                                                              │
│         Step 3 of 4: Create First Room                      │
│                                                              │
│  ┌──────────────────────────────┐                          │
│  │ Room Name:                   │                          │
│  │ [Series A Funding]           │                          │
│  │                              │                          │
│  │ Description:                 │                          │
│  │ [Investment round materials] │                          │
│  │                              │                          │
│  │ Template:                    │                          │
│  │ [Investor Room ▼]            │                          │
│  │                              │                          │
│  │ [Back]  [Create Room]        │                          │
│  │                              │                          │
│  └──────────────────────────────┘                          │
│                                                              │
│                                                              │
│         Step 4 of 4: Setup Complete                         │
│                                                              │
│  ┌──────────────────────────────┐                          │
│  │                              │                          │
│  │ ✓ Admin account created      │                          │
│  │ ✓ Organization set up        │                          │
│  │ ✓ First room created         │                          │
│  │ ✓ Demo documents added       │                          │
│  │                              │                          │
│  │ Next steps:                  │                          │
│  │ 1. Invite team members       │                          │
│  │ 2. Upload documents          │                          │
│  │ 3. Create share links        │                          │
│  │ 4. Configure access rules    │                          │
│  │                              │                          │
│  │ [View First Room]            │                          │
│  │                              │                          │
│  └──────────────────────────────┘                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 11. Users List (`/admin/users`)

```
┌──────────────────────────────────────────────────────────────┐
│ Admin Users & Invitations                                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ [+ Invite User]  [Search...]                                │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Name          │ Email          │ Role  │ Status │ Added  │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Alice Smith   │ alice@acme...  │ Admin │ Active │ Mar 5  │ │
│ │ Bob Jones     │ bob@acme....   │ Editor│ Active │ Mar 3  │ │
│ │ Carol Lee     │ carol@acme...  │ Viewer│ Active │ Feb 20 │ │
│ │ (invited)     │ david@part...  │ Admin │ Pending│ 2d ago │ │
│ │               │                │       │ (link sent)    │ │
│ │                                                          │ │
│ │ [Actions: Change Role, Resend Invite, Remove]           │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 12. Groups List (`/admin/groups`)

```
┌──────────────────────────────────────────────────────────────┐
│ User Groups                                                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ [+ Create Group]  [Search...]                               │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Group Name      │ Members │ Rooms │ Created │ Actions    │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Investment Team │ 4       │ 8     │ Feb 1   │ Edit [⋯]  │ │
│ │ Legal Review    │ 6       │ 12    │ Jan 15  │ Edit [⋯]  │ │
│ │ Board Members   │ 3       │ 2     │ Dec 1   │ Edit [⋯]  │ │
│ │                                                          │ │
│ │ [Actions: Edit Members, Delete]                          │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 13. Organization Activity Dashboard (`/admin/activity`)

```
┌──────────────────────────────────────────────────────────────┐
│ Organization Activity                                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Stats Summary (System-wide):                                │
│ ┌─────────────┐  ┌────────────┐  ┌──────────┐  ┌────────┐ │
│ │ Total Views │  │ Unique Users│  │ Documents│  │Downloads│ │
│ │   15,234    │  │    342     │  │   1,824  │  │  4,592  │ │
│ └─────────────┘  └────────────┘  └──────────┘  └────────┘ │
│                                                              │
│ [Date range] [Filter by event type] [Filter by user]       │
│                                                              │
│ Activity Timeline (same as room activity, but org-wide):    │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Mar 14, 10:23 AM                                        │ │
│ │ 📄 Document viewed: Term Sheet in Series A Funding      │ │
│ │    by alice@acme.com in room "Series A Funding"        │ │
│ │                                                          │ │
│ │ Mar 14, 9:45 AM                                         │ │
│ │ 🔗 Share link created in "Board Review" room            │ │
│ │    by bob@acme.com                                      │ │
│ │                                                          │ │
│ │ Mar 13, 3:30 PM                                         │ │
│ │ 👤 New room created: "Q4 Reporting"                     │ │
│ │    by carol@acme.com                                   │ │
│ │                                                          │ │
│ │ [Show more ...]                                         │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Export as CSV]                                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 14. Organization Settings (`/admin/settings`)

```
┌──────────────────────────────────────────────────────────────┐
│ Organization Settings                                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Basic Information                                           │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Organization Name:                                      │ │
│ │ [Acme Capital Partners]                                 │ │
│ │                                                          │ │
│ │ Logo (optional):                                        │ │
│ │ [Upload] [Current: acme_logo.png]                       │ │
│ │                                                          │ │
│ │ Primary Color:                                          │ │
│ │ [Color picker: #2563eb]                                 │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Email Configuration                                        │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ SMTP Server:                                            │ │
│ │ [smtp.sendgrid.net]                                     │ │
│ │                                                          │ │
│ │ From Address:                                           │ │
│ │ [noreply@acmecapital.com]                               │ │
│ │                                                          │ │
│ │ From Name:                                              │ │
│ │ [Acme DataRoom]                                         │ │
│ │                                                          │ │
│ │ [Test Connection]                                       │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Domain Configuration                                       │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Custom Domain:                                          │ │
│ │ [dataroom.acmecapital.com]                              │ │
│ │                                                          │ │
│ │ Domain Status: ✓ Verified                               │ │
│ │ SSL Certificate: ✓ Valid (expires 2027-03-14)           │ │
│ │                                                          │ │
│ │ [DNS Configuration Instructions]                        │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Security & Retention                                       │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Session timeout (minutes): [30]                         │ │
│ │                                                          │ │
│ │ Require email verification for all viewers: [Toggle: ON] │ │
│ │                                                          │ │
│ │ Enable watermarking by default: [Toggle: ON]             │ │
│ │                                                          │ │
│ │ Document retention (days): [365]  (0 = never delete)    │ │
│ │                                                          │ │
│ │ Trash retention (days): [30]                            │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [Save Settings]  [Revert]                                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 15. Login Page (`/auth/login`)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│           ┌────────────────────────────────┐               │
│           │                                │               │
│           │      VaultSpace Logo         │               │
│           │     Secure Data Rooms          │               │
│           │                                │               │
│           └────────────────────────────────┘               │
│                                                              │
│           ┌────────────────────────────────┐               │
│           │                                │               │
│           │ Email:                         │               │
│           │ [investor@example.com        ] │               │
│           │                                │               │
│           │ Password:                      │               │
│           │ [••••••••••]                   │               │
│           │                                │               │
│           │ [☐ Remember me]                │               │
│           │                                │               │
│           │ [Sign In]                      │               │
│           │                                │               │
│           │ Forgot password? [Click here]  │               │
│           │                                │               │
│           │ ────────────────────────────── │               │
│           │                                │               │
│           │ Don't have an account?         │               │
│           │ [Sign up]                      │               │
│           │                                │               │
│           │ [Login with SSO]               │               │
│           │                                │               │
│           └────────────────────────────────┘               │
│                                                              │
│                                                              │
│                         © 2026 VaultSpace                │
│                      https://vaultspace.io                │
│                                                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## User Flows

### Flow 1: First-Time Setup (Fresh Install)

**Steps:**

1. User accesses `/setup` → Step 1 form
2. Enters admin name, email, password → validates
3. Clicks "Next" → Step 2 form
4. Enters organization name, industry, optional domain → validates
5. Clicks "Next" → Step 3 form
6. Enters first room name, description, selects template → validates
7. Clicks "Create Room" → system creates room + populates demo docs
8. Step 4 displays success with summary
9. Clicks "View First Room" → redirects to `/admin/rooms/[roomId]/documents`

**Data validated:** Email format, password strength (8+ chars), org name, room name

### Flow 2: Upload Documents to Share

**Steps:**

1. Admin logs in → navigates to `/admin/rooms`
2. Clicks room → navigates to `/admin/rooms/[roomId]/documents`
3. Drags & drops files into drop zone (or clicks upload button)
4. Files show progress bar → upload completes
5. Files appear in document list with version "1"
6. Admin clicks on file → can preview or right-click for options
7. Admin can create new folder, organize docs via drag-drop
8. Admin creates share link: clicks "Links" tab → "+ Create Link"
9. Fills form: name, documents, email verification, password, expiration
10. Clicks "Create Link" → system generates link + copies to clipboard
11. Admin shares link with external viewers

**Validation:** File size, file type (PDF, DOCX, XLSX, PPTX, images), virus scan

### Flow 3: Viewer Access (Email + Password Gate)

**Steps:**

1. External user clicks share link → navigates to `/view/[shareToken]/verify`
2. Page displays room name + organization logo
3. Enters email address → clicks "Continue"
4. System sends verification email with code/link
5. User clicks link in email → redirected to `/view/[shareToken]` (email verified)
6. If password required, page shows password input
7. User enters password → clicks "Access Documents"
8. Redirected to `/view/[shareToken]/documents` (document list)
9. User clicks document → navigates to `/view/[shareToken]/documents/[docId]`
10. Document viewer loads, displays PDF/preview with watermark
11. User can navigate pages, zoom, download (if enabled), view metadata

**Validation:** Email format, password strength, link expiration, rate limiting on verification attempts

### Flow 4: Create Room and Manage Permissions

**Steps:**

1. Admin navigates to `/admin/rooms` → clicks "+ Create Room"
2. Modal appears: room name, description, template selector
3. Clicks "Create" → redirected to `/admin/rooms/[roomId]/documents`
4. Admin clicks "Members" tab
5. Clicks "+ Invite Member" → modal appears
6. Enters email addresses (comma-separated or line-by-line)
7. Selects role (Admin, Editor, Viewer)
8. Clicks "Send Invitations" → system sends emails with registration links
9. Invited users receive emails, click link, create account or login
10. Admin can update member roles or remove members from modal
11. Admin clicks "Links" tab → creates share links with specific scopes:
    - All documents vs. specific folder
    - Email verification required
    - Password protected
    - Expiration date
    - Download enabled/disabled
12. Links are generated; admin copies and distributes

**Validation:** Email uniqueness, role constraints (can't remove last admin), duplicate invitations

---

## Component Library

All components styled with TailwindCSS, exported from `src/components/`.

### UI Primitives

**Button**

```typescript
// Types: primary, secondary, danger, outline, ghost
// Sizes: sm, md, lg
// States: default, hover, active, disabled, loading
<Button variant="primary" size="md" onClick={...}>
  Create Room
</Button>
```

**Input**

```typescript
// Types: text, email, password, number, search
// States: default, focus, error, disabled, loading
<Input
  type="email"
  placeholder="Email address"
  value={}
  onChange={}
  error={errorMsg}
/>
```

**Select / Dropdown**

```typescript
<Select value={selectedVal} onChange={...}>
  <Option value="admin">Admin</Option>
  <Option value="editor">Editor</Option>
  <Option value="viewer">Viewer</Option>
</Select>
```

**Checkbox / Toggle**

```typescript
<Checkbox label="Enable notifications" checked={} onChange={} />
<Toggle label="Dark mode" enabled={} onChange={} />
```

**Badge**

```typescript
// Types: primary, success, warning, danger, neutral
// Sizes: sm, md
<Badge type="success">Active</Badge>
<Badge type="warning">Pending</Badge>
```

**Avatar**

```typescript
// Display user profile picture or initials
// Sizes: sm, md, lg
<Avatar name="Alice Smith" size="md" imageUrl={...} />
```

**Modal / Dialog**

```typescript
<Modal title="Create Room" open={isOpen} onClose={...}>
  <Form>{...}</Form>
  <ModalFooter>
    <Button variant="secondary" onClick={...}>Cancel</Button>
    <Button variant="primary" onClick={...}>Create</Button>
  </ModalFooter>
</Modal>
```

**Toast / Alert**

```typescript
// Types: success, error, warning, info
<Toast type="success" message="Room created successfully" autoClose={3000} />
```

### Complex Components

**DataTable**

```typescript
// Sortable, filterable, paginated table
// Props: columns, data, onSort, onFilter, onPageChange, pageSize
<DataTable
  columns={[
    { key: 'name', label: 'Name', sortable: true },
    { key: 'created', label: 'Created', sortable: true },
  ]}
  data={rooms}
  onSort={(col, dir) => {...}}
  pageSize={10}
/>
```

**FileUploader**

```typescript
// Drag-drop zone, progress bar, file list
// Props: onUpload, maxSize, acceptedFileTypes, multiple
<FileUploader
  onUpload={(files) => {...}}
  maxSize={100 * 1024 * 1024} // 100MB
  acceptedFileTypes={['pdf', 'docx', 'xlsx', 'pptx', 'jpg', 'png']}
  multiple={true}
/>
```

**FolderTree**

```typescript
// Expandable folder structure
// Props: items, onSelect, onDragDrop, onContextMenu
<FolderTree
  items={folderHierarchy}
  onSelect={(folderId) => {...}}
  onDragDrop={(source, target) => {...}}
/>
```

**DocumentPreview**

```typescript
// PDF/document viewer with page navigation
// Props: url, pageCount, watermark, allowDownload, allowPrint
<DocumentPreview
  url="/api/documents/{docId}/preview"
  pageCount={5}
  watermark={{ text: 'alice@acme.com', date: '2026-03-14' }}
  allowDownload={true}
  allowPrint={false}
/>
```

**PermissionSelector**

```typescript
// Role/permission picker with group support
// Props: roles, groups, onSelect
<PermissionSelector
  roles={['admin', 'editor', 'viewer']}
  groups={[...]}
  onSelect={(roleOrGroup) => {...}}
/>
```

**ActivityTimeline**

```typescript
// Chronological event list with filters
// Props: events, onFilter, onExport
<ActivityTimeline
  events={activityEvents}
  onFilter={(eventType) => {...}}
  onExport={(format) => {...}}
/>
```

**Breadcrumb**

```typescript
// Navigation breadcrumb
// Props: items (array of {label, href})
<Breadcrumb items={[
  { label: 'Rooms', href: '/admin/rooms' },
  { label: 'Series A', href: '/admin/rooms/123' },
  { label: 'Documents', href: '/admin/rooms/123/documents' },
]} />
```

**EmptyState**

```typescript
// Placeholder for empty lists
// Props: icon, title, description, action
<EmptyState
  icon="📁"
  title="No documents yet"
  description="Upload documents to get started"
  action={<Button>Upload Documents</Button>}
/>
```

**Pagination**

```typescript
// Page navigation
// Props: currentPage, totalPages, onPageChange
<Pagination
  currentPage={1}
  totalPages={10}
  onPageChange={(page) => {...}}
/>
```

**ContextMenu**

```typescript
// Right-click context menu
// Props: items, position, onSelect
<ContextMenu items={[
  { label: 'Edit', onClick: editFn },
  { label: 'Delete', onClick: deleteFn },
]} />
```

---

## Accessibility Requirements

All components meet WCAG 2.1 Level AA standards.

### Keyboard Navigation

- All interactive elements (buttons, links, inputs, modals) are reachable via Tab key
- Focus order follows logical page flow (left-to-right, top-to-bottom)
- Shift+Tab navigates backward
- Enter activates buttons/links; Space toggles checkboxes
- Escape closes modals/dropdowns
- Arrow keys navigate within menus, tabs, tables

### Focus Indicators

- All focused elements have visible focus ring: 2px solid `#2563eb` with 2px offset
- Focus ring is visible on light and dark backgrounds (no low contrast)
- No focus styles removed without replacement

### Color Contrast

- All text meets minimum 4.5:1 contrast ratio (WCAG AAA for normal text)
- Large text (18pt+) meets minimum 3:1 contrast ratio
- UI components (borders, icons) meet minimum 3:1 contrast ratio
- Color is never the only way to convey information (icons, labels, patterns used)

### Screen Reader Support

- Semantic HTML: `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<footer>`
- Landmark roles used: `role="navigation"`, `role="main"`, `role="contentinfo"`
- Form inputs have associated `<label>` elements with `for` attribute
- Buttons have descriptive text or `aria-label` (e.g., "Close modal" not "X")
- Icons have `aria-label` or are wrapped in elements with labels
- Links have descriptive text: "Download document" not "Click here"
- Error messages associated with inputs via `aria-describedby` or `aria-invalid`
- Tables have `<thead>`, `<tbody>`, `<th>` with `scope` attribute
- Dynamic content updates announced via ARIA live regions: `aria-live="polite"` for notifications

### Form Accessibility

- All form fields have visible labels
- Required fields marked with `aria-required="true"` and asterisk (\*)
- Error messages displayed inline below input, colored and bold
- Helpful hints in smaller text below inputs if needed
- Form submission validates all fields and summarizes errors at top

### Skip Navigation

- Skip link at top of page: "Skip to main content"
- Hidden visually but visible on Tab
- Links directly to `<main>` or main content area

### Mobile Accessibility

- Touch targets at least 48x48px (WCAG AAA)
- Adequate spacing between interactive elements (8px minimum)
- No functionality dependent on hover alone
- Responsive text sizing: no fixed font sizes smaller than 12px

### Audio/Video (Future)

- Not in MVP scope, but prepared for V1+ additions
- Captions on all video
- Transcripts for audio
- Keyboard controls for players

---

## Responsive Breakpoints

TailwindCSS breakpoints used throughout:

| Breakpoint | Width   | Name        | Usage                       |
| ---------- | ------- | ----------- | --------------------------- |
| (default)  | 320px+  | Mobile      | Phone-sized screens         |
| `sm`       | 640px+  | Small       | Large phones, small tablets |
| `md`       | 768px+  | Medium      | Tablets                     |
| `lg`       | 1024px+ | Large       | Laptops, small desktops     |
| `xl`       | 1280px+ | Extra Large | Desktops, monitors          |
| `2xl`      | 1536px+ | 2XL         | Large monitors              |

### Mobile-First Strategy

- Default styles target mobile (small screens)
- `sm:`, `md:`, `lg:`, `xl:` prefixes add complexity for larger screens
- Example: `w-full sm:w-1/2 md:w-1/3 lg:w-1/4` (full width on mobile, halves on tablet, thirds on medium, quarters on large)

### Layout Adjustments

**Mobile (< 768px):**

- Full-width single column layout
- Header: stacked, hamburger menu for navigation
- Sidebars: hidden, accessible via overlay drawer
- Cards: full width, no multi-column grids
- Modals: full height with scrolling
- Tables: horizontal scroll or card view alternative
- File uploads: full-width drop zone
- Room cards: list view only (no grid)

**Tablet (768px - 1023px):**

- Sidebar visible but collapsed to icons-only
- Navigation: collapsible on scroll
- 2-column grid for cards (room list, activity)
- Tables: scrollable with sticky header
- Modals: centered, max-width 90vw

**Desktop (1024px+):**

- Full sidebar visible with text
- 3-4 column grid for cards
- Full table display without horizontal scroll
- Modals: centered, max-width 600px (for most), wider for complex forms
- Tooltips appear on hover

### Example Responsive Component

```typescript
// Room card grid responsive layout
<div className="
  grid grid-cols-1 gap-6
  sm:grid-cols-2
  md:grid-cols-3
  lg:grid-cols-4
">
  {rooms.map(room => <RoomCard key={room.id} {...room} />)}
</div>
```

---

## Implementation Notes

### Color Variables in Code

```typescript
// Use Tailwind classes, not hardcoded colors
// ✓ Good
<div className="bg-primary text-white">

// ✗ Avoid
<div style={{ backgroundColor: '#2563eb', color: '#fff' }}>
```

### Responsive Images

```typescript
// Use Next.js Image component for optimization
<Image
  src="/logo.png"
  alt="VaultSpace logo"
  width={256}
  height={256}
  responsive={true}
/>
```

### Dark Mode (Future)

- Design tokens support dark mode via TailwindCSS `dark:` prefix
- Not implemented in MVP, but structure is ready
- Add `prefers-color-scheme` media query in future

### Browser Support

Tested and supported on:

- Chrome 120+
- Firefox 120+
- Safari 17+
- Edge 120+

### Performance

- Lazy load images with `loading="lazy"`
- Code-split pages with Next.js dynamic imports
- Debounce search inputs (300ms)
- Virtual scroll for long tables/lists (100+ rows)
- Memoize expensive components (React.memo)

---

## File Organization

```
src/components/
├── ui/                    # Primitive components
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Select.tsx
│   ├── Badge.tsx
│   ├── Avatar.tsx
│   ├── Modal.tsx
│   ├── Toast.tsx
│   └── ...
├── complex/              # Complex components
│   ├── DataTable.tsx
│   ├── FileUploader.tsx
│   ├── FolderTree.tsx
│   ├── DocumentPreview.tsx
│   ├── PermissionSelector.tsx
│   ├── ActivityTimeline.tsx
│   └── ...
├── layout/               # Layout components
│   ├── AppShell.tsx
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   └── ...
├── admin/                # Admin pages
│   ├── RoomList.tsx
│   ├── RoomDetail.tsx
│   ├── DocumentBrowser.tsx
│   ├── MembersList.tsx
│   ├── LinksList.tsx
│   ├── ActivityLog.tsx
│   ├── RoomSettings.tsx
│   ├── UsersList.tsx
│   ├── GroupsList.tsx
│   └── ...
├── viewer/               # Viewer pages
│   ├── AccessGate.tsx
│   ├── DocumentList.tsx
│   ├── DocumentViewer.tsx
│   └── ...
├── auth/                 # Auth pages
│   ├── LoginForm.tsx
│   ├── RegisterForm.tsx
│   ├── ForgotPasswordForm.tsx
│   └── ...
├── setup/                # Setup wizard
│   ├── SetupWizard.tsx
│   ├── StepAdmin.tsx
│   ├── StepOrganization.tsx
│   ├── StepRoom.tsx
│   └── StepComplete.tsx
└── hooks/                # Custom React hooks
    ├── useAuth.ts
    ├── useRoom.ts
    ├── usePagination.ts
    └── ...
```

---

## CSS Class Naming Convention

Follow BEM (Block Element Modifier) for custom classes, but prefer Tailwind utilities:

```typescript
// ✓ Prefer utility classes
<div className="flex items-center justify-between bg-white p-4 rounded-md shadow-md">

// ✓ Acceptable for complex layouts
<div className={`
  ${styles.roomCard}
  ${room.isActive ? styles['roomCard--active'] : ''}
`}>

// ✗ Avoid global CSS unless necessary
<style>{`
  .room-card { ... }
  .room-card--active { ... }
`}</style>
```

---

## Next Steps for Implementation

1. **Phase 1:** Implement design tokens + TailwindCSS config
2. **Phase 2:** Build primitive UI components (Button, Input, Select, etc.)
3. **Phase 3:** Build complex components (DataTable, FileUploader, DocumentPreview, etc.)
4. **Phase 4:** Build layout shells (AppShell, Header, Sidebar)
5. **Phase 5:** Implement auth pages (Login, Register, Reset Password)
6. **Phase 6:** Implement setup wizard
7. **Phase 7:** Implement admin pages (Rooms, Documents, Members, Links, Activity, Settings)
8. **Phase 8:** Implement viewer pages (AccessGate, DocumentList, DocumentViewer)
9. **Phase 9:** Accessibility audit and remediation
10. **Phase 10:** Responsive design testing and refinement

---

**Document Version:** 1.0
**Created:** 2026-03-14
**Status:** Ready for Implementation
