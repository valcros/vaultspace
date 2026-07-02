// Dashboard components — LIVE exports only.
//
// The retired react-grid-layout widget system lives in ./legacy.ts for the
// mothball window. Do not re-export it here: this barrel is imported by the
// landing route, and anything exported from it lands in that route's bundle.

// Rooms-first landing (2026-07 redesign)
export { RoomOverviewCard } from './RoomOverviewCard';
export type { RoomOverview } from './RoomOverviewCard';
export { AttentionStrip } from './AttentionStrip';
export type { AttentionChip } from './AttentionStrip';
export { YourWorkStrip } from './YourWorkStrip';
export type { YourWorkItem } from './YourWorkStrip';
export { VaultTombstone } from './VaultTombstone';
export { VaultRing } from './VaultRing';
export { FeaturedAnnouncement } from './FeaturedAnnouncement';
