'use client';

import * as React from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';

interface AppShellProps {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    imageUrl?: string | null;
  };
}

export function AppShell({ children, user }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex">
        <Sidebar user={user} collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
            <Sidebar user={user} />
          </div>
        </>
      )}

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header user={user} onMenuClick={() => setMobileMenuOpen(true)} />
        <main
          tabIndex={0}
          aria-label="Main content"
          className="flex-1 overflow-y-auto p-4 focus:outline-none lg:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
