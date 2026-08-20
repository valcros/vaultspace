'use client';

import * as React from 'react';
import {
  Shield,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Lock,
  Globe,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const dynamic = 'force-dynamic';

interface IpAllowlistEntry {
  id: string;
  cidr: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
}

interface SecurityConfig {
  currentClientIp: string | null;
  isCurrentIpCovered: boolean;
  ipAllowlistEnabled: boolean;
  entries: IpAllowlistEntry[];
}

export default function SysOpSecurityPage() {
  const [config, setConfig] = React.useState<SecurityConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = React.useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [newCidr, setNewCidr] = React.useState('');
  const [newLabel, setNewLabel] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const fetchConfig = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sysop/security/ip-allowlist');
      if (!res.ok) {
        throw new Error('Failed to load SysOp security configuration');
      }
      const json = await res.json();
      setConfig(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching security settings');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleToggleEnforcement = async () => {
    if (!config) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    setIsSubmitting(true);
    const targetState = !config.ipAllowlistEnabled;

    try {
      const res = await fetch('/api/sysop/security/ip-allowlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: targetState }),
      });
      const json = await res.json();

      if (res.ok) {
        setActionSuccess(
          `SysOp IP Allowlist enforcement successfully ${targetState ? 'ENABLED' : 'DISABLED'}`
        );
        fetchConfig();
      } else {
        setActionError(json.error || 'Failed to toggle enforcement setting');
      }
    } catch {
      setActionError('Error communicating with security enforcement service');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddEntry = async () => {
    setActionError(null);
    setActionSuccess(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/sysop/security/ip-allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidr: newCidr, label: newLabel }),
      });
      const json = await res.json();

      if (res.ok) {
        setActionSuccess(`Added CIDR ${json.entry.cidr} to SysOp allowlist`);
        setIsAddModalOpen(false);
        setNewCidr('');
        setNewLabel('');
        fetchConfig();
      } else {
        setActionError(json.error || 'Failed to add IP allowlist entry');
      }
    } catch {
      setActionError('Error adding allowlist entry');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEntry = async (id: string, cidr: string) => {
    setActionError(null);
    setActionSuccess(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/sysop/security/ip-allowlist/${id}`, {
        method: 'DELETE',
      });
      const json = await res.json();

      if (res.ok) {
        setActionSuccess(`Removed ${cidr} from SysOp allowlist`);
        fetchConfig();
      } else {
        setActionError(json.error || 'Failed to delete allowlist entry');
      }
    } catch {
      setActionError('Error deleting allowlist entry');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            <Shield className="h-6 w-6 text-rose-600 dark:text-rose-400" />
            SysOp Security & In-App IP Allowlist
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure application-level IP allowlisting and self-lockout enforcement for the /sysop control plane.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchConfig}
          disabled={loading}
          className="border-slate-300 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm font-medium text-rose-800 dark:border-rose-800 dark:bg-rose-950/70 dark:text-rose-200">
          <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          {actionSuccess}
        </div>
      )}

      {/* Current Connection & Self-Lockout Safety Card */}
      <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
        <CardHeader className="pb-3">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-white">
                <Globe className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                Active Client Network Connection
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                Self-lockout guard validates your active connection before applying enforcement changes.
              </CardDescription>
            </div>

            {loading ? (
              <Skeleton className="h-6 w-32 bg-slate-200 dark:bg-slate-800" />
            ) : config?.isCurrentIpCovered ? (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-500" />
                IP Matched & Authorized
              </Badge>
            ) : (
              <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mr-1 h-3.5 w-3.5 text-amber-500" />
                IP Unmatched
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Your Current Client IP
              </span>
              <p className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white">
                {config?.currentClientIp || 'Resolving...'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Global Enforcement Status
              </span>
              <p className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white">
                {config?.ipAllowlistEnabled ? (
                  <span className="text-emerald-600 dark:text-emerald-400">ACTIVE (Enforced)</span>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">DISABLED (Permissive)</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50/60 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/30">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-indigo-950 dark:text-indigo-200">
                Toggle In-App IP Allowlist Enforcement
              </p>
              <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80">
                When enabled, non-matching IPs are blocked with HTTP 403. Self-lockout guard prevents enabling if your current IP is missing.
              </p>
            </div>

            <Button
              onClick={handleToggleEnforcement}
              disabled={isSubmitting || loading}
              className={
                config?.ipAllowlistEnabled
                  ? 'bg-rose-600 font-semibold text-white hover:bg-rose-700'
                  : 'bg-emerald-600 font-semibold text-white hover:bg-emerald-700'
              }
            >
              {config?.ipAllowlistEnabled ? 'Disable Enforcement' : 'Enable Enforcement'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Allowlist Entries Table */}
      <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base text-slate-900 dark:text-white">
              Authorized IP Ranges & CIDR Subnets
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
              Exact IPv4/IPv6 addresses or CIDR blocks permitted to access SysOp pages and APIs.
            </CardDescription>
          </div>

          <Button
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add IP / CIDR
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-800" />
              <Skeleton className="h-10 w-full bg-slate-200 dark:bg-slate-800" />
            </div>
          ) : config?.entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              No IP allowlist entries configured. Click &quot;Add IP / CIDR&quot; to authorize an admin network subnet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">CIDR / IP Range</th>
                    <th className="px-3 py-2.5">Description / Label</th>
                    <th className="px-3 py-2.5">Added Date</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                  {config?.entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="transition-colors hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-3 py-3 font-mono font-bold text-slate-900 dark:text-white">
                        {entry.cidr}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {entry.label || <span className="italic text-slate-400">No label</span>}
                      </td>
                      <td className="px-3 py-3 text-slate-500 dark:text-slate-400">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSubmitting}
                          onClick={() => handleDeleteEntry(entry.id, entry.cidr)}
                          className="h-7 text-[11px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Entry Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-white">
              <Lock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              Add Authorized IP or CIDR Range
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
              Enter a single IP (e.g. 203.0.113.45) or CIDR block (e.g. 198.51.100.0/24).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                IP Address or CIDR Subnet
              </label>
              <Input
                value={newCidr}
                onChange={(e) => setNewCidr(e.target.value)}
                placeholder="e.g. 203.0.113.45 or 198.51.100.0/24"
                className="border-slate-300 bg-slate-50 font-mono text-sm dark:border-slate-800 dark:bg-slate-950"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Label / Description (Optional)
              </label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Corporate HQ Gateway, Primary Admin"
                className="border-slate-300 bg-slate-50 text-sm dark:border-slate-800 dark:bg-slate-950"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddModalOpen(false)}
              disabled={isSubmitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAddEntry}
              disabled={isSubmitting || !newCidr.trim()}
              className="bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {isSubmitting ? 'Saving...' : 'Add to Allowlist'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
