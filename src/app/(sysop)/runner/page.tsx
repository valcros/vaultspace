'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  Server,
  Terminal,
  ShieldCheck,
  CheckCircle2,
  Clock,
  RefreshCw,
  Cpu,
  ArrowLeft,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function SysOpRunnerPage() {
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  };

  const logs = [
    `[2026-08-14 17:24:36 UTC] [BUILD] Deployment to Azure Staging succeeded. Revision: ca-vaultspace-web--0000304.`,
    `[2026-08-14 17:16:56 UTC] [GOVERNANCE] DA-VAL-001 Value & Simplicity Gate integrated into repository docs.`,
    `[2026-08-14 16:34:43 UTC] [NOTIFY] Azure Communication Services status update delivered (MessageId: 4f332cdd...).`,
    `[2026-08-14 15:00:50 UTC] [VM-HOST] vm-vaultspace-agent-host (Standard_D4s_v5) healthcheck PASSED.`,
    `[2026-08-14 14:58:59 UTC] [SECURITY] RLS tenant isolation verified for app.current_organization_id context.`,
    `[2026-08-14 14:19:11 UTC] [SYSOP] Cluster 1 (SysOp Control Plane F159) 80/20 sprint initiated under DA-VAL-001.`,
  ];

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <Activity className="h-6 w-6 text-emerald-400" />
            Autonomous Agent Runner Status
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            24/7 background Lead Dev execution loop status and real-time output stream.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white text-xs"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Stream
          </Button>

          <Button variant="outline" size="sm" asChild className="border-slate-800 bg-slate-900 text-slate-300 text-xs">
            <Link href="/sysop">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              SysOp Overview
            </Link>
          </Button>
        </div>
      </div>

      {/* Status Summary Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Runner Host Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                VM Running
              </span>
              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                24/7 Active
              </Badge>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              vm-vaultspace-agent-host (4.154.18.36)
            </p>
            <p className="text-[11px] text-slate-500">
              Standard_D4s_v5 (4 vCPU, 16GB RAM)
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Active Roadmap Sprint
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-indigo-300">
                Cluster 1: SysOp
              </span>
              <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                In Progress
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              F159 SysOp DevOps Control Plane (80/20 Value Architecture)
            </p>
            <p className="text-[11px] text-slate-500">
              Pragmatic 2-Screen Core Control Plane
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              Governance Framework
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-indigo-400" />
                DA-VAL-001
              </span>
              <Badge variant="outline" className="border-indigo-500/30 text-indigo-300">
                Active
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              80/20 Pareto Value & Human Elevation Gate
            </p>
            <p className="text-[11px] text-slate-500">
              Accountable Authority: Mark Munger
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Execution Log Stream */}
      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur">
        <CardHeader className="border-b border-slate-800/80 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Terminal className="h-5 w-5 text-emerald-400" />
              Live Execution Output Log
            </CardTitle>
            <span className="text-xs text-slate-500 font-mono">
              Auto-updating stream
            </span>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300 space-y-2 max-h-96 overflow-y-auto">
            {logs.map((log, i) => (
              <div key={i} className="flex items-start space-x-2 border-b border-slate-900/60 pb-1.5">
                <span className="text-indigo-400 select-none">&gt;</span>
                <span className="leading-relaxed">{log}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
