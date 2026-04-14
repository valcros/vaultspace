'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Users,
  Bell,
  Activity,
  Shield,
  Webhook,
  Code2,
  Keyboard,
  ChevronRight,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { AdminPageContent, AdminToolbar } from '@/components/layout/admin-page';

interface SettingsSection {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
}

const settingsSections: SettingsSection[] = [
  {
    id: 'organization',
    title: 'Organization',
    description: 'Manage organization name, logo, and branding settings',
    icon: Building2,
    href: '/settings/organization',
  },
  {
    id: 'team',
    title: 'Team Members',
    description: 'Manage users, roles, and permissions',
    icon: Users,
    href: '/users',
  },
  {
    id: 'security',
    title: 'Security',
    description: 'Manage two-factor authentication and security settings',
    icon: Shield,
    href: '/settings/security',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Configure email notification preferences',
    icon: Bell,
    href: '/settings/notifications',
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    description: 'Configure webhook endpoints for event notifications',
    icon: Webhook,
    href: '/settings/webhooks',
  },
  {
    id: 'activity',
    title: 'Activity Log',
    description: 'View settings changes and security events',
    icon: Activity,
    href: '/settings/activity',
  },
  {
    id: 'api',
    title: 'API',
    description: 'REST API documentation and OpenAPI specification',
    icon: Code2,
    href: '/settings/api',
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    description: 'Learn keyboard shortcuts for faster navigation',
    icon: Keyboard,
    href: '/settings/shortcuts',
  },
];

export default function SettingsPage() {
  const router = useRouter();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your organization settings and preferences"
      />

      <AdminPageContent>
        <AdminToolbar
          title="Configuration surfaces"
          description="Everything below maps to a distinct operational area so teams can move quickly without guessing where controls live."
        />
        <div className="grid gap-5 md:grid-cols-2">
          {settingsSections.map((section) => {
            const Icon = section.icon;
            return (
              <Card
                key={section.id}
                className="cursor-pointer rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:border-primary-200 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-800"
                onClick={() => router.push(section.href)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-sky-200/60 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-slate-950 dark:text-white">
                        {section.title}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {section.description}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-400" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </AdminPageContent>
    </>
  );
}
