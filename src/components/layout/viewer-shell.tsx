'use client';

import * as React from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ViewerShellSession {
  roomName: string;
  organizationName: string;
  organizationLogo?: string | null;
  brandColor?: string | null;
}

interface ViewerShellProps {
  session: ViewerShellSession | null;
  shareToken: string;
  activeSection: 'documents' | 'questions';
  actions?: React.ReactNode;
  onExit?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function ViewerShell({
  session,
  shareToken,
  activeSection,
  actions,
  onExit,
  children,
  className,
}: ViewerShellProps) {
  const accent = session?.brandColor || '#2563eb';

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef3ff_46%,#f8fafc_100%)] text-slate-950 dark:bg-[linear-gradient(180deg,#020617_0%,#0b1220_40%,#111827_100%)] dark:text-white">
      <div className="bg-white/96 sticky top-0 z-20 border-b border-slate-200/90 backdrop-blur-xl dark:border-slate-700 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-4">
            {session?.organizationLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.organizationLogo}
                alt={session.organizationName}
                className="h-10 max-w-[120px] object-contain"
              />
            ) : (
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl font-bold text-white shadow-[0_16px_32px_-22px_rgba(37,99,235,0.7)]"
                style={{ backgroundColor: accent }}
              >
                {session?.organizationName?.charAt(0) || 'V'}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-600 dark:text-sky-300">
                Secure Access
              </p>
              <h1 className="truncate text-lg font-semibold tracking-tight text-slate-950 dark:text-white">
                {session?.roomName || 'Shared Room'}
              </h1>
              <p className="truncate text-sm text-slate-600 dark:text-slate-300">
                Shared by {session?.organizationName || 'VaultSpace'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-2xl border border-slate-200/90 bg-slate-50/95 p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
              <Link
                href={`/view/${shareToken}/documents`}
                className={clsx(
                  'rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  activeSection === 'documents'
                    ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
                )}
              >
                Documents
              </Link>
              <Link
                href={`/view/${shareToken}/questions`}
                className={clsx(
                  'rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  activeSection === 'questions'
                    ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
                )}
              >
                Q&amp;A
              </Link>
            </div>
            {actions}
            {onExit && (
              <Button variant="outline" size="sm" onClick={onExit}>
                <LogOut className="mr-2 h-4 w-4" />
                Exit
              </Button>
            )}
          </div>
        </div>
      </div>

      <main className={clsx('mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8', className)}>
        {children}
      </main>

      <footer className="bg-white/92 dark:bg-slate-950/92 border-t border-slate-200/90 dark:border-slate-700">
        <div className="mx-auto max-w-6xl px-4 py-4 text-center text-sm text-slate-600 dark:text-slate-300 sm:px-6 lg:px-8">
          Secure document sharing powered by VaultSpace
        </div>
      </footer>
    </div>
  );
}
