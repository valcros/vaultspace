# VaultSpace Dashboard Redesign Proposal

**Date:** 2026-04-04
**Status:** Design Specification
**Stakeholder Feedback:** "The current dashboard screen is awkward to look at and not valuable in its current format."

---

## Executive Summary

This document proposes a comprehensive redesign of the VaultSpace dashboard to provide role-appropriate, actionable information. The current dashboard shows generic metrics that don't help users accomplish their goals. The redesign introduces **persona-based dashboards** with widgets tailored to each user's role and context.

---

## Research Findings

### Industry Best Practices (2025-2026)

Based on analysis of leading VDR platforms (Datasite, Intralinks, Firmex, ShareVault) and SaaS dashboard patterns:

1. **Role-Based Personalization**: Different users need different information. Admins need oversight; viewers need quick access to relevant content.

2. **Actionable Over Vanity**: Metrics should drive action. "You have 3 unanswered questions" is more valuable than "Total documents: 47".

3. **Recency and Relevance**: Users care most about what's new since their last visit, not aggregate totals.

4. **Quick Access to Work**: Dashboards should minimize clicks to the user's actual tasks - viewing documents, responding to questions, checking activity.

5. **Mobile-First Analytics**: Engagement data should be accessible on mobile for checking during meetings.

### Problems with Current Dashboard

| Issue                                           | Impact                                                  |
| ----------------------------------------------- | ------------------------------------------------------- |
| Generic metrics (rooms, docs, members, storage) | Not actionable - users can't do anything with this info |
| No personalization by role                      | Org Owner sees same as Room Viewer                      |
| No "since last login" context                   | Users don't know what's new                             |
| Activity feed is passive                        | Shows what happened, not what needs attention           |
| Missing messages/Q&A                            | Key collaboration features not surfaced                 |
| No bookmarks/favorites                          | Users can't quickly access their important docs         |
| No room-specific insights                       | Everything is org-level aggregate                       |

---

## User Personas and Needs

### Persona 1: Organization Owner/Admin

**Goals:**

- Monitor overall health of all data rooms
- Identify rooms needing attention (inactive, approaching deadlines)
- Track team member activity
- Respond to urgent items (questions, access requests)

**Dashboard Needs:**

- Rooms requiring attention (unanswered questions, pending access requests)
- Recent viewer activity across all rooms
- Team member last active status
- Storage/quota monitoring
- Quick room creation/navigation

### Persona 2: Room Admin

**Goals:**

- Manage a specific data room or set of rooms
- Monitor viewer engagement
- Respond to viewer questions
- Track document completion/uploads

**Dashboard Needs:**

- Their rooms at a glance
- Unanswered questions for their rooms
- New viewer activity
- Documents pending review/upload
- Checklist progress

### Persona 3: Room Viewer (via Link)

**Goals:**

- Find and view documents
- Track their own progress through materials
- Ask questions when confused
- Return to previously viewed/bookmarked documents

**Dashboard Needs:**

- Recently viewed documents (continue where they left off)
- Bookmarked/favorited documents
- New documents since last visit
- Unanswered questions they submitted
- Room announcements/news

---

## Proposed Dashboard Architecture

### 1. Admin Dashboard (Org Owner / Org Admin)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Welcome back, {name}                    Last login: 2 hours ago    │
│  You have 3 items needing attention                                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐ ┌─────────────────────────────┐
│  🔔 ACTION REQUIRED (3)             │ │  📬 MESSAGES                │
│  ─────────────────────────────────  │ │  ─────────────────────────  │
│  • 2 unanswered questions           │ │  Inbox (3 unread)           │
│    Series A Room - 1 day ago        │ │  • John D. asked about...   │
│  • 1 pending access request         │ │  • Sarah M. replied to...   │
│    M&A Due Diligence - 3 hrs ago    │ │  Sent (12)                  │
│  [View All →]                       │ │  [Open Messages →]          │
└─────────────────────────────────────┘ └─────────────────────────────┘

┌─────────────────────────────────────┐ ┌─────────────────────────────┐
│  📊 MY ROOMS                        │ │  👥 RECENT VIEWER ACTIVITY  │
│  ─────────────────────────────────  │ │  ─────────────────────────  │
│  Series A Funding     ●  ACTIVE     │ │  John D. viewed Term Sheet  │
│    14 docs • 8 viewers • 3 questions│ │    Series A • 5 min ago     │
│                                     │ │  Sarah M. downloaded...     │
│  M&A Due Diligence    ●  ACTIVE     │ │    M&A Room • 1 hr ago      │
│    47 docs • 12 viewers • 1 request │ │  Mike R. first access       │
│                                     │ │    Board Portal • 2 hrs ago │
│  Board Portal 2026    ○  DRAFT      │ │  [View Full Activity →]     │
│    8 docs • 0 viewers               │ │                             │
│  [+ Create Room]                    │ └─────────────────────────────┘
└─────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  📈 ENGAGEMENT INSIGHTS (Last 7 Days)                               │
│  ─────────────────────────────────────────────────────────────────  │
│  Total Views: 234    Unique Viewers: 18    Downloads: 45            │
│  [Engagement chart showing daily activity]                          │
│                                                                     │
│  Most Active Rooms:                  Most Viewed Documents:         │
│  1. Series A Funding (89 views)      1. Term Sheet v3.pdf (34)      │
│  2. M&A Due Diligence (67 views)     2. Cap Table.xlsx (28)         │
│  3. Board Portal (12 views)          3. Financial Model.xlsx (21)   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. Room Admin Dashboard (Member with Room Admin Role)

Similar to Org Admin but scoped to their assigned rooms:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Welcome back, {name}                    Last login: Yesterday      │
│  Series A Funding Room - 2 items need attention                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐ ┌─────────────────────────────┐
│  🔔 FOR YOUR ATTENTION              │ │  📋 CHECKLIST PROGRESS      │
│  ─────────────────────────────────  │ │  ─────────────────────────  │
│  Questions (2 unanswered):          │ │  Due Diligence Checklist    │
│  • "What's the ARR growth rate?"    │ │  ██████████░░ 75%           │
│    From: investor@vc.com - 2h ago   │ │  12 of 16 items complete    │
│  • "Can we get audited financials?" │ │                             │
│    From: partner@law.com - 1d ago   │ │  Missing:                   │
│  [Answer Questions →]               │ │  • Audited 2025 financials  │
└─────────────────────────────────────┘ │  • Board meeting minutes    │
                                        │  • Patent documentation     │
┌─────────────────────────────────────┐ │  • Customer contracts       │
│  📄 RECENT UPLOADS                  │ │  [View Checklist →]         │
│  ─────────────────────────────────  │ └─────────────────────────────┘
│  + Term Sheet v3.pdf                │
│    Uploaded by you - 2 hours ago    │ ┌─────────────────────────────┐
│  + Q4 Financial Summary.xlsx        │ │  👁 WHO'S VIEWING           │
│    Uploaded by Sarah - Yesterday    │ │  ─────────────────────────  │
│  [Upload Documents →]               │ │  Active now:                │
└─────────────────────────────────────┘ │  • investor@vc.com          │
                                        │    Viewing: Cap Table.xlsx  │
                                        │  Last 24 hours: 6 viewers   │
                                        │  [View Analytics →]         │
                                        └─────────────────────────────┘
```

### 3. Viewer Dashboard (Link-Based Access)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Series A Funding - Due Diligence                                   │
│  Welcome back! You last visited 3 days ago.                         │
│  📢 2 new documents have been added since your last visit           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────┐ ┌─────────────────────────────┐
│  🕐 CONTINUE WHERE YOU LEFT OFF     │ │  ⭐ YOUR BOOKMARKS          │
│  ─────────────────────────────────  │ │  ─────────────────────────  │
│  Term Sheet v3.pdf                  │ │  Cap Table.xlsx             │
│    Page 4 of 12 • 3 days ago        │ │    Financials folder        │
│  Financial Model.xlsx               │ │  Pitch Deck Final.pptx      │
│    Last viewed 3 days ago           │ │    Overview folder          │
│  [View All History →]               │ │  Employment Agreements      │
└─────────────────────────────────────┘ │    Legal folder             │
                                        │  [Manage Bookmarks →]       │
┌─────────────────────────────────────┐ └─────────────────────────────┘
│  🆕 NEW SINCE YOUR LAST VISIT       │
│  ─────────────────────────────────  │ ┌─────────────────────────────┐
│  + Board Minutes Q1 2026.pdf        │ │  ❓ YOUR QUESTIONS          │
│    Added 2 days ago                 │ │  ─────────────────────────  │
│  + Updated Cap Table.xlsx           │ │  Answered (1):              │
│    Updated 1 day ago                │ │  • "What's the burn rate?"  │
│  [View All Documents →]             │ │    ✓ Answered by Admin      │
└─────────────────────────────────────┘ │  Pending (1):               │
                                        │  • "ARR growth rate?"       │
┌─────────────────────────────────────┐ │    Submitted 2 hours ago    │
│  📣 ROOM ANNOUNCEMENTS              │ │  [Ask a Question →]         │
│  ─────────────────────────────────  │ └─────────────────────────────┘
│  "Updated financials uploaded -     │
│   Q4 numbers are now available"     │
│   Posted by Admin • 1 day ago       │
└─────────────────────────────────────┘
```

---

## Widget Specifications

### Widget 1: Action Required Card

**Purpose:** Surface items that need the user's immediate attention

**Data Sources:**

- `Question` model (where `status = 'PENDING'` and room admin)
- `AccessRequest` model (where `status = 'PENDING'`)
- `Document` model (where `reviewStatus = 'PENDING'` if implemented)

**Display:**

- Badge count in header
- Grouped by type (Questions, Access Requests, Reviews)
- Click to navigate to resolution page

### Widget 2: Messages Card

**Purpose:** Quick access to direct and room messages

**Data Sources:**

- `Message` model (inbox: `recipientUserId = currentUser`)
- Unread count from `Notification` model

**Display:**

- Unread count badge
- Last 3 message previews
- Link to full messages page

### Widget 3: My Rooms Card

**Purpose:** Quick navigation to user's rooms with status indicators

**Data Sources:**

- `Room` model filtered by user's role assignments
- Aggregate counts (docs, viewers, questions)

**Display:**

- Room name with status badge (ACTIVE/DRAFT/ARCHIVED)
- Key metrics inline (doc count, viewer count, question count)
- Quick action buttons (Open, Settings)

### Widget 4: Recent Activity Feed

**Purpose:** Show what's happening across the organization/rooms

**Data Sources:**

- `Event` model (filtered by relevance to user)
- `PageView` model for viewer activity

**Display:**

- Avatar/icon + actor name + action + target
- Relative timestamp
- Grouped by time period (Today, Yesterday, This Week)

### Widget 5: Continue Where You Left Off (Viewer)

**Purpose:** Help viewers resume their document review

**Data Sources:**

- `PageView` model (user's last viewed documents with page number)
- Session last access timestamp

**Display:**

- Document thumbnail
- Document name + page position
- Last viewed timestamp

### Widget 6: Bookmarks Card

**Purpose:** Quick access to user's saved documents

**Data Sources:**

- `Bookmark` model

**Display:**

- Document name + folder location
- Quick view button
- Remove bookmark action

### Widget 7: New Since Last Visit

**Purpose:** Highlight documents added/updated since user's last session

**Data Sources:**

- `Document` model where `createdAt > user.lastLoginAt`
- `DocumentVersion` model where `createdAt > user.lastLoginAt`

**Display:**

- Document name with "NEW" or "UPDATED" badge
- Upload timestamp
- Folder location

### Widget 8: Checklist Progress (Room Admin)

**Purpose:** Track due diligence completion status

**Data Sources:**

- `Checklist` and `ChecklistItem` models

**Display:**

- Progress bar with percentage
- Count of completed vs total items
- List of missing items

### Widget 9: Engagement Insights

**Purpose:** Visual analytics of room/document engagement

**Data Sources:**

- `Event` model aggregated by day
- `PageView` model for detailed analytics

**Display:**

- Sparkline or bar chart of daily activity
- Key metrics (total views, unique viewers, downloads)
- Top documents list

### Widget 10: Room Announcements (Viewer)

**Purpose:** Show admin-posted updates about the room

**Data Sources:**

- `Message` model where `isAnnouncement = true`

**Display:**

- Announcement text
- Posted by + timestamp
- Room context

---

## Technical Implementation

### API Changes Required

**New Endpoint: `GET /api/dashboard/v2`**

```typescript
interface DashboardV2Response {
  user: {
    name: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    lastLoginAt: string;
  };

  // For admins
  actionRequired?: {
    unansweredQuestions: number;
    pendingAccessRequests: number;
    pendingReviews: number;
    items: ActionItem[];
  };

  messages?: {
    unreadCount: number;
    recent: MessagePreview[];
  };

  myRooms?: RoomSummary[];

  recentActivity?: ActivityItem[];

  // For viewers
  continueReading?: {
    documentId: string;
    name: string;
    page: number;
    totalPages: number;
    lastViewedAt: string;
  }[];

  bookmarks?: BookmarkItem[];

  newSinceLastVisit?: {
    documents: DocumentSummary[];
    updates: DocumentSummary[];
  };

  myQuestions?: QuestionSummary[];

  announcements?: Announcement[];

  // Shared
  engagementInsights?: {
    period: '7d' | '30d';
    totalViews: number;
    uniqueViewers: number;
    downloads: number;
    dailyActivity: { date: string; views: number }[];
    topDocuments: { id: string; name: string; views: number }[];
  };

  checklistProgress?: {
    checklistId: string;
    name: string;
    completedCount: number;
    totalCount: number;
    missingItems: string[];
  }[];
}
```

### Component Structure

```
src/components/dashboard/
├── AdminDashboard.tsx          # Org Owner/Admin layout
├── RoomAdminDashboard.tsx      # Room Admin layout
├── ViewerDashboard.tsx         # Link-based viewer layout
├── widgets/
│   ├── ActionRequiredCard.tsx
│   ├── MessagesCard.tsx
│   ├── MyRoomsCard.tsx
│   ├── RecentActivityFeed.tsx
│   ├── ContinueReadingCard.tsx
│   ├── BookmarksCard.tsx
│   ├── NewDocumentsCard.tsx
│   ├── MyQuestionsCard.tsx
│   ├── ChecklistProgressCard.tsx
│   ├── EngagementChart.tsx
│   ├── AnnouncementsCard.tsx
│   └── WelcomeBanner.tsx
└── hooks/
    └── useDashboardData.ts
```

### Database Schema Additions

```prisma
// Add to User model
model User {
  // ... existing fields
  lastLoginAt DateTime?
}

// Add to Message model (if not exists)
model Message {
  // ... existing fields
  isAnnouncement Boolean @default(false)
}

// Ensure PageView tracks page number for "continue reading"
model PageView {
  // ... existing fields
  pageNumber Int?
}
```

---

## Migration Path

### Phase 1: API Updates

1. Add `lastLoginAt` tracking to session/login flow
2. Create `GET /api/dashboard/v2` endpoint
3. Add missing data aggregation queries

### Phase 2: Widget Components

1. Build individual widget components
2. Add loading/empty states
3. Ensure responsive design

### Phase 3: Dashboard Layouts

1. Create role-specific dashboard layouts
2. Implement dashboard routing by role
3. Update navigation

### Phase 4: Polish

1. Add animations/transitions
2. Implement widget collapse/expand
3. Add mobile-optimized views
4. User testing and feedback

---

## Success Metrics

| Metric                          | Current                 | Target                |
| ------------------------------- | ----------------------- | --------------------- |
| Time to first meaningful action | Unknown                 | < 5 seconds           |
| Dashboard bounce rate           | Unknown                 | < 20%                 |
| Questions response time         | Unknown                 | Decrease by 30%       |
| User satisfaction (feedback)    | "Awkward, not valuable" | "Helpful, actionable" |

---

## References

- [Orangedox: How to Choose a VDR](https://www.orangedox.com/blog/choosing-virtual-data-room)
- [Peony: VDR Features That Matter](https://www.peony.ink/blog/virtual-data-room-features)
- [Datasite vs Intralinks Comparison](https://firmroom.com/blog/datasite-vs-intralinks)
- [TeamHub: Document Management Dashboard Guide](https://teamhub.com/blog/a-comprehensive-guide-to-utilizing-a-document-management-dashboard/)
- [SaaSFrame: Dashboard UI Examples](https://www.saasframe.io/categories/dashboard)
- [UX Collective: Designing B2B SaaS Dashboards](https://uxdesign.cc/design-thoughtful-dashboards-for-b2b-saas-ff484385960d)

---

## Appendix: Current vs. Proposed Comparison

### Current Dashboard Issues

1. **Vanity metrics**: "47 documents" tells you nothing actionable
2. **No role awareness**: Everyone sees the same generic view
3. **No urgency indicators**: Can't see what needs attention
4. **Missing key features**: No messages, bookmarks, questions
5. **No "since last visit"**: Users don't know what's changed
6. **Passive activity feed**: Shows history, not action items

### Proposed Improvements

1. **Action-oriented**: "3 items need attention" with direct links
2. **Role-specific views**: Admins see oversight, viewers see content
3. **Priority surfacing**: Unanswered questions, pending requests at top
4. **Feature integration**: Messages, bookmarks, Q&A integrated
5. **Context-aware**: "New since last visit" highlights changes
6. **Actionable activity**: Activity items are clickable and contextual
