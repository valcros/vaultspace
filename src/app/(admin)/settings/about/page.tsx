'use client';

import * as React from 'react';
import { Copyright, Scale, Sparkles } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { AdminPageContent, AdminToolbar } from '@/components/layout/admin-page';

const APP_VERSION = '0.1.0';
const CREATOR = 'Mark W Munger';
const COPYRIGHT_YEAR = '2026';

export default function AboutPage() {
  return (
    <>
      <PageHeader title="About" description="Product information, attribution, and license" />

      <AdminPageContent>
        <AdminToolbar
          title="About VaultSpace"
          description="Secure virtual data room platform for M&A, fundraising, and other confidential transactions."
        />

        <div className="grid gap-5 md:grid-cols-2">
          <Card className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-950 dark:text-white">
                <Sparkles className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                VaultSpace
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-slate-500 dark:text-slate-400">Version {APP_VERSION}</p>
            </CardContent>
          </Card>

          <Card className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-950 dark:text-white">
                <Copyright className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                Attribution
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-slate-600 dark:text-slate-300">Created by {CREATOR}.</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Copyright &copy; {COPYRIGHT_YEAR} {CREATOR}. All rights reserved.
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900 md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-950 dark:text-white">
                <Scale className="h-5 w-5 text-sky-600 dark:text-sky-300" />
                License
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Distributed under the GNU Affero General Public License v3.0 (AGPL-3.0).
              </p>
            </CardContent>
          </Card>
        </div>
      </AdminPageContent>
    </>
  );
}
