import * as React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Server, Activity, ArrowLeft, Shield } from 'lucide-react';
import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export const dynamic = 'force-dynamic';

export default async function SysOpLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireAuth();
  } catch {
    redirect('/auth/login?redirect=/sysop');
  }

  if (!session?.userId) {
    redirect('/auth/login?redirect=/sysop');
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      isPlatformOperator: true,
    },
  });

  if (!user) {
    redirect('/auth/login');
  }

  // SysOp RBAC: gate on the explicit platform-operator grant, NOT on org role
  // or email spelling. See requirePlatformOperator() — the /api/sysop/* routes
  // enforce the same grant server-side.
  if (!user.isActive || !user.isPlatformOperator) {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {/* Top SysOp Navigation Header */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white shadow-lg shadow-indigo-500/20">
              SO
            </div>
            <div>
              <span className="flex items-center gap-2 font-semibold tracking-tight text-slate-900 dark:text-white">
                VaultSpace SysOp Control Plane
                <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
                  Platform Operator
                </span>
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                DA-VAL-001 Governed Operations
              </p>
            </div>
          </div>

          <nav className="flex items-center space-x-1 border-l border-slate-200 pl-4 dark:border-slate-800">
            <Link
              href="/sysop"
              className="flex items-center space-x-2 rounded-md px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <Server className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span>Platform Overview</span>
            </Link>
            <Link
              href="/sysop/security"
              className="flex items-center space-x-2 rounded-md px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <Shield className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              <span>Security & IP Allowlist</span>
            </Link>
            <Link
              href="/sysop/runner"
              className="flex items-center space-x-2 rounded-md px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Autonomous Runner</span>
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-3">
          <ThemeToggle />

          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{user.email}</p>
          </div>

          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Link href="/rooms">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Exit to App
            </Link>
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-6 md:p-8">{children}</main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white px-6 py-4 text-center text-xs text-slate-500 dark:border-slate-900 dark:bg-slate-950 dark:text-slate-500">
        VaultSpace SysOp Control Plane &bull; DA-VAL-001 Value & Simplicity Gate Active &bull;
        Munger Subscription 1
      </footer>
    </div>
  );
}
