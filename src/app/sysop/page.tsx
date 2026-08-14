'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Building2,
  Users,
  FolderLock,
  AlertTriangle,
  Server,
  Activity,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export const dynamic = 'force-dynamic';

interface SysOpOverviewData {
  timestamp: string;
  summary: {
    totalOrganizations: number;
    totalUsers: number;
    totalRooms: number;
    totalDocuments: number;
    quotaAlertsCount: number;
  };
  infrastructure: {
    environment: string;
    subscription: string;
    webApp: string;
    databaseHost: string;
    aiService: string;
    vmHost: string;
    governance: string;
  };
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    roomCount: number;
    userCount: number;
    usagePercentage: number;
    quotaAlertLevel: 'NORMAL' | 'WARNING_90' | 'CRITICAL_98';
    createdAt: string;
  }>;
}

export default function SysOpOverviewPage() {
  const [data, setData] = React.useState<SysOpOverviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchOverview = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sysop/overview');
      if (!res.ok) {
        throw new Error('Failed to load SysOp overview data');
      }
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching SysOp data');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  return (
    <div className="space-y-6">
      {/* Top Title & Refresh */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-white">
            <Server className="h-6 w-6 text-indigo-400" />
            Platform Control & Observability
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Top-down cross-tenant operational metrics and infrastructure telemetry.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOverview}
            disabled={loading}
            className="border-slate-800 bg-slate-900 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Telemetry
          </Button>

          <Button
            size="sm"
            asChild
            className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            <Link href="/sysop/runner">
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              Runner Status
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Summary Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">Total Tenants</CardTitle>
            <Building2 className="h-4 w-4 text-indigo-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-2xl font-bold text-white">
                {data?.summary.totalOrganizations ?? 0}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">Provisioned Organizations</p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">Registered Users</CardTitle>
            <Users className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-2xl font-bold text-white">{data?.summary.totalUsers ?? 0}</div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">Cross-Tenant Platform Accounts</p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">Active Data Rooms</CardTitle>
            <FolderLock className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-2xl font-bold text-white">{data?.summary.totalRooms ?? 0}</div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              {data?.summary.totalDocuments ?? 0} Documents Hosted
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">Quota Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="flex items-center gap-2 text-2xl font-bold text-white">
                {data?.summary.quotaAlertsCount ?? 0}
                {data?.summary.quotaAlertsCount ? (
                  <Badge className="border-rose-500/30 bg-rose-500/20 text-[10px] text-rose-300">
                    Action Required
                  </Badge>
                ) : (
                  <Badge className="border-emerald-500/30 bg-emerald-500/20 text-[10px] text-emerald-400">
                    All Healthy
                  </Badge>
                )}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">Tenants ≥ 90% Storage Limit</p>
          </CardContent>
        </Card>
      </div>

      {/* Infrastructure Telemetry */}
      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
        <CardHeader className="border-b border-slate-800/80 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <Server className="h-5 w-5 text-indigo-400" />
                Infrastructure & Environment Telemetry
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs text-slate-400">
                Azure Staging Environment status and configuration boundaries.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="border-indigo-500/30 bg-indigo-500/10 text-xs text-indigo-300"
            >
              Munger Subscription 1
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1 rounded-lg border border-slate-800/60 bg-slate-950/60 p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Container Web Workload
            </span>
            <p className="font-mono text-sm font-semibold text-slate-200">
              {data?.infrastructure.webApp || 'ca-vaultspace-web--0000304'}
            </p>
            <p className="flex items-center gap-1 text-xs text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400"></span> Active (100% Traffic)
            </p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-800/60 bg-slate-950/60 p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Database Cluster
            </span>
            <p className="truncate font-mono text-sm font-semibold text-slate-200">
              {data?.infrastructure.databaseHost || 'psql-vaultspace-staging'}
            </p>
            <p className="text-xs text-slate-400">PostgreSQL 15 (SSL Required)</p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-800/60 bg-slate-950/60 p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Azure OpenAI Service
            </span>
            <p className="font-mono text-sm font-semibold text-slate-200">
              {data?.infrastructure.aiService || 'aoai-vaultspace-staging'}
            </p>
            <p className="text-xs text-indigo-400">Azure Credit Funded ($1,000+ Pool)</p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-800/60 bg-slate-950/60 p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Autonomous Agent Host
            </span>
            <p className="font-mono text-sm font-semibold text-slate-200">
              {data?.infrastructure.vmHost || 'vm-vaultspace-agent-host'}
            </p>
            <p className="text-xs text-emerald-400">Standard_D4s_v5 (4 vCPU, 16GB)</p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-800/60 bg-slate-950/60 p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Governance Framework
            </span>
            <p className="text-sm font-semibold text-indigo-300">
              {data?.infrastructure.governance || 'DA-VAL-001 Value & Simplicity Gate'}
            </p>
            <p className="text-xs text-slate-400">80/20 Pareto & Human Elevation Gate</p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-800/60 bg-slate-950/60 p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Maintenance Window
            </span>
            <p className="text-sm font-semibold text-slate-200">Saturday 12:00 AM – 1:00 AM PT</p>
            <p className="text-xs text-slate-400">Auto 5-min maintenance allowed</p>
          </div>
        </CardContent>
      </Card>

      {/* Tenant Directory */}
      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base text-white">Tenant Directory & Storage Usage</CardTitle>
          <CardDescription className="text-xs text-slate-400">
            Organizations provisioned across the platform. Quota alerts trigger at 90% and 98%
            thresholds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full bg-slate-800" />
              <Skeleton className="h-10 w-full bg-slate-800" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Organization Name</th>
                    <th className="px-3 py-2.5">Slug</th>
                    <th className="px-3 py-2.5">Rooms</th>
                    <th className="px-3 py-2.5">Users</th>
                    <th className="px-3 py-2.5">Storage Usage</th>
                    <th className="px-3 py-2.5">Quota Alert Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {data?.organizations.map((org) => (
                    <tr key={org.id} className="transition-colors hover:bg-slate-800/40">
                      <td className="px-3 py-3 font-semibold text-white">{org.name}</td>
                      <td className="px-3 py-3 font-mono text-slate-400">{org.slug}</td>
                      <td className="px-3 py-3">{org.roomCount}</td>
                      <td className="px-3 py-3">{org.userCount}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full ${
                                org.usagePercentage >= 90 ? 'bg-rose-500' : 'bg-indigo-500'
                              }`}
                              style={{ width: `${org.usagePercentage}%` }}
                            ></div>
                          </div>
                          <span className="font-mono text-[11px] text-slate-400">
                            {org.usagePercentage}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {org.quotaAlertLevel === 'CRITICAL_98' ? (
                          <Badge className="border-rose-500/30 bg-rose-500/20 text-rose-300">
                            Critical (98%)
                          </Badge>
                        ) : org.quotaAlertLevel === 'WARNING_90' ? (
                          <Badge className="border-amber-500/30 bg-amber-500/20 text-amber-300">
                            Warning (90%)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-slate-700 text-slate-400">
                            Normal
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
