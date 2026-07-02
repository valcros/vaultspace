// MOTHBALLED dashboard widget system (retired from the landing 2026-07-01).
//
// Kept for one release cycle per Advisor guidance; the dependency audit
// (docs/audit/OPTIMIZATION_AUDIT_2026-07-02.md finding 18) found no live
// importers. Delete this file and everything it exports, plus
// react-grid-layout and react-virtuoso, when the window closes.

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
export { AnnouncementsWidget } from './AnnouncementsWidget';
export { WelcomeBanner } from './WelcomeBanner';

// V2 dashboard system (react-grid-layout)
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
