'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Users, Bell, Activity, ChevronRight } from 'lucide-react';

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
                className="cursor-pointer transition-all hover:border-primary-200 hover:shadow-md"
                onClick={() => router.push(section.href)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50">
                      <Icon className="h-5 w-5 text-primary-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-neutral-900">{section.title}</h3>
                      <p className="mt-1 text-sm text-neutral-500">{section.description}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 flex-shrink-0 text-neutral-400" />
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
