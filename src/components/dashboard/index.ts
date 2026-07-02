// Dashboard widgets - Role-aware dashboard components

// V1 widgets (legacy)
export { DashboardWidget, WidgetListItem } from './DashboardWidget';
export { ActionRequiredWidget } from './ActionRequiredWidget';
export { MessagesWidget } from './MessagesWidget';
export { MyRoomsWidget, MyRoomsCompactWidget } from './MyRoomsWidget';
export { RecentActivityWidget, ActivityTimeline } from './RecentActivityWidget';
export { ContinueReadingWidget } from './ContinueReadingWidget';
export { BookmarksWidget } from './BookmarksWidget';
export { NewDocumentsWidget } from './NewDocumentsWidget';
export { MyQuestionsWidget } from './MyQuestionsWidget';
export { ChecklistProgressWidget, ChecklistQuickProgress } from './ChecklistProgressWidget';
export { EngagementWidget, EngagementOverviewCard } from './EngagementWidget';
export { AnnouncementsWidget, FeaturedAnnouncement } from './AnnouncementsWidget';
export { WelcomeBanner } from './WelcomeBanner';

// Rooms-first landing (2026-07 redesign)
export { RoomOverviewCard } from './RoomOverviewCard';
export type { RoomOverview } from './RoomOverviewCard';
export { AttentionStrip } from './AttentionStrip';
export type { AttentionChip } from './AttentionStrip';
export { YourWorkStrip } from './YourWorkStrip';
export type { YourWorkItem } from './YourWorkStrip';
export { VaultTombstone } from './VaultTombstone';

// V2 dashboard system (modern grid layout, retired from the landing page 2026-07;
// kept for the mothball window pending dependency audit)
export { DashboardWidgetV2, WidgetListItemV2 } from './DashboardWidgetV2';
export {
  DashboardProvider,
  useDashboardContext,
  useWidgetCollapsed,
  useDensityClasses,
} from './DashboardContext';
export { DashboardGrid, GridWidget } from './DashboardGrid';
export { DashboardControls, EditModeNotice } from './DashboardControls';
export { VirtualWidgetList, ScrollableContent } from './VirtualWidgetList';
export { MobileStackedDashboard } from './MobileStackedDashboard';
