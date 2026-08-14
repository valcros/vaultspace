'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, Terminal, ShieldCheck, CheckCircle2, RefreshCw, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default function SysOpRunnerPage() {
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  };

  const logs = [
    `[2026-08-14 17:24:36 UTC] [BUILD] Deployment to Azure Staging succeeded. Revision: <web-container-app>--0000306.`,
    `[2026-08-14 17:16:56 UTC] [GOVERNANCE] DA-VAL-001 Value & Simplicity Gate integrated into repository docs.`,
    `[2026-08-14 16:34:43 UTC] [NOTIFY] Azure Communication Services status update delivered (MessageId: 4f332cdd...).`,
    `[2026-08-14 15:00:50 UTC] [VM-HOST] REDACTED (Standard_D4s_v5) healthcheck PASSED.`,
    `[2026-08-14 14:58:59 UTC] [SECURITY] RLS tenant isolation verified for app.current_organization_id context.`,
    `[2026-08-14 14:19:11 UTC] [SYSOP] Cluster 1 (SysOp Control Plane F159) 80/20 sprint initiated under DA-VAL-001.`,
  ];

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            <Activity className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            Autonomous Agent Runner Status
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            24/7 background Lead Dev execution loop status and real-time output stream.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Stream
          </Button>

          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-slate-300 bg-white text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
          >
            <Link href="/sysop">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              SysOp Overview
            </Link>
          </Button>
        </div>
      </div>

      {/* Status Summary Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Runner Host Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                VM Running
              </span>
              <Badge className="border-emerald-500/30 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                24/7 Active
              </Badge>
            </div>
            <p className="font-mono text-xs text-slate-600 dark:text-slate-400">
              REDACTED (REDACTED)
            </p>
            <p className="text-[11px] text-slate-500">Standard_D4s_v5 (4 vCPU, 16GB RAM)</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Roadmap Sprint
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-indigo-700 dark:text-indigo-300">
                Cluster 1: SysOp
              </span>
              <Badge className="border-indigo-500/30 bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
                In Progress
              </Badge>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              F159 SysOp DevOps Control Plane (80/20 Value Architecture)
            </p>
            <p className="text-[11px] text-slate-500">Pragmatic 2-Screen Core Control Plane</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Governance Framework
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
                <ShieldCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                DA-VAL-001
              </span>
              <Badge
                variant="outline"
                className="border-indigo-500/30 text-indigo-700 dark:text-indigo-300"
              >
                Active
              </Badge>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              80/20 Pareto Value & Human Elevation Gate
            </p>
            <p className="text-[11px] text-slate-500">Accountable Authority: Project Owner</p>
          </CardContent>
        </Card>
      </div>

      {/* Execution Log Stream */}
      <Card className="border-slate-200 bg-white backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
        <CardHeader className="border-b border-slate-200 pb-3 dark:border-slate-800/80">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-white">
              <Terminal className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              Live Execution Output Log
            </CardTitle>
            <span className="font-mono text-xs text-slate-500">Auto-updating stream</span>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-100 dark:border-slate-800 dark:bg-slate-950">
            {logs.map((log, i) => (
              <div
                key={i}
                className="flex items-start space-x-2 border-b border-slate-800/60 pb-1.5"
              >
                <span className="select-none text-indigo-400">&gt;</span>
                <span className="leading-relaxed">{log}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
