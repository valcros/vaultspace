import * as React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Server, Activity, ArrowLeft } from 'lucide-react';
import { requireAuth } from '@/lib/middleware';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';

export default async function SysOpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top SysOp Navigation Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 px-6 py-3 backdrop-blur sticky top-0 z-50 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
              SO
            </div>
            <div>
              <span className="font-semibold text-white tracking-tight flex items-center gap-2">
                VaultSpace SysOp Control Plane
                <span className="text-[10px] uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded-full font-semibold">
                  Platform Operator
                </span>
              </span>
              <p className="text-xs text-slate-400">
                DA-VAL-001 Governed Operations
              </p>
            </div>
          </div>

          <nav className="flex items-center space-x-1 pl-4 border-l border-slate-800">
            <Link
              href="/sysop"
              className="flex items-center space-x-2 px-3 py-1.5 text-xs font-medium rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              <Server className="h-4 w-4 text-indigo-400" />
              <span>Platform Overview</span>
            </Link>
            <Link
              href="/sysop/runner"
              className="flex items-center space-x-2 px-3 py-1.5 text-xs font-medium rounded-md hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              <Activity className="h-4 w-4 text-emerald-400" />
              <span>Autonomous Runner</span>
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium text-slate-200">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-[11px] text-slate-400">{user.email}</p>
          </div>

          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white text-xs"
          >
            <Link href="/dashboard">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Exit to App
            </Link>
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-4 text-center text-xs text-slate-500">
        VaultSpace SysOp Control Plane &bull; DA-VAL-001 Value & Simplicity Gate Active &bull; REDACTED
      </footer>
    </div>
  );
}
