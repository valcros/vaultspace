'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Trash2,
  Settings,
  ShieldCheck,
  Download,
  FileText,
  Palette,
  AlertTriangle,
  Maximize2,
  Minimize2,
  CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminPageContent, AdminToolbar } from '@/components/layout/admin-page';
import { AccordionItem } from '@/components/ui/accordion';

export const dynamic = 'force-dynamic';

interface RoomSettings {
  id: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  watermarkEnabled: boolean;
  watermarkTemplate: string | null;
  downloadEnabled: boolean;
  ndaRequired: boolean;
  ndaText: string | null;
  expiresAt: string | null;
}

export default function RoomSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params['roomId'] as string;

  const [room, setRoom] = React.useState<RoomSettings | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = React.useState('');

  // Expandable section states (all open by default for discovery, collapsible for focus)
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({
    general: true,
    security: true,
    access: true,
    nda: true,
    branding: true,
    danger: true,
  });

  const [formData, setFormData] = React.useState({
    name: '',
    description: '',
    watermarkEnabled: true,
    watermarkTemplate: '{viewer_email} | {timestamp}',
    downloadEnabled: false,
    allowViewerVersionHistory: false,
    ndaRequired: false,
    ndaText: '',
    defaultExpiryDays: '',
    allDocumentsConfidential: false,
    brandColor: '',
    brandLogoUrl: '',
    ipAllowlist: '',
  });

  const toggleSection = (sectionKey: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const expandAll = () => {
    setOpenSections({
      general: true,
      security: true,
      access: true,
      nda: true,
      branding: true,
      danger: true,
    });
  };

  const collapseAll = () => {
    setOpenSections({
      general: false,
      security: false,
      access: false,
      nda: false,
      branding: false,
      danger: false,
    });
  };

  const fetchRoom = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      if (response.ok) {
        const data = await response.json();
        setRoom(data.room);
        setFormData({
          name: data.room.name,
          description: data.room.description || '',
          watermarkEnabled: data.room.watermarkEnabled,
          watermarkTemplate: data.room.watermarkTemplate || '{viewer_email} | {timestamp}',
          downloadEnabled: data.room.allowDownloads,
          allowViewerVersionHistory: data.room.allowViewerVersionHistory || false,
          ndaRequired: data.room.requiresNda || false,
          ndaText: data.room.ndaContent || '',
          defaultExpiryDays: data.room.defaultExpiryDays?.toString() || '',
          allDocumentsConfidential: data.room.allDocumentsConfidential || false,
          brandColor: data.room.brandColor || '',
          brandLogoUrl: data.room.brandLogoUrl || '',
          ipAllowlist: (data.room.ipAllowlist || []).join('\n'),
        });
      } else if (response.status === 404) {
        router.push('/rooms');
      }
    } catch (err) {
      console.error('Failed to fetch room:', err);
    } finally {
      setIsLoading(false);
    }
  }, [roomId, router]);

  React.useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await fetch(`/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          enableWatermark: formData.watermarkEnabled,
          watermarkTemplate: formData.watermarkTemplate,
          allowDownloads: formData.downloadEnabled,
          allowViewerVersionHistory: formData.allowViewerVersionHistory,
          requiresNda: formData.ndaRequired,
          ndaContent: formData.ndaText,
          defaultExpiryDays: formData.defaultExpiryDays
            ? parseInt(formData.defaultExpiryDays, 10)
            : null,
          allDocumentsConfidential: formData.allDocumentsConfidential,
          brandColor: formData.brandColor || null,
          brandLogoUrl: formData.brandLogoUrl || null,
          ipAllowlist: formData.ipAllowlist
            .split('\n')
            .map((ip: string) => ip.trim())
            .filter((ip: string) => ip.length > 0),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmation !== room?.name) {
      return;
    }

    try {
      const response = await fetch(`/api/rooms/${roomId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/rooms');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to delete room');
      }
    } catch (err) {
      console.error('Failed to delete room:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="mb-8 h-4 w-96" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!room) {
    return null;
  }

  const allExpanded = Object.values(openSections).every(Boolean);

  return (
    <>
      <PageHeader
        title="Room Settings"
        breadcrumbs={[
          { label: 'Rooms', href: '/rooms' },
          { label: room.name, href: `/rooms/${roomId}` },
          { label: 'Settings' },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push(`/rooms/${roomId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Room
          </Button>
        }
      />

      <AdminPageContent className="max-w-7xl">
        <AdminToolbar
          title="Room Configuration & Governance"
          description="Manage security defaults, viewer access rights, NDA requirements, and custom branding."
          actions={
            <div className="flex items-center space-x-3">
              <Button
                variant="outline"
                size="sm"
                onClick={allExpanded ? collapseAll : expandAll}
                className="text-xs"
              >
                {allExpanded ? (
                  <>
                    <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> Collapse All
                  </>
                ) : (
                  <>
                    <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Expand All
                  </>
                )}
              </Button>

              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="bg-indigo-600 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500"
              >
                <Save className="mr-1.5 h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          }
        />

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert
            variant="default"
            className="mb-6 flex items-center gap-2 border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <AlertDescription>Room settings saved successfully</AlertDescription>
          </Alert>
        )}

        {/* 2-Column Responsive Layout: Quick Index Sidebar + Expandable Settings Feed */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          {/* Quick Index Sidebar (Sticky on Large Screens) */}
          <div className="sticky top-24 h-fit space-y-2 lg:col-span-1">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
              <h4 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Settings Navigation
              </h4>

              <nav className="space-y-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSections((prev) => ({ ...prev, general: !prev['general'] }))
                  }
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                    openSections['general']
                      ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Settings className="h-4 w-4" /> General Info
                  </span>
                  {openSections['general'] && (
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setOpenSections((prev) => ({ ...prev, security: !prev['security'] }))
                  }
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                    openSections['security']
                      ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" /> Watermarking
                  </span>
                  {openSections['security'] && (
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setOpenSections((prev) => ({ ...prev, access: !prev['access'] }))}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                    openSections['access']
                      ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Download className="h-4 w-4" /> Access & Downloads
                  </span>
                  {openSections['access'] && (
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setOpenSections((prev) => ({ ...prev, nda: !prev['nda'] }))}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                    openSections['nda']
                      ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" /> NDA & Compliance
                  </span>
                  {openSections['nda'] && (
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setOpenSections((prev) => ({ ...prev, branding: !prev['branding'] }))
                  }
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                    openSections['branding']
                      ? 'bg-indigo-50 font-semibold text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Palette className="h-4 w-4" /> Custom Branding
                  </span>
                  {openSections['branding'] && (
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setOpenSections((prev) => ({ ...prev, danger: !prev['danger'] }))}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                    openSections['danger']
                      ? 'bg-red-50 font-semibold text-red-600 dark:bg-red-950/60 dark:text-red-400'
                      : 'text-red-600/80 hover:bg-red-50 dark:text-red-400/80 dark:hover:bg-red-950/30'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Danger Zone
                  </span>
                  {openSections['danger'] && (
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                  )}
                </button>
              </nav>
            </div>
          </div>

          {/* Expandable Settings Feed (Right 3 Columns) */}
          <div className="space-y-4 lg:col-span-3">
            {/* Section 1: General Info */}
            <AccordionItem
              id="general"
              title="General Room Information"
              description="Basic title, description, and high-level room identifiers."
              icon={Settings}
              isOpen={!!openSections['general']}
              onToggle={() => toggleSection('general')}
              badge={
                <Badge
                  variant="outline"
                  className="border-slate-300 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-400"
                >
                  Active Room
                </Badge>
              }
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs font-semibold">
                    Room Name
                  </Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-xs font-semibold">
                    Description
                  </Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    placeholder="Add room overview details for investors or reviewers..."
                  />
                </div>
              </div>
            </AccordionItem>

            {/* Section 2: Watermarking & Document Protection */}
            <AccordionItem
              id="security"
              title="Watermarking & Document Protection"
              description="Configure dynamic viewer identification overlays on all previewed documents."
              icon={ShieldCheck}
              isOpen={!!openSections['security']}
              onToggle={() => toggleSection('security')}
              badge={
                formData.watermarkEnabled ? (
                  <Badge className="border-indigo-500/30 bg-indigo-500/20 text-[11px] text-indigo-700 dark:text-indigo-300">
                    Watermarks ON
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-slate-300 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    Watermarks OFF
                  </Badge>
                )
              }
            >
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="watermark" className="text-sm font-semibold">
                      Enable Dynamic Watermarks
                    </Label>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Stamp viewer details directly across document previews to prevent screenshots.
                    </p>
                  </div>
                  <Switch
                    id="watermark"
                    checked={formData.watermarkEnabled}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, watermarkEnabled: checked })
                    }
                  />
                </div>

                {formData.watermarkEnabled && (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                    <Label htmlFor="watermarkTemplate" className="text-xs font-semibold">
                      Watermark Text Template
                    </Label>
                    <Input
                      id="watermarkTemplate"
                      value={formData.watermarkTemplate}
                      onChange={(e) =>
                        setFormData({ ...formData, watermarkTemplate: e.target.value })
                      }
                      placeholder="{viewer_email} | {timestamp}"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Placeholders: {'{viewer_email}'}, {'{viewer_name}'}, {'{timestamp}'},{' '}
                      {'{date}'}, {'{viewer_ip}'}, {'{room_name}'}
                    </p>
                  </div>
                )}
              </div>
            </AccordionItem>

            {/* Section 3: Access Rights & Downloads */}
            <AccordionItem
              id="access"
              title="Access Rights & Version Control"
              description="Manage original file downloading, version history visibility, and default link expiration."
              icon={Download}
              isOpen={!!openSections['access']}
              onToggle={() => toggleSection('access')}
              badge={
                formData.downloadEnabled ? (
                  <Badge className="border-emerald-500/30 bg-emerald-500/20 text-[11px] text-emerald-700 dark:text-emerald-300">
                    Downloads Allowed
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-slate-300 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    View-Only
                  </Badge>
                )
              }
            >
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="download" className="text-sm font-semibold">
                      Allow Original Downloads
                    </Label>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Permit viewers to download raw files (PDFs, XLSX, DOCX).
                    </p>
                  </div>
                  <Switch
                    id="download"
                    checked={formData.downloadEnabled}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, downloadEnabled: checked })
                    }
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="viewerVersionHistory" className="text-sm font-semibold">
                      Viewer Version History
                    </Label>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Allow external viewers to inspect prior revisions of updated documents.
                    </p>
                  </div>
                  <Switch
                    id="viewerVersionHistory"
                    checked={formData.allowViewerVersionHistory}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, allowViewerVersionHistory: checked })
                    }
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="defaultExpiry" className="text-xs font-semibold">
                    Default Share Link Expiration (Days)
                  </Label>
                  <Input
                    id="defaultExpiry"
                    type="number"
                    min="0"
                    placeholder="Leave blank for no default expiry"
                    value={formData.defaultExpiryDays}
                    onChange={(e) =>
                      setFormData({ ...formData, defaultExpiryDays: e.target.value })
                    }
                    className="max-w-xs"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Automatically applies expiration date to newly generated share links.
                  </p>
                </div>
              </div>
            </AccordionItem>

            {/* Section 4: NDA & Compliance Restrictions */}
            <AccordionItem
              id="nda"
              title="NDA & Compliance Restrictions"
              description="Require clickwrap NDA agreement, confidential document masking, and IP address allowlists."
              icon={FileText}
              isOpen={!!openSections['nda']}
              onToggle={() => toggleSection('nda')}
              badge={
                formData.ndaRequired ? (
                  <Badge className="border-indigo-500/30 bg-indigo-500/20 text-[11px] text-indigo-700 dark:text-indigo-300">
                    NDA Required
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-slate-300 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    NDA Optional
                  </Badge>
                )
              }
            >
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="nda" className="text-sm font-semibold">
                      Require 1-Click NDA Acceptance
                    </Label>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Viewers must review and accept confidentiality terms before entering the room.
                    </p>
                  </div>
                  <Switch
                    id="nda"
                    checked={formData.ndaRequired}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, ndaRequired: checked })
                    }
                  />
                </div>

                {formData.ndaRequired && (
                  <div className="space-y-2 border-l-2 border-indigo-500 pl-4">
                    <Label htmlFor="ndaText" className="text-xs font-semibold">
                      Custom NDA Terms & Agreement
                    </Label>
                    <Textarea
                      id="ndaText"
                      value={formData.ndaText}
                      onChange={(e) => setFormData({ ...formData, ndaText: e.target.value })}
                      rows={4}
                      placeholder="Enter legal non-disclosure terms..."
                    />
                  </div>
                )}

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="confidential" className="text-sm font-semibold">
                      Confidential Thumbnail Masking
                    </Label>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Suppress document preview thumbnails in grid views for added privacy.
                    </p>
                  </div>
                  <Switch
                    id="confidential"
                    checked={formData.allDocumentsConfidential}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, allDocumentsConfidential: checked })
                    }
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="ipAllowlist" className="font-mono text-xs font-semibold">
                    IP Address Allowlist
                  </Label>
                  <Textarea
                    id="ipAllowlist"
                    value={formData.ipAllowlist}
                    onChange={(e) => setFormData({ ...formData, ipAllowlist: e.target.value })}
                    rows={3}
                    placeholder={'192.168.1.1\n10.0.0.0/24\n203.0.113.50'}
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Enter one IP address or CIDR range per line. Leave empty to allow all IP
                    addresses.
                  </p>
                </div>
              </div>
            </AccordionItem>

            {/* Section 5: Custom Branding */}
            <AccordionItem
              id="branding"
              title="Viewer Branding & Themes"
              description="Customize accent colors and logos visible to external investors."
              icon={Palette}
              isOpen={!!openSections['branding']}
              onToggle={() => toggleSection('branding')}
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="brandColor" className="text-xs font-semibold">
                    Accent Color Override
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="brandColor"
                      type="color"
                      value={formData.brandColor || '#2563eb'}
                      onChange={(e) => setFormData({ ...formData, brandColor: e.target.value })}
                      className="h-10 w-12 cursor-pointer p-1"
                    />
                    <Input
                      value={formData.brandColor}
                      onChange={(e) => setFormData({ ...formData, brandColor: e.target.value })}
                      placeholder="#2563eb"
                      className="max-w-xs font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="brandLogoUrl" className="text-xs font-semibold">
                    Custom Logo URL
                  </Label>
                  <Input
                    id="brandLogoUrl"
                    value={formData.brandLogoUrl}
                    onChange={(e) => setFormData({ ...formData, brandLogoUrl: e.target.value })}
                    placeholder="https://example.com/logo.png"
                  />
                </div>
              </div>
            </AccordionItem>

            {/* Section 6: Danger Zone */}
            <AccordionItem
              id="danger"
              title="Danger Zone"
              description="Irreversible actions including archiving or permanently deleting this room."
              icon={AlertTriangle}
              isOpen={!!openSections['danger']}
              onToggle={() => toggleSection('danger')}
              variant="danger"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
                    Danger Zone
                  </h3>
                  <p className="text-xs text-red-600/80 dark:text-red-400/70">
                    Permanently removes all documents, folders, permissions, and audit logs.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowDeleteDialog(true)}
                  className="bg-red-600 text-xs hover:bg-red-700"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete Room
                </Button>
              </div>
            </AccordionItem>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertTriangle className="h-5 w-5" /> Delete Room Permanent Action
              </DialogTitle>
              <DialogDescription className="text-xs">
                This will permanently delete{' '}
                <span className="font-semibold text-slate-900 dark:text-white">{room.name}</span>.
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                To confirm deletion, type{' '}
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {room.name}
                </span>{' '}
                below:
              </p>
              <Input
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder={room.name}
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteDialog(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleteConfirmation !== room.name}
                className="bg-red-600 hover:bg-red-700"
              >
                Permanently Delete Room
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AdminPageContent>
    </>
  );
}
