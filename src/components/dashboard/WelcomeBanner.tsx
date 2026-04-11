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
    <div className="relative mb-4 overflow-hidden rounded-[1.75rem] border border-slate-700/80 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_26%),linear-gradient(145deg,rgba(15,23,42,0.96),rgba(30,41,59,0.94)_58%,rgba(37,99,235,0.72))] p-5 text-white shadow-[0_24px_48px_-32px_rgba(2,6,23,0.92)]">
      <button
        onClick={handleDismiss}
        className="absolute right-3 top-3 rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white"
        aria-label="Dismiss welcome banner"
      >
        <X className="h-4 w-4" />
      </button>
      <h3 className="mb-1 text-base font-semibold text-white">Welcome to VaultSpace</h3>
      <p className="mb-4 text-sm text-slate-300">Get started in three steps:</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: FolderPlus,
            title: '1. Create a Room',
            desc: 'Organize documents by deal or project',
            color: 'border border-sky-400/20 bg-sky-500/14 text-sky-100',
          },
          {
            icon: Upload,
            title: '2. Upload Documents',
            desc: 'Drag and drop files into your room',
            color: 'border border-emerald-400/20 bg-emerald-500/14 text-emerald-100',
          },
          {
            icon: Share2,
            title: '3. Share Securely',
            desc: 'Invite stakeholders with controlled access',
            color: 'border border-fuchsia-400/20 bg-fuchsia-500/14 text-fuchsia-100',
          },
        ].map((step) => (
          <div
            key={step.title}
            className="flex items-start gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/40 p-3"
          >
            <div className={`shrink-0 rounded-xl p-2 ${step.color}`}>
              <step.icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-100">{step.title}</p>
              <p className="text-xs text-slate-400">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
