'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mail, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { AdminPageContent, AdminToolbar } from '@/components/layout/admin-page';

// Human-readable labels for template keys
const TEMPLATE_LABELS: Record<string, string> = {
  document_uploaded: 'Document Uploaded',
  question_submitted: 'Question Submitted',
  access_approved: 'Access Approved',
  access_denied: 'Access Denied',
  link_accessed: 'Link Accessed',
  nda_signed: 'NDA Signed',
};

interface NotificationTemplate {
  templateKey: string;
  subject: string;
  bodyHtml: string;
  isActive: boolean;
  isCustomized: boolean;
}

export default function NotificationTemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = React.useState<NotificationTemplate[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  // Edit dialog state
  const [editingTemplate, setEditingTemplate] = React.useState<NotificationTemplate | null>(null);
  const [editSubject, setEditSubject] = React.useState('');
  const [editBodyHtml, setEditBodyHtml] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const sectionCardClass =
    'rounded-[1.5rem] border-slate-200/80 bg-white/88 shadow-[0_20px_46px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/50 dark:border-slate-800 dark:bg-slate-950/75 dark:ring-white/5';

  const fetchTemplates = React.useCallback(async () => {
    try {
      const response = await fetch('/api/settings/notification-templates');
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates);
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleToggleActive = async (templateKey: string, isActive: boolean) => {
    try {
      const response = await fetch('/api/settings/notification-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey, isActive }),
      });

      if (response.ok) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.templateKey === templateKey ? { ...t, isActive, isCustomized: true } : t
          )
        );
      }
    } catch (err) {
      console.error('Failed to toggle template:', err);
    }
  };

  const openEditDialog = (template: NotificationTemplate) => {
    setEditingTemplate(template);
    setEditSubject(template.subject);
    setEditBodyHtml(template.bodyHtml);
    setError(null);
  };

  const handleSaveTemplate = async () => {
    if (!editingTemplate) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/settings/notification-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateKey: editingTemplate.templateKey,
          subject: editSubject,
          bodyHtml: editBodyHtml,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save template');
      }

      const data = await response.json();
      setTemplates((prev) =>
        prev.map((t) => (t.templateKey === data.template.templateKey ? data.template : t))
      );
      setEditingTemplate(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  const getTemplateLabel = (key: string) => {
    return TEMPLATE_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="mb-8 h-4 w-96" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Notification Templates"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Notification Templates' },
        ]}
        actions={
          <Button
            variant="ghost"
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={() => router.push('/settings')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Settings
          </Button>
        }
      />

      <AdminPageContent className="max-w-4xl">
        <AdminToolbar
          title="Email template controls"
          description="Enable or customize notification templates without losing track of available placeholders and delivery defaults."
        />
        {error && !editingTemplate && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert
            variant="default"
            className="mb-6 border-success-200 bg-success-50 text-success-800"
          >
            <AlertDescription>Template saved successfully</AlertDescription>
          </Alert>
        )}

        <Card className={sectionCardClass}>
          <CardHeader>
            <CardTitle>Available Placeholders</CardTitle>
            <CardDescription>
              Use these placeholders in your subject lines and body templates. They will be replaced
              with actual values when notifications are sent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {[
                '{user_name}',
                '{document_name}',
                '{room_name}',
                '{org_name}',
                '{viewer_email}',
                '{question_text}',
              ].map((placeholder) => (
                <Badge key={placeholder} variant="secondary" className="font-mono text-xs">
                  {placeholder}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {templates.map((template) => (
            <Card key={template.templateKey} className={sectionCardClass}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-sky-200/60 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
                      <Mail className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{getTemplateLabel(template.templateKey)}</p>
                        {template.isCustomized && (
                          <Badge variant="outline" className="text-xs">
                            Customized
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm text-neutral-500">{template.subject}</p>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <Switch
                      checked={template.isActive}
                      onCheckedChange={(checked) =>
                        handleToggleActive(template.templateKey, checked)
                      }
                    />
                    <Button variant="ghost" size="sm" onClick={() => openEditDialog(template)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </AdminPageContent>

      {/* Edit Template Dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Edit Template: {editingTemplate && getTemplateLabel(editingTemplate.templateKey)}
            </DialogTitle>
            <DialogDescription>
              Customize the subject line and body of this notification email.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {error && editingTemplate && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="edit-subject">Subject Line</Label>
              <Input
                id="edit-subject"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="Email subject with {placeholders}"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-body">Body (HTML)</Label>
              <Textarea
                id="edit-body"
                value={editBodyHtml}
                onChange={(e) => setEditBodyHtml(e.target.value)}
                rows={10}
                className="font-mono text-sm"
                placeholder="<p>Hello {user_name},</p><p>...</p>"
              />
            </div>

            <div className="rounded-md bg-neutral-50 p-3">
              <p className="mb-2 text-xs font-medium text-neutral-600">Available Placeholders:</p>
              <div className="flex flex-wrap gap-1">
                {[
                  '{user_name}',
                  '{document_name}',
                  '{room_name}',
                  '{org_name}',
                  '{viewer_email}',
                  '{question_text}',
                ].map((p) => (
                  <Badge key={p} variant="secondary" className="font-mono text-xs">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate} loading={isSaving}>
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
