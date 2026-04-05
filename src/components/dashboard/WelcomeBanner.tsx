'use client';

import * as React from 'react';
import { FolderPlus, Upload, Share2, X } from 'lucide-react';

interface WelcomeBannerProps {
  /** Number of rooms the user has access to */
  roomCount: number;
  /** Whether the banner has been dismissed (from API) */
  dismissed?: boolean;
  /** Callback when user dismisses the banner */
  onDismiss?: () => void;
}

/**
 * Welcome banner shown to new users with no rooms.
 * State is persisted via API in UserDashboardLayout.welcomeBannerDismissed.
 */
export function WelcomeBanner({ roomCount, dismissed = false, onDismiss }: WelcomeBannerProps) {
  // Don't show if already dismissed or user has rooms
  if (dismissed || roomCount >= 1) {
    return null;
  }

  const handleDismiss = () => {
    onDismiss?.();
  };

  return (
    <div className="relative mb-4 overflow-hidden rounded-xl border border-primary-100 bg-gradient-to-r from-primary-50 to-white p-5 dark:border-primary-800 dark:from-primary-900/20 dark:to-neutral-800">
      <button
        onClick={handleDismiss}
        className="absolute right-3 top-3 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
        aria-label="Dismiss welcome banner"
      >
        <X className="h-4 w-4" />
      </button>
      <h3 className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">
        Welcome to VaultSpace
      </h3>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Get started in three steps:
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: FolderPlus,
            title: '1. Create a Room',
            desc: 'Organize documents by deal or project',
            color: 'text-primary-600 bg-primary-100 dark:text-primary-400 dark:bg-primary-900/50',
          },
          {
            icon: Upload,
            title: '2. Upload Documents',
            desc: 'Drag and drop files into your room',
            color: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/50',
          },
          {
            icon: Share2,
            title: '3. Share Securely',
            desc: 'Invite stakeholders with controlled access',
            color: 'text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/50',
          },
        ].map((step) => (
          <div key={step.title} className="flex items-start gap-3">
            <div className={`shrink-0 rounded-lg p-2 ${step.color}`}>
              <step.icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {step.title}
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
