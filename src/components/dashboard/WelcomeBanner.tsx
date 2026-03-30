'use client';

import * as React from 'react';
import { FolderPlus, Upload, Share2, X } from 'lucide-react';

interface WelcomeBannerProps {
  roomCount: number;
}

export function WelcomeBanner({ roomCount }: WelcomeBannerProps) {
  const [dismissed, setDismissed] = React.useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('vaultspace-welcome-dismissed') === 'true';
    }
    return false;
  });

  if (dismissed || roomCount > 1) {
    return null;
  }

  return (
    <div className="relative mb-4 overflow-hidden rounded-xl border border-primary-100 bg-gradient-to-r from-primary-50 to-white p-5">
      <button
        onClick={() => {
          setDismissed(true);
          localStorage.setItem('vaultspace-welcome-dismissed', 'true');
        }}
        className="absolute right-3 top-3 rounded-md p-1 text-neutral-400 hover:text-neutral-600"
      >
        <X className="h-4 w-4" />
      </button>
      <h3 className="mb-1 text-base font-semibold text-neutral-900">Welcome to VaultSpace</h3>
      <p className="mb-4 text-sm text-neutral-500">Get started in three steps:</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: FolderPlus,
            title: '1. Create a Room',
            desc: 'Organize documents by deal or project',
            color: 'text-primary-600 bg-primary-100',
          },
          {
            icon: Upload,
            title: '2. Upload Documents',
            desc: 'Drag and drop files into your room',
            color: 'text-green-600 bg-green-100',
          },
          {
            icon: Share2,
            title: '3. Share Securely',
            desc: 'Invite stakeholders with controlled access',
            color: 'text-purple-600 bg-purple-100',
          },
        ].map((step) => (
          <div key={step.title} className="flex items-start gap-3">
            <div className={`shrink-0 rounded-lg p-2 ${step.color}`}>
              <step.icon className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-800">{step.title}</p>
              <p className="text-xs text-neutral-500">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
