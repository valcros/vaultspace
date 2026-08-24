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
  Sliders,
  CheckCircle2,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
    governance?: string;
    status?: string;
  };
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    isActive?: boolean;
    roomCount: number;
    userCount: number;
    usagePercentage: number;
    quotaAlertLevel: 'NORMAL' | 'WARNING_90' | 'CRITICAL_98';
    createdAt: string;
    lastAccessAt: string | null;
  }>;
}

type SortField =
  | 'name'
  | 'slug'
  | 'roomCount'
  | 'userCount'
  | 'usagePercentage'
  | 'isActive'
  | 'createdAt'
  | 'lastAccessAt';
type StatusFilter = 'all' | 'active' | 'disabled';

function formatTenantDate(value: string | null) {
  if (!value) {
    return 'Never';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function SysOpOverviewPage() {
  const [data, setData] = React.useState<SysOpOverviewData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [selectedOrg, setSelectedOrg] = React.useState<{ id: string; name: string } | null>(null);
  const [newQuotaGb, setNewQuotaGb] = React.useState('10');
  const [quotaUpdating, setQuotaUpdating] = React.useState(false);
  const [quotaSuccessMsg, setQuotaSuccessMsg] = React.useState<string | null>(null);
  const [orgActionId, setOrgActionId] = React.useState<string | null>(null);
  const [bulkPreview, setBulkPreview] = React.useState<{
    count: number;
    organizations: Array<{ id: string; name: string; slug: string }>;
  } | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkResult, setBulkResult] = React.useState<string | null>(null);

  // Sorting & Filtering State
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('active');
  const [sortField, setSortField] = React.useState<SortField>('name');
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const activeCount = React.useMemo(
    () => data?.organizations.filter((o) => o.isActive !== false).length ?? 0,
    [data?.organizations]
  );
  const disabledCount = React.useMemo(
    () => data?.organizations.filter((o) => o.isActive === false).length ?? 0,
    [data?.organizations]
  );

  const filteredAndSortedOrgs = React.useMemo(() => {
    if (!data?.organizations) {
      return [];
    }
    let list = [...data.organizations];

    // Status filter
    if (statusFilter === 'active') {
      list = list.filter((o) => o.isActive !== false);
    } else if (statusFilter === 'disabled') {
      list = list.filter((o) => o.isActive === false);
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q)
      );
    }

    // Sorting
    list.sort((a, b) => {
      let valA: string | number = (a[sortField] as string | number | null | undefined) ?? 0;
      let valB: string | number = (b[sortField] as string | number | null | undefined) ?? 0;

      if (sortField === 'isActive') {
        valA = a.isActive !== false ? 1 : 0;
        valB = b.isActive !== false ? 1 : 0;
      } else if (sortField === 'createdAt' || sortField === 'lastAccessAt') {
        valA = a[sortField] ? Date.parse(a[sortField]) : 0;
        valB = b[sortField] ? Date.parse(b[sortField]) : 0;
      }

      if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB);
        return sortDirection === 'asc' ? cmp : -cmp;
      }

      if (valA < valB) {
        return sortDirection === 'asc' ? -1 : 1;
      }
      if (valA > valB) {
        return sortDirection === 'asc' ? 1 : -1;
      }
      return 0;
    });

    return list;
  }, [data?.organizations, statusFilter, searchQuery, sortField, sortDirection]);

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

  // Live 5-second auto refresh interval when toggled
  React.useEffect(() => {
    if (!autoRefresh) {
      return;
    }
    const interval = setInterval(() => {
      fetchOverview();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchOverview]);

  const handleUpdateQuota = async () => {
    if (!selectedOrg) {
      return;
    }
    setQuotaUpdating(true);
    setQuotaSuccessMsg(null);
    try {
      const res = await fetch(`/api/sysop/organizations/${selectedOrg.id}/quota`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotaGb: Number(newQuotaGb) }),
      });
      const json = await res.json();
      if (res.ok) {
        setQuotaSuccessMsg(json.message);
        setTimeout(() => {
          setSelectedOrg(null);
          setQuotaSuccessMsg(null);
          fetchOverview();
        }, 1200);
      } else {
        alert(json.error || 'Failed to update quota');
      }
    } catch {
      alert('Error saving quota update');
    } finally {
      setQuotaUpdating(false);
    }
  };

  const handleToggleOrg = async (orgId: string, targetActive: boolean) => {
    setOrgActionId(orgId);
    try {
      const res = await fetch(`/api/sysop/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: targetActive }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || `Failed to ${targetActive ? 'enable' : 'disable'} organization`);
      } else {
        await fetchOverview();
      }
    } finally {
      setOrgActionId(null);
    }
  };

  const handleBulkDryRun = async () => {
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await fetch('/api/sysop/organizations/bulk-disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await res.json();
      if (res.ok) {
        setBulkPreview({ count: json.count, organizations: json.organizations });
      } else {
        alert(json.error || 'Failed to preview cleanup');
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkExecute = async () => {
    if (!bulkPreview) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch('/api/sysop/organizations/bulk-disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun: false,
          confirmIds: bulkPreview.organizations.map((o) => o.id),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setBulkResult(`Disabled ${json.disabledCount} organization(s).`);
        setBulkPreview(null);
        await fetchOverview();
      } else {
        alert(json.error || 'Failed to execute cleanup');
      }
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Title & Controls */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            <Server className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            Platform Control & Observability
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Top-down cross-tenant operational metrics and infrastructure telemetry.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-xs ${
              autoRefresh
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'border-slate-300 text-slate-700 dark:border-slate-800 dark:text-slate-300'
            }`}
          >
            <Activity className={`mr-1.5 h-3.5 w-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            {autoRefresh ? 'Live Auto-Polling ON' : 'Live Auto-Polling OFF'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchOverview}
            disabled={loading}
            className="border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
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
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Summary Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total Tenants
            </CardTitle>
            <Building2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16 bg-slate-200 dark:bg-slate-800" />
            ) : (
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {data?.summary.totalOrganizations ?? 0}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">Provisioned Organizations</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Registered Users
            </CardTitle>
            <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16 bg-slate-200 dark:bg-slate-800" />
            ) : (
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {data?.summary.totalUsers ?? 0}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">Cross-Tenant Platform Accounts</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Active Data Rooms
            </CardTitle>
            <FolderLock className="h-4 w-4 text-amber-500 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16 bg-slate-200 dark:bg-slate-800" />
            ) : (
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {data?.summary.totalRooms ?? 0}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              {data?.summary.totalDocuments ?? 0} Documents Hosted
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Quota Alerts
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-rose-500 dark:text-rose-400" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16 bg-slate-200 dark:bg-slate-800" />
            ) : (
              <div className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-white">
                {data?.summary.quotaAlertsCount ?? 0}
                {data?.summary.quotaAlertsCount ? (
                  <Badge className="border-rose-500/30 bg-rose-500/20 text-[10px] text-rose-700 dark:text-rose-300">
                    Action Required
                  </Badge>
                ) : (
                  <Badge className="border-emerald-500/30 bg-emerald-500/20 text-[10px] text-emerald-700 dark:text-emerald-400">
                    All Healthy
                  </Badge>
                )}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-500">Tenants ≥ 90% Storage Limit</p>
          </CardContent>
        </Card>
      </div>

      {/* Platform Telemetry */}
      <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
        <CardHeader className="border-b border-slate-200 pb-3 dark:border-slate-800/80">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-white">
                <Server className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                Platform Telemetry
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Coarse service health for authorized operators. Detailed infrastructure identifiers
                are not displayed.
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="border-indigo-500/30 bg-indigo-500/10 text-xs text-indigo-700 dark:text-indigo-300"
            >
              {data?.infrastructure.environment ?? 'Managed deployment'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-800/60 dark:bg-slate-950/60">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Application Service
            </span>
            <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-200">
              {data?.infrastructure.status === 'HEALTHY' ? 'Available' : 'Status unavailable'}
            </p>
            <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span> Active (100% Traffic)
            </p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-800/60 dark:bg-slate-950/60">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Data Service
            </span>
            <p className="truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-200">
              {data?.infrastructure.status === 'HEALTHY' ? 'Available' : 'Status unavailable'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Connectivity status is verified by the health contract.
            </p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-800/60 dark:bg-slate-950/60">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Optional Services
            </span>
            <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-200">
              Capability-dependent
            </p>
            <p className="text-xs text-indigo-600 dark:text-indigo-400">
              Availability is reported without infrastructure details.
            </p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-800/60 dark:bg-slate-950/60">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Background Processing
            </span>
            <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-200">
              {data?.infrastructure.status === 'HEALTHY' ? 'Available' : 'Status unavailable'}
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Operational details are restricted.
            </p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-800/60 dark:bg-slate-950/60">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Governance Framework
            </span>
            <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
              {data?.infrastructure.governance || 'Platform operating controls'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Privileged actions remain independently audited.
            </p>
          </div>

          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-800/60 dark:bg-slate-950/60">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Maintenance Window
            </span>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">
              Scheduled notices only
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Maintenance details are communicated through approved channels.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tenant Directory with Quota Controls */}
      <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
        <CardHeader>
          <CardTitle className="text-base text-slate-900 dark:text-white">
            Tenant Directory & Storage Management
          </CardTitle>
          <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
            Organizations provisioned across the platform. Active tenants are shown by default; use
            the status filter to include disabled tenants. Disabling a tenant blocks its logins
            immediately and is reversible.
          </CardDescription>
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
            {bulkResult ? (
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {bulkResult}
              </p>
            ) : bulkPreview ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  {bulkPreview.count} junk organization(s) match cleanup (0 rooms, ≤1 user;
                  protected tenants excluded). Disable all? This is reversible.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={bulkBusy || bulkPreview.count === 0}
                    onClick={handleBulkExecute}
                    className="h-7 bg-rose-600 text-[11px] text-white hover:bg-rose-700"
                  >
                    {bulkBusy ? 'Disabling…' : `Disable ${bulkPreview.count}`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => setBulkPreview(null)}
                    className="h-7 text-[11px]"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkBusy}
                onClick={handleBulkDryRun}
                className="h-7 text-[11px] text-rose-700 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-950/40"
              >
                {bulkBusy ? 'Scanning…' : 'Preview junk-org cleanup'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-800" />
              <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-800" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Search and Status Filter Controls */}
              <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative max-w-sm flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    type="text"
                    placeholder="Search tenants by name or slug..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 pl-9 text-xs"
                  />
                </div>

                <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      statusFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    All ({data?.organizations.length ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('active')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      statusFilter === 'active'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Active ({activeCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('disabled')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      statusFilter === 'disabled'
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                    Disabled ({disabledCount})
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                  <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <tr>
                      <th
                        onClick={() => handleSort('name')}
                        className="group cursor-pointer select-none px-3 py-2.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        Organization Name{' '}
                        {sortField !== 'name' ? (
                          <ArrowUpDown className="ml-1 inline-block h-3 w-3 text-slate-400 opacity-50 group-hover:opacity-100" />
                        ) : sortDirection === 'asc' ? (
                          <ArrowUp className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <ArrowDown className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </th>
                      <th
                        onClick={() => handleSort('slug')}
                        className="group cursor-pointer select-none px-3 py-2.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        Slug{' '}
                        {sortField !== 'slug' ? (
                          <ArrowUpDown className="ml-1 inline-block h-3 w-3 text-slate-400 opacity-50 group-hover:opacity-100" />
                        ) : sortDirection === 'asc' ? (
                          <ArrowUp className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <ArrowDown className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </th>
                      <th
                        onClick={() => handleSort('roomCount')}
                        className="group cursor-pointer select-none px-3 py-2.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        Rooms{' '}
                        {sortField !== 'roomCount' ? (
                          <ArrowUpDown className="ml-1 inline-block h-3 w-3 text-slate-400 opacity-50 group-hover:opacity-100" />
                        ) : sortDirection === 'asc' ? (
                          <ArrowUp className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <ArrowDown className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </th>
                      <th
                        onClick={() => handleSort('userCount')}
                        className="group cursor-pointer select-none px-3 py-2.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        Users{' '}
                        {sortField !== 'userCount' ? (
                          <ArrowUpDown className="ml-1 inline-block h-3 w-3 text-slate-400 opacity-50 group-hover:opacity-100" />
                        ) : sortDirection === 'asc' ? (
                          <ArrowUp className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <ArrowDown className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </th>
                      <th
                        onClick={() => handleSort('usagePercentage')}
                        className="group cursor-pointer select-none px-3 py-2.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        Storage Usage{' '}
                        {sortField !== 'usagePercentage' ? (
                          <ArrowUpDown className="ml-1 inline-block h-3 w-3 text-slate-400 opacity-50 group-hover:opacity-100" />
                        ) : sortDirection === 'asc' ? (
                          <ArrowUp className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <ArrowDown className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </th>
                      <th
                        onClick={() => handleSort('createdAt')}
                        className="group cursor-pointer select-none px-3 py-2.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        Created{' '}
                        {sortField !== 'createdAt' ? (
                          <ArrowUpDown className="ml-1 inline-block h-3 w-3 text-slate-400 opacity-50 group-hover:opacity-100" />
                        ) : sortDirection === 'asc' ? (
                          <ArrowUp className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <ArrowDown className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </th>
                      <th
                        onClick={() => handleSort('lastAccessAt')}
                        className="group cursor-pointer select-none px-3 py-2.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        Last Access{' '}
                        {sortField !== 'lastAccessAt' ? (
                          <ArrowUpDown className="ml-1 inline-block h-3 w-3 text-slate-400 opacity-50 group-hover:opacity-100" />
                        ) : sortDirection === 'asc' ? (
                          <ArrowUp className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <ArrowDown className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </th>
                      <th
                        onClick={() => handleSort('isActive')}
                        className="group cursor-pointer select-none px-3 py-2.5 hover:text-slate-900 dark:hover:text-white"
                      >
                        Status{' '}
                        {sortField !== 'isActive' ? (
                          <ArrowUpDown className="ml-1 inline-block h-3 w-3 text-slate-400 opacity-50 group-hover:opacity-100" />
                        ) : sortDirection === 'asc' ? (
                          <ArrowUp className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        ) : (
                          <ArrowDown className="ml-1 inline-block h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </th>
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                    {filteredAndSortedOrgs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                        >
                          No tenant organizations match the selected filter or search query.
                        </td>
                      </tr>
                    ) : (
                      filteredAndSortedOrgs.map((org) => (
                        <tr
                          key={org.id}
                          className="transition-colors hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-3 font-semibold text-slate-900 dark:text-white">
                            {org.name}
                          </td>
                          <td className="px-3 py-3 font-mono text-slate-500 dark:text-slate-400">
                            {org.slug}
                          </td>
                          <td className="px-3 py-3">{org.roomCount}</td>
                          <td className="px-3 py-3">{org.userCount}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center space-x-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                                <div
                                  className={`h-full ${
                                    org.usagePercentage >= 90 ? 'bg-rose-500' : 'bg-indigo-500'
                                  }`}
                                  style={{ width: `${org.usagePercentage}%` }}
                                ></div>
                              </div>
                              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                {org.usagePercentage}%
                              </span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-400">
                            {formatTenantDate(org.createdAt)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-400">
                            {formatTenantDate(org.lastAccessAt)}
                          </td>
                          <td className="px-3 py-3">
                            {org.isActive === false ? (
                              <Badge
                                variant="outline"
                                className="border-rose-500/30 bg-rose-500/10 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400"
                              >
                                Disabled
                              </Badge>
                            ) : org.quotaAlertLevel === 'CRITICAL_98' ? (
                              <Badge className="border-rose-500/30 bg-rose-500/20 text-rose-700 dark:text-rose-300">
                                Critical (98%)
                              </Badge>
                            ) : org.quotaAlertLevel === 'WARNING_90' ? (
                              <Badge className="border-amber-500/30 bg-amber-500/20 text-amber-700 dark:text-amber-300">
                                Warning (90%)
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
                              >
                                Normal
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedOrg({ id: org.id, name: org.name })}
                                className="h-7 text-[11px] text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                              >
                                <Sliders className="mr-1 h-3 w-3" />
                                Adjust Quota
                              </Button>
                              {org.isActive === false ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={orgActionId === org.id}
                                  onClick={() => handleToggleOrg(org.id, true)}
                                  className="h-7 text-[11px] text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                                >
                                  {orgActionId === org.id ? 'Enabling…' : 'Enable'}
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={orgActionId === org.id}
                                  onClick={() => handleToggleOrg(org.id, false)}
                                  className="h-7 text-[11px] text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                                >
                                  {orgActionId === org.id ? 'Disabling…' : 'Disable'}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Adjust Quota Dialog Modal */}
      <Dialog open={!!selectedOrg} onOpenChange={() => setSelectedOrg(null)}>
        <DialogContent className="border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-900 dark:text-white">
              Adjust Tenant Storage Quota
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
              Override storage limit for {selectedOrg?.name}.
            </DialogDescription>
          </DialogHeader>

          {quotaSuccessMsg ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              {quotaSuccessMsg}
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  New Quota Limit (GB)
                </label>
                <Input
                  type="number"
                  value={newQuotaGb}
                  onChange={(e) => setNewQuotaGb(e.target.value)}
                  placeholder="e.g. 10, 25, 50"
                  className="border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedOrg(null)}
              disabled={quotaUpdating}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleUpdateQuota}
              disabled={quotaUpdating}
              className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {quotaUpdating ? 'Saving...' : 'Apply Storage Limit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
