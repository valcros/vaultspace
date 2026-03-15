'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Users,
  Bell,
  Activity,
  ChevronRight,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';

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
    id: 'notifications',
    title: 'Notifications',
    description: 'Configure email notification preferences',
    icon: Bell,
    href: '/settings/notifications',
  },
  {
    id: 'activity',
    title: 'Activity Log',
    description: 'View settings changes and security events',
    icon: Activity,
    href: '/settings/activity',
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

      <div className="p-6">
        <div className="grid gap-4 md:grid-cols-2">
          {settingsSections.map((section) => {
            const Icon = section.icon;
            return (
              <Card
                key={section.id}
                className="cursor-pointer hover:border-primary-200 hover:shadow-md transition-all"
                onClick={() => router.push(section.href)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-neutral-900">{section.title}</h3>
                      <p className="text-sm text-neutral-500 mt-1">{section.description}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-neutral-400 flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
