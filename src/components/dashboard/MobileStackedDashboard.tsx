'use client';

import * as React from 'react';
import type { WidgetId } from '@/types/dashboard';
import { getMobileOrder } from '@/lib/dashboard-defaults';

interface MobileStackedDashboardProps {
  role: 'ADMIN' | 'VIEWER';
  /** Render function for each widget */
  renderWidget: (widgetId: WidgetId) => React.ReactNode;
}

/**
 * Mobile dashboard layout (< 768px).
 * Fixed vertical stack based on role - no customization.
 */
export function MobileStackedDashboard({ role, renderWidget }: MobileStackedDashboardProps) {
  const widgetOrder = getMobileOrder(role);

  return (
    <div className="space-y-4">
      {widgetOrder.map((widgetId) => (
        <div key={widgetId}>{renderWidget(widgetId)}</div>
      ))}
    </div>
  );
}
