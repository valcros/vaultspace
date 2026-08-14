import * as React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Server, Activity, ArrowLeft } from 'lucide-react';
import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';

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
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  if (!user) {
    redirect('/auth/login');
  }

  // SysOp RBAC Check: Ensure user is authorized
  const isSysOp = user.email.includes('munger') || user.email.includes('admin');
  if (!isSysOp) {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 font-sans text-slate-100">
      {/* Top SysOp Navigation Header */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6 py-3 backdrop-blur">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white shadow-lg shadow-indigo-500/20">
              SO
            </div>
            <div>
              <span className="flex items-center gap-2 font-semibold tracking-tight text-white">
                VaultSpace SysOp Control Plane
                <span className="rounded-full border border-indigo-500/30 bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                  Platform Operator
                </span>
              </span>
              <p className="text-xs text-slate-400">DA-VAL-001 Governed Operations</p>
            </div>
          </div>

          <nav className="flex items-center space-x-1 border-l border-slate-800 pl-4">
            <Link
              href="/sysop"
              className="flex items-center space-x-2 rounded-md px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <Server className="h-4 w-4 text-indigo-400" />
              <span>Platform Overview</span>
            </Link>
            <Link
              href="/sysop/runner"
              className="flex items-center space-x-2 rounded-md px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <Activity className="h-4 w-4 text-emerald-400" />
              <span>Autonomous Runner</span>
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium text-slate-200">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-[11px] text-slate-400">{user.email}</p>
          </div>

          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-slate-800 bg-slate-900 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Link href="/dashboard">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Exit to App
            </Link>
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-6 md:p-8">{children}</main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-4 text-center text-xs text-slate-500">
        VaultSpace SysOp Control Plane &bull; DA-VAL-001 Value & Simplicity Gate Active &bull;
        REDACTED
      </footer>
    </div>
  );
}
