import type { RoomStatus } from '@prisma/client';

export const ROOM_STATUS_HELP: Record<RoomStatus, { label: string; description: string }> = {
  DRAFT: {
    label: 'Draft room - Not Published - Admin Only',
    description:
      'Prepare folders and documents before sharing. Ordinary viewers and share links cannot access a draft room. An organization admin can choose Publish room from the room card’s Actions menu when it is ready. Publishing keeps existing access restrictions.',
  },
  ACTIVE: {
    label: 'Live room',
    description:
      'Published and available to people with permission. Publishing does not make the room public to everyone. An organization admin can archive it from the room card’s Actions menu to pause viewer access while retaining its contents.',
  },
  ARCHIVED: {
    label: 'Archived room',
    description:
      'Viewer access and content changes are paused; administrators can review retained content. An organization admin can choose Restore room from the room card’s Actions menu to make it active again with existing access restrictions.',
  },
  CLOSED: {
    label: 'Closed room',
    description:
      'Retained for administrator review and audit history. Viewers cannot access it and content changes are disabled. Closing cannot be undone; this room cannot be restored.',
  },
};

export const PUBLISH_ROOM_HELP =
  'Publishing activates this room so people with permission can access it. Existing access restrictions still apply. This does not make the room public to everyone. You can prepare folders and documents while it remains in Draft.';
